const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const oldCompletedDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago -> should auto-archive (threshold 14)
  const recentCompletedDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago -> should NOT auto-archive

  const repoFiles = {
    "data/tasks.json": {
      headings: [{ id: "h1", title: "Work", color: null, tasks: [
        { id: "t1", text: "Active task", done: false, due: null },
        { id: "t2", text: "Recently done", done: true, completedAt: recentCompletedDate, due: null },
        { id: "t3", text: "Old done task", done: true, completedAt: oldCompletedDate, due: null }
      ], subheadings: [] }]
    }
  };
  const shas = {};

  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!m) return route.fulfill({ status: 404, body: "{}" });
    const filePath = decodeURIComponent(m[3]);
    if (req.method() === "GET") {
      if (repoFiles[filePath] === undefined) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
      const sha = shas[filePath] || "sha-1"; shas[filePath] = sha;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: b64(repoFiles[filePath]), sha: sha, encoding: "base64" }) });
    }
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      repoFiles[filePath] = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
      shas[filePath] = "sha-" + Math.random();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: shas[filePath] } }) });
    }
    return route.fulfill({ status: 404, body: "{}" });
  });

  await page.goto(HTML_PATH);
  await page.waitForSelector("#modal-root .modal-box", { timeout: 5000 });
  await page.fill("#f-owner", "wenzu23589");
  await page.fill("#f-repo", "todo");
  await page.fill("#f-branch", "main");
  await page.fill("#f-path", "data/tasks.json");
  await page.fill("#f-token", "fake-pat-token");
  await page.click("#settings-save");
  await page.waitForSelector("#modal-root .modal-box", { state: "detached", timeout: 5000 });
  await page.waitForSelector(".task-row", { timeout: 5000 });

  // Old completed task should have been auto-archived on load — not shown in main list
  const visibleTexts = await page.locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Old completed task auto-archived out of main list:",
    JSON.stringify(visibleTexts) === JSON.stringify(["Active task", "Recently done"]) ? "PASS" : "FAIL (" + JSON.stringify(visibleTexts) + ")");

  const archiveToggleText = await page.locator(".archive-toggle").first().textContent();
  console.log("Archive toggle shows count of 1:", /archived \(1\)/.test(archiveToggleText) ? "PASS" : "FAIL (" + archiveToggleText + ")");

  const headingCount = await page.locator(".heading-count").first().textContent();
  console.log("Heading count excludes archived task (1 done / 2 visible):", headingCount.trim() === "1/2" ? "PASS" : "FAIL (" + headingCount + ")");

  // Expand archive
  await page.click(".archive-toggle");
  await page.waitForSelector(".archived-row", { timeout: 5000 });
  const archivedText = await page.locator(".archived-text").first().textContent();
  console.log("Archived row shows the old task:", archivedText === "Old done task" ? "PASS" : "FAIL (" + archivedText + ")");

  // Manually archive "Recently done" via its archive button
  const recentRow = page.locator('.task-row', { has: page.locator('.task-text[value="Recently done"]') });
  await recentRow.hover();
  await recentRow.locator('[data-act="archive"]').click();
  await page.waitForTimeout(150);
  const visibleAfterManualArchive = await page.locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Manual archive removes task from main list:", JSON.stringify(visibleAfterManualArchive) === JSON.stringify(["Active task"]) ? "PASS" : "FAIL (" + JSON.stringify(visibleAfterManualArchive) + ")");

  // Archive toggle count should now be 2 (still expanded, since expansion is per-heading persistent UI state)
  const archiveToggleTextAfter = await page.locator(".archive-toggle").first().textContent();
  console.log("Archive count updates to 2:", /archived \(2\)/.test(archiveToggleTextAfter) ? "PASS" : "FAIL (" + archiveToggleTextAfter + ")");
  const archivedRowCount = await page.locator(".archived-row").count();
  console.log("Archive panel stays expanded and shows both archived tasks:", archivedRowCount === 2 ? "PASS" : "FAIL (" + archivedRowCount + ")");

  // Restore "Old done task"
  const oldArchivedRow = page.locator(".archived-row", { hasText: "Old done task" });
  await oldArchivedRow.locator('[data-act="restore"]').click();
  await page.waitForTimeout(150);
  const visibleAfterRestore = await page.locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Restored task reappears in main list:", visibleAfterRestore.includes("Old done task") ? "PASS" : "FAIL (" + JSON.stringify(visibleAfterRestore) + ")");

  // No un-done task should ever show an archive button
  const activeRow = page.locator('.task-row', { has: page.locator('.task-text[value="Active task"]') });
  const archiveBtnOnActive = await activeRow.locator('[data-act="archive"]').count();
  console.log("Un-done task has no archive button:", archiveBtnOnActive === 0 ? "PASS" : "FAIL");

  // Permanently delete the remaining archived item — this is now a real, irreversible
  // delete (confirm dialog, no undo, doesn't go through the recycle bin), distinct from
  // deleting a task straight from the main list, which now soft-deletes into the bin.
  const remainingArchivedRow = page.locator(".archived-row", { hasText: "Recently done" });
  await remainingArchivedRow.locator(".icon-btn.danger").click();
  await page.waitForSelector("#confirm-ok", { timeout: 5000 });
  await page.click("#confirm-ok");
  await page.waitForTimeout(150);
  const toastAfterPermDelete = await page.locator("#undo-toast").count();
  console.log("Permanently deleting an archived task offers no Undo:", toastAfterPermDelete === 0 ? "PASS" : "FAIL");
  const archivedRowsLeft = await page.locator(".archived-row").count();
  console.log("The permanently-deleted task is gone from the archive list:", archivedRowsLeft === 0 ? "PASS" : "FAIL (" + archivedRowsLeft + ")");
  await page.waitForTimeout(1500); // let the debounced save settle
  const remainingSavedTasks = repoFiles["data/tasks.json"].headings[0].tasks.map(t => t.text);
  console.log("...it's fully gone from storage, not just soft-deleted into the bin:", !remainingSavedTasks.includes("Recently done") ? "PASS" : "FAIL (" + JSON.stringify(remainingSavedTasks) + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

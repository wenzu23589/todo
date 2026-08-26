const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": {
      headings: [
        { id: "h1", title: "Work", color: null, tasks: [
          { id: "t1", text: "Keep me", done: false, due: null },
          { id: "t2", text: "Delete me", done: false, due: { date: "2026-09-01", time: null, endTime: null, allDay: true } }
        ], subheadings: [
          { id: "s1", title: "Sub A", collapsed: false, tasks: [ { id: "t3", text: "Sub task to delete", done: false, due: null } ] }
        ] }
      ]
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

  // --- Trash tab starts with no count badge ---
  const tabTextInitial = await page.locator("#tab-trash").textContent();
  console.log("Trash tab starts with no count shown:", tabTextInitial.trim() === "Trash" ? "PASS" : "FAIL (" + tabTextInitial + ")");

  // --- Delete a task and let the Undo toast expire (simulated by just not clicking it) ---
  const delRow = page.locator('.task-row[data-task-id="t2"]');
  await delRow.hover();
  await delRow.locator(".icon-btn.danger").click();
  await page.waitForTimeout(150);
  const goneFromList = await page.locator('.task-row[data-task-id="t2"]').count();
  console.log("Deleted task disappears from the main list immediately:", goneFromList === 0 ? "PASS" : "FAIL");

  const tabTextAfterDelete = await page.locator("#tab-trash").textContent();
  console.log("Trash tab count updates to 1 right away (no need to wait for the toast to expire):", tabTextAfterDelete.trim() === "Trash (1)" ? "PASS" : "FAIL (" + tabTextAfterDelete + ")");

  // Switch to Trash tab without touching the Undo toast
  await page.click("#tab-trash");
  await page.waitForTimeout(150);
  const trashRowCount = await page.locator(".archived-row").count();
  console.log("Recycle bin shows the deleted task:", trashRowCount === 1 ? "PASS" : "FAIL (" + trashRowCount + ")");
  const trashRowText = await page.locator(".archived-row .archived-text").first().textContent();
  console.log("Recycle bin row shows the task's text and its original heading:", /Delete me/.test(trashRowText) && /Work/.test(trashRowText) ? "PASS" : "FAIL (" + trashRowText + ")");

  // --- Restore from the recycle bin ---
  await page.click('.archived-row [data-act="restore"]');
  await page.waitForTimeout(150);
  const trashEmptyAfterRestore = await page.locator(".archived-row").count();
  console.log("Recycle bin is empty after restoring:", trashEmptyAfterRestore === 0 ? "PASS" : "FAIL");
  await page.click("#tab-list");
  await page.waitForTimeout(150);
  const restoredRow = await page.locator('.task-row[data-task-id="t2"]').count();
  console.log("Restored task reappears back in its original heading's list:", restoredRow === 1 ? "PASS" : "FAIL");
  const restoredDueBadge = await page.locator('.task-row[data-task-id="t2"] .due-badge').textContent();
  console.log("Restored task keeps its due date intact:", /Sep 1/.test(restoredDueBadge) ? "PASS" : "FAIL (" + restoredDueBadge + ")");

  // --- Delete it again, this time permanently from the recycle bin ---
  await delRow.hover();
  await delRow.locator(".icon-btn.danger").click();
  await page.waitForTimeout(150);
  await page.click("#tab-trash");
  await page.waitForSelector(".archived-row", { timeout: 5000 });
  await page.click(".archived-row .icon-btn.danger");
  await page.waitForSelector("#confirm-ok", { timeout: 5000 });
  await page.click("#confirm-ok");
  await page.waitForTimeout(150);
  const trashEmptyAfterPermDelete = await page.locator(".archived-row").count();
  console.log("Permanently deleting from the recycle bin removes it from the bin too:", trashEmptyAfterPermDelete === 0 ? "PASS" : "FAIL");
  await page.click("#tab-list");
  await page.waitForTimeout(150);
  const stillGoneFromList = await page.locator('.task-row[data-task-id="t2"]').count();
  console.log("...and it never comes back to the main list:", stillGoneFromList === 0 ? "PASS" : "FAIL");

  await page.waitForTimeout(1500);
  const savedTaskIds = repoFiles["data/tasks.json"].headings[0].tasks.map(t => t.id);
  console.log("Permanently-deleted task is fully gone from storage:", !savedTaskIds.includes("t2") ? "PASS" : "FAIL (" + JSON.stringify(savedTaskIds) + ")");

  // --- A task deleted from inside a sub-heading is findable and restorable too ---
  const subTaskRow = page.locator('.task-row[data-task-id="t3"]');
  await subTaskRow.hover();
  await subTaskRow.locator(".icon-btn.danger").click();
  await page.waitForTimeout(150);
  await page.click("#tab-trash");
  await page.waitForSelector(".archived-row", { timeout: 5000 });
  const subTrashText = await page.locator(".archived-row .archived-text").first().textContent();
  console.log("Deleting a task from a sub-heading shows the sub-heading in its recycle-bin path:", /Sub task to delete/.test(subTrashText) && /Sub A/.test(subTrashText) ? "PASS" : "FAIL (" + subTrashText + ")");
  await page.click('.archived-row [data-act="restore"]');
  await page.waitForTimeout(150);
  await page.click("#tab-list");
  await page.waitForTimeout(150);
  const subTaskRestoredCount = await page.locator('.task-row[data-task-id="t3"]').count();
  console.log("Restoring puts the sub-heading's task back where it was:", subTaskRestoredCount === 1 ? "PASS" : "FAIL");

  // --- Deleted tasks don't count toward the heading's done/total badge ---
  const keepRow = page.locator('.task-row[data-task-id="t1"]');
  await keepRow.hover();
  await keepRow.locator(".icon-btn.danger").click();
  await page.waitForTimeout(150);
  const headingCountAfterTrash = await page.locator(".heading-count").first().textContent();
  console.log("Heading's done/total count excludes a task sitting in the recycle bin:", headingCountAfterTrash.trim() === "0/1" ? "PASS" : "FAIL (" + headingCountAfterTrash + ")");
  // Undo it via the toast so the reload check below reflects a clean, expected state
  await page.click("#undo-toast-btn");
  await page.waitForTimeout(150);

  // --- Recycle bin survives reload ---
  const subTaskRow2 = page.locator('.task-row[data-task-id="t3"]');
  await subTaskRow2.hover();
  await subTaskRow2.locator(".icon-btn.danger").click();
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const tabTextAfterReload = await page.locator("#tab-trash").textContent();
  console.log("Recycle bin contents (and its count) persist across reload:", tabTextAfterReload.trim() === "Trash (1)" ? "PASS" : "FAIL (" + tabTextAfterReload + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

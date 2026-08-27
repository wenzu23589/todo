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
          { id: "t1", text: "First task", done: false, due: null },
          { id: "t2", text: "Second task", done: false, due: null },
          { id: "t3", text: "Third task", done: false, due: null }
        ], subheadings: [
          { id: "s1", title: "Sub A", collapsed: false, collapsedDefaultApplied: true, tasks: [ { id: "t4", text: "Sub task", done: false, due: null } ] }
        ] },
        { id: "h2", title: "Personal", color: null, tasks: [], subheadings: [] }
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

  // --- Task deletion + undo ---
  // Delete "Second task" (middle of the list, to verify it's restored at the right position)
  // Note: .task-row's visible text lives in an <input>'s .value, not textContent, so
  // hasText won't match it — use the data-task-id attribute instead.
  const secondRow = page.locator('.task-row[data-task-id="t2"]');
  await secondRow.hover();
  await secondRow.locator(".icon-btn.danger").click();
  await page.waitForTimeout(150);
  const orderAfterDelete = await page.locator("#headings-root .heading-card").first().locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Task removed immediately (no confirm dialog):", JSON.stringify(orderAfterDelete) === JSON.stringify(["First task", "Third task"]) ? "PASS" : "FAIL (" + JSON.stringify(orderAfterDelete) + ")");

  const toastVisible = await page.locator("#undo-toast").count();
  console.log("Undo toast appears:", toastVisible === 1 ? "PASS" : "FAIL");
  const toastText = await page.locator("#undo-toast").textContent();
  console.log("Toast says task deleted:", /Task deleted/.test(toastText) ? "PASS" : "FAIL (" + toastText + ")");

  await page.click("#undo-toast-btn");
  await page.waitForTimeout(150);
  const orderAfterUndo = await page.locator("#headings-root .heading-card").first().locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Task restored at original position after Undo:", JSON.stringify(orderAfterUndo) === JSON.stringify(["First task", "Second task", "Third task"]) ? "PASS" : "FAIL (" + JSON.stringify(orderAfterUndo) + ")");
  const toastGoneAfterUndo = await page.locator("#undo-toast").count();
  console.log("Toast dismissed after clicking Undo:", toastGoneAfterUndo === 0 ? "PASS" : "FAIL");

  // Confirm persistence reflects the restore (not the deletion)
  await page.waitForTimeout(1500);
  const savedTasks = repoFiles["data/tasks.json"].headings[0].tasks.map(t => t.text);
  console.log("Restore persisted to storage:", JSON.stringify(savedTasks) === JSON.stringify(["First task", "Second task", "Third task"]) ? "PASS" : "FAIL (" + JSON.stringify(savedTasks) + ")");

  // --- Sub-heading deletion + undo (goes through a confirm dialog first) ---
  // Note: .sub-bar/.heading-bar contain <input>s for their titles, so their visible
  // text lives in the .value attribute, not textContent — hasText won't match. Use
  // an attribute selector on the title input's value instead, scoped up to its bar.
  const subBar = page.locator(".sub-bar").filter({ has: page.locator('.sub-title[value="Sub A"]') });
  await subBar.hover();
  await subBar.locator(".icon-btn.danger").click();
  await page.waitForSelector("#confirm-ok", { timeout: 5000 });
  await page.click("#confirm-ok");
  await page.waitForTimeout(150);
  const subGoneAfterDelete = await page.locator('.sub-title[value="Sub A"]').count();
  console.log("Sub-heading removed after confirming:", subGoneAfterDelete === 0 ? "PASS" : "FAIL");
  const subToastText = await page.locator("#undo-toast").textContent();
  console.log("Toast says sub-heading deleted:", /Sub-heading deleted/.test(subToastText) ? "PASS" : "FAIL (" + subToastText + ")");
  await page.click("#undo-toast-btn");
  await page.waitForTimeout(150);
  const subBackAfterUndo = await page.locator('.sub-title[value="Sub A"]').count();
  console.log("Sub-heading restored after Undo:", subBackAfterUndo === 1 ? "PASS" : "FAIL");
  const subTaskBack = await page.locator('.sub-block').filter({ has: page.locator('.sub-title[value="Sub A"]') }).locator(".task-text").count();
  console.log("Sub-heading's own task restored along with it:", subTaskBack === 1 ? "PASS" : "FAIL");

  // --- Heading deletion + undo ---
  const headingBar = page.locator(".heading-bar").filter({ has: page.locator('.heading-title[value="Personal"]') });
  await headingBar.locator(".icon-btn.danger").click();
  await page.waitForSelector("#confirm-ok", { timeout: 5000 });
  await page.click("#confirm-ok");
  await page.waitForTimeout(150);
  const headingCountAfterDelete = await page.locator(".heading-card").count();
  console.log("Heading removed after confirming:", headingCountAfterDelete === 1 ? "PASS" : "FAIL (" + headingCountAfterDelete + ")");
  await page.click("#undo-toast-btn");
  await page.waitForTimeout(150);
  const headingCountAfterUndo = await page.locator(".heading-card").count();
  console.log("Heading restored after Undo:", headingCountAfterUndo === 2 ? "PASS" : "FAIL (" + headingCountAfterUndo + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

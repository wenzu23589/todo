const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// Tasks and subtasks now have a three-state status — not started / in progress / done —
// instead of a plain checkbox. Clicking the status control cycles through all three, in
// that order, and wraps back to not started from done. `done` (and everything that already
// keyed off it — heading counts, archiving) stays in sync: true exactly when status is "done".

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": {
      headings: [
        {
          id: "h1", title: "Work", color: null,
          tasks: [
            { id: "t1", text: "Fresh task", done: false, due: null, subtasks: [
              { id: "st1", text: "Fresh subtask", done: false, due: null }
            ] },
            // A save from before this feature: done true / false, no status field at all.
            { id: "t2", text: "Legacy done task", done: true, due: null, subtasks: [] },
            { id: "t3", text: "Legacy open task", done: false, due: null, subtasks: [] }
          ],
          subheadings: []
        }
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

  console.log("Status control renders as a button, not a checkbox:",
    await page.locator('.task-row[data-task-id="t1"] .check').evaluate(el => el.tagName) === "BUTTON" ? "PASS" : "FAIL");

  // --- Migration: legacy done/open tasks get a status derived from `done` ---
  console.log("A legacy done:true task migrates to status-done:",
    await page.locator('.task-row[data-task-id="t2"] .check').evaluate(el => el.classList.contains("status-done")) ? "PASS" : "FAIL");
  console.log("A legacy done:false task migrates to status-not_started:",
    await page.locator('.task-row[data-task-id="t3"] .check').evaluate(el => el.classList.contains("status-not_started")) ? "PASS" : "FAIL");

  // --- Cycling a fresh task: not started -> in progress -> done -> not started ---
  const t1Check = page.locator('.task-row[data-task-id="t1"] .check');
  console.log("Starts not started:", await t1Check.evaluate(el => el.classList.contains("status-not_started")) ? "PASS" : "FAIL");

  await t1Check.click();
  await page.waitForTimeout(150);
  console.log("First click moves it to in progress:",
    await page.locator('.task-row[data-task-id="t1"] .check.status-in_progress').count() === 1 ? "PASS" : "FAIL");
  console.log("Row gets the in-progress class:",
    await page.locator('.task-row[data-task-id="t1"].in-progress').count() === 1 ? "PASS" : "FAIL");
  console.log("Row is NOT marked done while only in progress:",
    await page.locator('.task-row[data-task-id="t1"].done').count() === 0 ? "PASS" : "FAIL");
  let headingCount = await page.locator(".heading-count").first().textContent();
  console.log("In-progress tasks don't count toward the heading's done total:", headingCount.trim() === "1/3" ? "PASS" : "FAIL (" + headingCount + ")");

  await page.locator('.task-row[data-task-id="t1"] .check').click();
  await page.waitForTimeout(150);
  console.log("Second click moves it to done:",
    await page.locator('.task-row[data-task-id="t1"] .check.status-done').count() === 1 ? "PASS" : "FAIL");
  console.log("Row now gets the done class (strikethrough):",
    await page.locator('.task-row[data-task-id="t1"].done').count() === 1 ? "PASS" : "FAIL");
  headingCount = await page.locator(".heading-count").first().textContent();
  console.log("Heading count now reflects it as done:", headingCount.trim() === "2/3" ? "PASS" : "FAIL (" + headingCount + ")");

  await page.locator('.task-row[data-task-id="t1"] .check').click();
  await page.waitForTimeout(150);
  console.log("Third click wraps back to not started:",
    await page.locator('.task-row[data-task-id="t1"] .check.status-not_started').count() === 1 ? "PASS" : "FAIL");

  // --- Persistence across reload ---
  await page.locator('.task-row[data-task-id="t1"] .check').click(); // -> in progress
  await page.waitForTimeout(1500);
  const savedT1 = repoFiles["data/tasks.json"].headings[0].tasks.filter(t => t.id === "t1")[0];
  console.log("The in-progress status persists to storage:", savedT1.status === "in_progress" && savedT1.done === false ? "PASS" : "FAIL (" + JSON.stringify(savedT1) + ")");

  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  console.log("Reloads still showing in progress:",
    await page.locator('.task-row[data-task-id="t1"] .check.status-in_progress').count() === 1 ? "PASS" : "FAIL");

  // --- Subtasks cycle the same way, independent of their parent task ---
  await page.locator('.task-row[data-task-id="t1"] .subtasks-badge').click();
  await page.waitForSelector('.subtask-item[data-subtask-id="st1"]', { timeout: 5000 });
  const st1Check = page.locator('.subtask-item[data-subtask-id="st1"] .subtask-check');
  console.log("Subtask status control also renders as a button:",
    await st1Check.evaluate(el => el.tagName) === "BUTTON" ? "PASS" : "FAIL");
  console.log("Subtask starts not started:",
    await st1Check.evaluate(el => el.classList.contains("status-not_started")) ? "PASS" : "FAIL");
  await st1Check.click();
  await page.waitForTimeout(100);
  console.log("One click moves the subtask to in progress:",
    await page.locator('.subtask-item[data-subtask-id="st1"] .subtask-check.status-in_progress').count() === 1 ? "PASS" : "FAIL");
  console.log("Subtask row gets the in-progress class:",
    await page.locator('.subtask-item[data-subtask-id="st1"].in-progress').count() === 1 ? "PASS" : "FAIL");
  await st1Check.click();
  await page.waitForTimeout(100);
  console.log("A second click marks the subtask done:",
    await page.locator('.subtask-item[data-subtask-id="st1"].done').count() === 1 ? "PASS" : "FAIL");

  await page.waitForTimeout(1500);
  const savedT1AfterSub = repoFiles["data/tasks.json"].headings[0].tasks.filter(t => t.id === "t1")[0];
  const savedSt1 = savedT1AfterSub.subtasks.filter(s => s.id === "st1")[0];
  console.log("Subtask's done status persists to storage:", savedSt1.status === "done" && savedSt1.done === true ? "PASS" : "FAIL (" + JSON.stringify(savedSt1) + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

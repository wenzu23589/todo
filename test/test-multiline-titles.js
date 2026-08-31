const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// Task and subtask titles are now <textarea>s, not <input>s: Shift+Enter inserts a line
// break, plain Enter finishes editing (blurs) same as before, and the field grows taller
// as content wraps or gains lines instead of scrolling internally.

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": {
      headings: [
        {
          id: "h1", title: "Work", color: null,
          tasks: [
            { id: "t1", text: "Single line task", done: false, due: null, subtasks: [
              { id: "st1", text: "Single line subtask", done: false, due: null }
            ] },
            { id: "t2", text: "Line one\nLine two\nLine three", done: false, due: null, subtasks: [] }
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

  console.log("Task title renders as a textarea, not an input:",
    await page.locator('.task-row[data-task-id="t1"] .task-text').evaluate(el => el.tagName) === "TEXTAREA" ? "PASS" : "FAIL");

  // Subtask rows only exist in the DOM once the subtasks editor for their parent task is open.
  await page.locator('.task-row[data-task-id="t1"] .subtasks-badge').click();
  await page.waitForSelector('.subtask-item[data-subtask-id="st1"]', { timeout: 5000 });
  console.log("Subtask title renders as a textarea, not an input:",
    await page.locator('.subtask-item[data-subtask-id="st1"] .subtask-text').evaluate(el => el.tagName) === "TEXTAREA" ? "PASS" : "FAIL");

  // --- Loading a task whose title already has embedded newlines auto-sizes to fit them ---
  const singleLineHeight = await page.locator('.task-row[data-task-id="t1"] .task-text').evaluate(el => el.getBoundingClientRect().height);
  const threeLineHeight = await page.locator('.task-row[data-task-id="t2"] .task-text').evaluate(el => el.getBoundingClientRect().height);
  console.log("A pre-existing multi-line title is taller than a single-line one on load:",
    threeLineHeight > singleLineHeight * 1.8 ? "PASS" : "FAIL (single=" + singleLineHeight + ", three=" + threeLineHeight + ")");
  const multilineValue = await page.locator('.task-row[data-task-id="t2"] .task-text').inputValue();
  console.log("Its full multi-line value round-trips through the textarea untouched:",
    multilineValue === "Line one\nLine two\nLine three" ? "PASS" : "FAIL (" + JSON.stringify(multilineValue) + ")");

  // --- Shift+Enter inserts a line break in a task title; plain Enter finishes editing ---
  const t1Text = page.locator('.task-row[data-task-id="t1"] .task-text');
  await t1Text.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Second line");
  const heightAfterShiftEnter = await t1Text.evaluate(el => el.getBoundingClientRect().height);
  console.log("Shift+Enter grows the field for the new line while still focused:",
    heightAfterShiftEnter > singleLineHeight * 1.8 ? "PASS" : "FAIL (" + heightAfterShiftEnter + ")");
  const valueAfterShiftEnter = await t1Text.inputValue();
  console.log("Shift+Enter inserted an actual newline into the title:",
    valueAfterShiftEnter === "Single line task\nSecond line" ? "PASS" : "FAIL (" + JSON.stringify(valueAfterShiftEnter) + ")");

  await page.keyboard.press("Enter");
  await page.waitForTimeout(50);
  const stillFocused = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("task-text"));
  console.log("Plain Enter afterwards blurs (finishes editing) instead of adding another line:", stillFocused ? "FAIL" : "PASS");
  const valueAfterPlainEnter = await t1Text.inputValue();
  console.log("...and doesn't itself insert a third line:",
    valueAfterPlainEnter === "Single line task\nSecond line" ? "PASS" : "FAIL (" + JSON.stringify(valueAfterPlainEnter) + ")");

  await page.waitForTimeout(1500); // debounced save
  const savedT1 = repoFiles["data/tasks.json"].headings[0].tasks.filter(t => t.id === "t1")[0];
  console.log("Multi-line task title persists to storage with the newline intact:",
    savedT1 && savedT1.text === "Single line task\nSecond line" ? "PASS" : "FAIL (" + JSON.stringify(savedT1) + ")");

  // --- Same convention for subtask titles ---
  const st1Text = page.locator('.subtask-item[data-subtask-id="st1"] .subtask-text');
  const subSingleLineHeight = await st1Text.evaluate(el => el.getBoundingClientRect().height);
  await st1Text.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Extra detail");
  const subHeightAfterShiftEnter = await st1Text.evaluate(el => el.getBoundingClientRect().height);
  // Subtask titles use a smaller font/line-height than task titles, so a second line adds
  // proportionally less to the fixed padding — same growth check, a looser multiplier.
  console.log("Shift+Enter grows a subtask title the same way:",
    subHeightAfterShiftEnter > subSingleLineHeight * 1.4 ? "PASS" : "FAIL (" + subHeightAfterShiftEnter + ")");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(50);
  const subStillFocused = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("subtask-text"));
  console.log("Plain Enter blurs a subtask title too:", subStillFocused ? "FAIL" : "PASS");

  await page.waitForTimeout(1500);
  const savedT1AfterSub = repoFiles["data/tasks.json"].headings[0].tasks.filter(t => t.id === "t1")[0];
  const savedSt1 = savedT1AfterSub.subtasks.filter(s => s.id === "st1")[0];
  console.log("Multi-line subtask title persists to storage with the newline intact:",
    savedSt1 && savedSt1.text === "Single line subtask\nExtra detail" ? "PASS" : "FAIL (" + JSON.stringify(savedSt1) + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

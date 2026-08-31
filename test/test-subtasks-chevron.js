const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = { "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
    { id: "t1", text: "Plan launch", done: false, due: null, subtasks: [
      { id: "st1", text: "Draft brief", done: false, due: null }
    ] },
    { id: "t2", text: "Other task", done: false, due: null, subtasks: [] }
  ], subheadings: [] }] } };
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

  // A disclosure chevron is present on the subtasks badge (even with 0 subtasks)
  const chevronCountEmpty = await page.locator('.task-row[data-task-id="t2"] .subtasks-badge .subtask-chevron').count();
  console.log("Subtasks badge shows a disclosure chevron even with no subtasks yet:", chevronCountEmpty === 1 ? "PASS" : "FAIL");

  const chevronCount = await page.locator('.task-row[data-task-id="t1"] .subtasks-badge .subtask-chevron').count();
  console.log("Subtasks badge shows a disclosure chevron:", chevronCount === 1 ? "PASS" : "FAIL");

  const closedClass = await page.getAttribute('.task-row[data-task-id="t1"] .subtasks-badge', "class");
  console.log("Badge does not start in the open state:", !/\bopen\b/.test(closedClass) ? "PASS" : "FAIL (" + closedClass + ")");

  // Clicking anywhere on the badge (not just precisely on the tiny icon) opens the panel
  await page.click('.task-row[data-task-id="t1"] .subtasks-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .subtasks-editor', { timeout: 5000 });
  const openClass = await page.getAttribute('.task-row[data-task-id="t1"] .subtasks-badge', "class");
  console.log("Opening the panel marks the badge (and its chevron) as open:", /\bopen\b/.test(openClass) ? "PASS" : "FAIL (" + openClass + ")");

  // Opening a different task's subtasks panel closes the first and clears its open state
  await page.click('.task-row[data-task-id="t2"] .subtasks-badge');
  await page.waitForSelector('.task-row[data-task-id="t2"] .subtasks-editor', { timeout: 5000 });
  const firstStillOpen = await page.getAttribute('.task-row[data-task-id="t1"] .subtasks-badge', "class");
  const firstEditorGone = await page.locator('.task-row[data-task-id="t1"] .subtasks-editor').count();
  console.log("Opening a second task's subtasks panel closes the first one's panel:", firstEditorGone === 0 ? "PASS" : "FAIL");
  console.log("...and clears the first badge's open/chevron-rotated state too:", !/\bopen\b/.test(firstStillOpen) ? "PASS" : "FAIL (" + firstStillOpen + ")");

  // Clicking the open badge again toggles it closed
  await page.click('.task-row[data-task-id="t2"] .subtasks-badge');
  await page.waitForTimeout(150);
  const secondClosedClass = await page.getAttribute('.task-row[data-task-id="t2"] .subtasks-badge', "class");
  const secondEditorGone = await page.locator('.task-row[data-task-id="t2"] .subtasks-editor').count();
  console.log("Clicking the badge again closes its own panel:", secondEditorGone === 0 ? "PASS" : "FAIL");
  console.log("...and clears its own open state:", !/\bopen\b/.test(secondClosedClass) ? "PASS" : "FAIL (" + secondClosedClass + ")");

  // The explicit Close button also clears the open state
  await page.click('.task-row[data-task-id="t1"] .subtasks-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .subtasks-editor', { timeout: 5000 });
  await page.click('.task-row[data-task-id="t1"] .subtasks-editor [data-act="close"]');
  await page.waitForTimeout(150);
  const closedViaButton = await page.getAttribute('.task-row[data-task-id="t1"] .subtasks-badge', "class");
  console.log("The panel's own Close button also clears the badge's open state:", !/\bopen\b/.test(closedViaButton) ? "PASS" : "FAIL (" + closedViaButton + ")");

  // Adding a subtask and checking it off doesn't disturb the open/chevron state
  await page.click('.task-row[data-task-id="t1"] .subtasks-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .subtasks-editor', { timeout: 5000 });
  await page.click('.task-row[data-task-id="t1"] .subtask-item[data-subtask-id="st1"] .subtask-check');
  await page.waitForTimeout(150);
  const stillOpenAfterCheck = await page.getAttribute('.task-row[data-task-id="t1"] .subtasks-badge', "class");
  console.log("Checking off a subtask keeps the panel's open state (badge refresh doesn't lose it):", /\bopen\b/.test(stillOpenAfterCheck) ? "PASS" : "FAIL (" + stillOpenAfterCheck + ")");
  const stillHasChevron = await page.locator('.task-row[data-task-id="t1"] .subtasks-badge .subtask-chevron').count();
  console.log("...and the chevron itself is still there after the badge content refreshes:", stillHasChevron === 1 ? "PASS" : "FAIL");
  await page.click('.task-row[data-task-id="t1"] .subtasks-badge'); // close for the next block

  // --- A second disclosure arrow sits next to the task title itself ---
  const rowToggleCount = await page.locator('.task-row[data-task-id="t1"] .task-subtask-toggle').count();
  console.log("A task with subtasks shows a disclosure arrow next to its title:", rowToggleCount === 1 ? "PASS" : "FAIL");
  const noToggleOnEmptyTask = await page.locator('.task-row[data-task-id="t2"] .task-subtask-toggle').count();
  console.log("A task with no subtasks shows no such arrow:", noToggleOnEmptyTask === 0 ? "PASS" : "FAIL");

  // Clicking the row-level arrow opens the same panel as the badge
  await page.click('.task-row[data-task-id="t1"] .task-subtask-toggle');
  await page.waitForSelector('.task-row[data-task-id="t1"] .subtasks-editor', { timeout: 5000 });
  const bothMarkedOpen = await page.evaluate(() => {
    const row = document.querySelector('.task-row[data-task-id="t1"]');
    return row.querySelector(".subtasks-badge").classList.contains("open") && row.querySelector(".task-subtask-toggle").classList.contains("open");
  });
  console.log("Clicking the row-level arrow opens the panel and both arrows show open state:", bothMarkedOpen ? "PASS" : "FAIL");

  // Clicking it again closes the panel and clears both open states
  await page.click('.task-row[data-task-id="t1"] .task-subtask-toggle');
  await page.waitForTimeout(150);
  const bothClosed = await page.evaluate(() => {
    const row = document.querySelector('.task-row[data-task-id="t1"]');
    const badgeOpen = row.querySelector(".subtasks-badge").classList.contains("open");
    const toggleOpen = row.querySelector(".task-subtask-toggle").classList.contains("open");
    return !badgeOpen && !toggleOpen;
  });
  const editorGoneAfterToggleClose = await page.locator('.task-row[data-task-id="t1"] .subtasks-editor').count();
  console.log("Clicking the row-level arrow again closes the panel:", editorGoneAfterToggleClose === 0 ? "PASS" : "FAIL");
  console.log("...and clears the open state on both arrows:", bothClosed ? "PASS" : "FAIL");

  // The arrow appears live (no full re-render) the moment a task's first subtask is added
  await page.click('.task-row[data-task-id="t2"] .subtasks-badge');
  await page.waitForSelector('.task-row[data-task-id="t2"] .subtasks-editor', { timeout: 5000 });
  await page.fill('.task-row[data-task-id="t2"] .subtask-add-input', "First subtask");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  const toggleAppearsLive = await page.locator('.task-row[data-task-id="t2"] .task-subtask-toggle').count();
  console.log("Adding a first subtask makes the row-level arrow appear immediately:", toggleAppearsLive === 1 ? "PASS" : "FAIL");

  // ...and disappears again once the last subtask is removed
  await page.locator('.task-row[data-task-id="t2"] .subtask-remove').click();
  await page.waitForTimeout(150);
  const toggleGoneAfterRemoveLast = await page.locator('.task-row[data-task-id="t2"] .task-subtask-toggle').count();
  console.log("Removing the last subtask makes the row-level arrow disappear again:", toggleGoneAfterRemoveLast === 0 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

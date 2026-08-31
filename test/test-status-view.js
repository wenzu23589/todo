const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// The Status tab shows every task and subtask grouped into three columns — Not started,
// In progress, Done — by its OWN status. A task appears as a full card in the column
// matching its own status; a subtask whose status differs from its parent's shows nested
// under a dimmed "context-only" reference to the parent, in the subtask's own column.
// Archived and deleted tasks are excluded entirely.

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": {
      headings: [
        {
          id: "h1", title: "Work", color: "#a8672a",
          tasks: [
            { id: "t1", text: "Not started task", done: false, due: null, status: "not_started", notes: "", checklist: [], subtasks: [] },
            { id: "t2", text: "In progress task", done: false, due: { date: "2026-09-03", allDay: true }, status: "in_progress", notes: "", checklist: [], subtasks: [] },
            { id: "t3", text: "Done task", done: true, due: null, status: "done", notes: "", checklist: [], subtasks: [] },
            { id: "t4", text: "Overdue high-priority task", done: false, due: { date: "2020-01-01", allDay: true }, status: "not_started", priority: "high", notes: "", checklist: [], subtasks: [] },
            // Own status differs from a subtask's — should appear in two columns.
            { id: "t5", text: "Mixed-status parent", done: false, due: null, status: "not_started", notes: "", checklist: [], subtasks: [
              { id: "st1", text: "Matches parent status", status: "not_started", done: false, due: null },
              { id: "st2", text: "Ahead of its parent", status: "in_progress", done: false, due: null }
            ] },
            // Archived — should be excluded from the board entirely, even though it's done.
            { id: "t6", text: "Archived done task", done: true, archivedAt: "2026-01-01T00:00:00.000Z", due: null, status: "done", notes: "", checklist: [], subtasks: [] },
            // Deleted — should also be excluded entirely.
            { id: "t7", text: "Deleted task", done: false, deletedAt: "2026-01-01T00:00:00.000Z", due: null, status: "not_started", notes: "", checklist: [], subtasks: [] }
          ],
          subheadings: [
            { id: "sh1", title: "Errands", collapsed: false, collapsedDefaultApplied: true, tasks: [
              { id: "t8", text: "Sub-heading task", done: false, due: null, status: "not_started", notes: "", checklist: [], subtasks: [] }
            ], notesList: [], attachments: [] }
          ]
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
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: b64(repoFiles[filePath]), sha, encoding: "base64" }) });
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

  console.log("Status tab exists in the header:", await page.locator("#tab-status").count() === 1 ? "PASS" : "FAIL");
  console.log("List view showing before switching tabs:", await page.locator("#list-view").isHidden() ? "FAIL" : "PASS");

  await page.click("#tab-status");
  await page.waitForSelector(".board", { timeout: 5000 });
  console.log("Clicking Status hides the List view:", await page.locator("#list-view").isHidden() ? "PASS" : "FAIL");
  console.log("Status tab is marked active:", await page.getAttribute("#tab-status", "class").then(c => /\bactive\b/.test(c)) ? "PASS" : "FAIL");
  console.log("Three columns render:", await page.locator(".board-col").count() === 3 ? "PASS" : "FAIL");

  const notStartedCol = page.locator(".board-col").nth(0);
  const inProgressCol = page.locator(".board-col").nth(1);
  const doneCol = page.locator(".board-col").nth(2);

  console.log("Not started column has the right title:", await notStartedCol.locator(".board-col-title").textContent().then(t => t.trim() === "Not started") ? "PASS" : "FAIL");
  console.log("In progress column has the right title:", await inProgressCol.locator(".board-col-title").textContent().then(t => t.trim() === "In progress") ? "PASS" : "FAIL");
  console.log("Done column has the right title:", await doneCol.locator(".board-col-title").textContent().then(t => t.trim() === "Done") ? "PASS" : "FAIL");

  console.log("A not-started task shows in the Not started column:",
    await notStartedCol.locator(".board-card-title", { hasText: "Not started task" }).count() === 1 ? "PASS" : "FAIL");
  console.log("An in-progress task shows in the In progress column:",
    await inProgressCol.locator(".board-card-title", { hasText: "In progress task" }).count() === 1 ? "PASS" : "FAIL");
  console.log("A done task shows in the Done column:",
    await doneCol.locator(".board-card-title", { hasText: "Done task" }).count() === 1 ? "PASS" : "FAIL");
  console.log("Done task's title has strikethrough styling:",
    await doneCol.locator(".board-card", { has: page.locator(".board-card-title", { hasText: "Done task" }) }).evaluate(el => el.classList.contains("done")) ? "PASS" : "FAIL");

  console.log("A sub-heading task shows with a heading > sub-heading breadcrumb:",
    await notStartedCol.locator(".board-card-path", { hasText: "Errands" }).count() === 1 ? "PASS" : "FAIL");

  console.log("An overdue task's due pill gets the overdue style:",
    await notStartedCol.locator(".board-card", { has: page.locator(".board-card-title", { hasText: "Overdue high-priority task" }) }).locator(".pill.overdue").count() === 1 ? "PASS" : "FAIL");
  console.log("...and its priority pill shows too:",
    await notStartedCol.locator(".board-card", { has: page.locator(".board-card-title", { hasText: "Overdue high-priority task" }) }).locator(".pill.high").count() === 1 ? "PASS" : "FAIL");

  console.log("Archived done tasks are excluded from the board entirely:",
    await page.locator(".board-card-title", { hasText: "Archived done task" }).count() === 0 ? "PASS" : "FAIL");
  console.log("Deleted tasks are excluded from the board entirely:",
    await page.locator(".board-card-title", { hasText: "Deleted task" }).count() === 0 ? "PASS" : "FAIL");

  // --- Mixed-status parent/subtask: the parent appears in both its own column and its subtask's ---
  const parentInNotStarted = notStartedCol.locator(".board-card", { has: page.locator(".board-card-title", { hasText: "Mixed-status parent" }) });
  console.log("The mixed-status parent has a full (non-dimmed) card in its own column:",
    await parentInNotStarted.evaluate(el => !el.classList.contains("context-only")) ? "PASS" : "FAIL");
  console.log("...showing its matching (not-started) subtask nested underneath:",
    await parentInNotStarted.locator(".board-subtask-title", { hasText: "Matches parent status" }).count() === 1 ? "PASS" : "FAIL");
  console.log("...but not its in-progress subtask (that one lives in the other column):",
    await parentInNotStarted.locator(".board-subtask-title", { hasText: "Ahead of its parent" }).count() === 0 ? "PASS" : "FAIL");

  const parentInProgress = inProgressCol.locator(".board-card", { has: page.locator(".board-card-title", { hasText: "Mixed-status parent" }) });
  console.log("The same parent also shows in the In progress column, for context:",
    await parentInProgress.count() === 1 ? "PASS" : "FAIL");
  console.log("...dimmed (context-only), since the task itself isn't in progress:",
    await parentInProgress.evaluate(el => el.classList.contains("context-only")) ? "PASS" : "FAIL");
  console.log("...showing only its in-progress subtask nested underneath:",
    await parentInProgress.locator(".board-subtask-title").count() === 1 && await parentInProgress.locator(".board-subtask-title", { hasText: "Ahead of its parent" }).count() === 1 ? "PASS" : "FAIL");

  // --- Column counts ---
  const notStartedCount = await notStartedCol.locator(".board-col-count").textContent();
  // 4 own-status tasks (t1, t4, t5, t8) + 1 matching subtask (st1) = 5
  console.log("Not started column count reflects tasks + matching subtasks:", notStartedCount.trim() === "5" ? "PASS" : "FAIL (" + notStartedCount + ")");

  // --- Clicking a card's status control cycles it and moves it to the right column ---
  await notStartedCol.locator(".board-card", { has: page.locator(".board-card-title", { hasText: "Not started task" }) }).locator(".check").click();
  await page.waitForTimeout(150);
  console.log("Clicking a card's status moves it out of Not started:",
    await notStartedCol.locator(".board-card-title", { hasText: "Not started task" }).count() === 0 ? "PASS" : "FAIL");
  console.log("...and into In progress:",
    await inProgressCol.locator(".board-card-title", { hasText: "Not started task" }).count() === 1 ? "PASS" : "FAIL");

  await page.waitForTimeout(1500);
  const savedT1 = repoFiles["data/tasks.json"].headings[0].tasks.filter(t => t.id === "t1")[0];
  console.log("The status change persists to storage:", savedT1.status === "in_progress" ? "PASS" : "FAIL (" + JSON.stringify(savedT1) + ")");

  // --- Clicking a nested subtask's status cycles just that subtask ---
  await page.waitForSelector('.board-card .board-subtask', { timeout: 5000 });
  const st1Row = page.locator(".board-subtask", { has: page.locator(".board-subtask-title", { hasText: "Matches parent status" }) }).first();
  await st1Row.locator(".check").click();
  await page.waitForTimeout(1500);
  const savedT5 = repoFiles["data/tasks.json"].headings[0].tasks.filter(t => t.id === "t5")[0];
  const savedSt1 = savedT5.subtasks.filter(s => s.id === "st1")[0];
  console.log("Clicking a nested subtask's status persists just that subtask:", savedSt1.status === "in_progress" ? "PASS" : "FAIL (" + JSON.stringify(savedSt1) + ")");
  console.log("...without touching its parent task's own status:", savedT5.status === "not_started" ? "PASS" : "FAIL (" + savedT5.status + ")");

  // --- Switching back to List view still works and reflects the same state ---
  await page.click("#tab-list");
  await page.waitForTimeout(150);
  console.log("Switching back to List view works:", await page.locator("#list-view").isHidden() ? "FAIL" : "PASS");
  console.log("List view's checkbox for the changed task reflects the new status:",
    await page.locator('.task-row[data-task-id="t1"] .check.status-in_progress').count() === 1 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

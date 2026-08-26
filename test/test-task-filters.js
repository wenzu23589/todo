const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// Dates are relative to a fixed "today" so the test doesn't rot: we compute them
// from the real current date at run time using the same YYYY-MM-DD arithmetic the
// app itself uses (todayDateStr()/addDaysToDateStr()), rather than hardcoding.
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function todayStr() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function addDays(dateStr, days) { var d = new Date(dateStr + "T00:00:00"); d.setDate(d.getDate() + days); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const today = todayStr();
  const yesterday = addDays(today, -1);
  const in3days = addDays(today, 3);
  const in20days = addDays(today, 20);

  const repoFiles = {
    "data/tasks.json": { headings: [
      { id: "h1", title: "Heading A", color: null, tasks: [
        { id: "t1", text: "High, overdue", done: false, priority: "high", due: { date: yesterday, time: null, allDay: true }, subtasks: [] },
        { id: "t2", text: "Medium, due today", done: false, priority: "medium", due: { date: today, time: null, allDay: true }, subtasks: [] },
        { id: "t3", text: "Low, due this week", done: false, priority: "low", due: { date: in3days, time: null, allDay: true }, subtasks: [] },
        { id: "t4", text: "No priority, far future", done: false, priority: null, due: { date: in20days, time: null, allDay: true }, subtasks: [] },
        { id: "t5", text: "No priority, no due date", done: false, priority: null, due: null, subtasks: [] }
      ], subheadings: [] }
    ] }
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
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-2" } }) });
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

  async function visibleTexts() {
    return page.locator(".task-row .task-text").evaluateAll(els => els.map(e => e.value));
  }

  // --- Baseline: all 5 tasks visible, filter buttons inactive ---
  const initial = await visibleTexts();
  console.log("All 5 tasks visible with no filters active:", initial.length === 5 ? "PASS" : "FAIL (" + JSON.stringify(initial) + ")");
  const priBtnActiveInit = await page.locator("#priority-filter-btn").evaluate(el => el.classList.contains("active"));
  const dueBtnActiveInit = await page.locator("#due-filter-btn").evaluate(el => el.classList.contains("active"));
  console.log("Priority filter button starts inactive:", !priBtnActiveInit ? "PASS" : "FAIL");
  console.log("Due date filter button starts inactive:", !dueBtnActiveInit ? "PASS" : "FAIL");

  // The Sort buttons (Priority/Due date) must remain untouched, separate feature
  const sortPriorityExists = await page.locator("#sort-priority-btn").count();
  const sortDueExists = await page.locator("#sort-due-btn").count();
  console.log("Existing Sort:Priority button is untouched:", sortPriorityExists === 1 ? "PASS" : "FAIL");
  console.log("Existing Sort:Due date button is untouched:", sortDueExists === 1 ? "PASS" : "FAIL");

  // --- Priority filter: select High only ---
  await page.click("#priority-filter-btn");
  await page.waitForSelector(".priority-filter-popover", { timeout: 5000 });
  await page.check('.priority-filter-cb[value="high"]');
  await page.waitForTimeout(150);
  const highOnly = await visibleTexts();
  console.log("Priority filter (High) shows only the High task:", JSON.stringify(highOnly) === JSON.stringify(["High, overdue"]) ? "PASS" : "FAIL (" + JSON.stringify(highOnly) + ")");
  const priBtnActive = await page.locator("#priority-filter-btn").evaluate(el => el.classList.contains("active"));
  console.log("Priority filter button shows active state:", priBtnActive ? "PASS" : "FAIL");

  // Add Medium too -> OR logic, both show
  await page.check('.priority-filter-cb[value="medium"]');
  await page.waitForTimeout(150);
  const highOrMedium = await visibleTexts();
  console.log("Priority filter (High OR Medium) shows both:", JSON.stringify(highOrMedium.sort()) === JSON.stringify(["High, overdue", "Medium, due today"].sort()) ? "PASS" : "FAIL (" + JSON.stringify(highOrMedium) + ")");

  // "No priority" checkbox picks up tasks with priority === null
  await page.uncheck('.priority-filter-cb[value="high"]');
  await page.uncheck('.priority-filter-cb[value="medium"]');
  await page.check('.priority-filter-cb[value="none"]');
  await page.waitForTimeout(150);
  const noPriority = await visibleTexts();
  console.log("Priority filter (No priority) shows the two unprioritized tasks:", JSON.stringify(noPriority.sort()) === JSON.stringify(["No priority, far future", "No priority, no due date"].sort()) ? "PASS" : "FAIL (" + JSON.stringify(noPriority) + ")");

  // Clear filter restores all tasks
  await page.click("#priority-filter-clear");
  await page.waitForTimeout(150);
  const afterClear = await visibleTexts();
  console.log("Clearing the priority filter restores all tasks:", afterClear.length === 5 ? "PASS" : "FAIL (" + JSON.stringify(afterClear) + ")");
  await page.click("body");

  // --- Due date filter: presets ---
  await page.click("#due-filter-btn");
  await page.waitForSelector(".due-filter-popover", { timeout: 5000 });
  await page.check('.due-filter-cb[value="overdue"]');
  await page.waitForTimeout(150);
  const overdueOnly = await visibleTexts();
  console.log("Due filter (Overdue) shows only the overdue task:", JSON.stringify(overdueOnly) === JSON.stringify(["High, overdue"]) ? "PASS" : "FAIL (" + JSON.stringify(overdueOnly) + ")");

  await page.check('.due-filter-cb[value="today"]');
  await page.waitForTimeout(150);
  const overdueOrToday = await visibleTexts();
  console.log("Due filter (Overdue OR Due today) shows both:", JSON.stringify(overdueOrToday.sort()) === JSON.stringify(["High, overdue", "Medium, due today"].sort()) ? "PASS" : "FAIL (" + JSON.stringify(overdueOrToday) + ")");

  await page.uncheck('.due-filter-cb[value="overdue"]');
  await page.uncheck('.due-filter-cb[value="today"]');
  await page.check('.due-filter-cb[value="week"]');
  await page.waitForTimeout(150);
  const dueThisWeek = await visibleTexts();
  // "week" = today..today+7, inclusive; matches today's task and the +3 day task, not overdue or +20 day
  console.log("Due filter (Due this week) matches today + the +3 day task:", JSON.stringify(dueThisWeek.sort()) === JSON.stringify(["Medium, due today", "Low, due this week"].sort()) ? "PASS" : "FAIL (" + JSON.stringify(dueThisWeek) + ")");

  await page.uncheck('.due-filter-cb[value="week"]');
  await page.check('.due-filter-cb[value="none"]');
  await page.waitForTimeout(150);
  const noDueDate = await visibleTexts();
  console.log("Due filter (No due date) shows only the undated task:", JSON.stringify(noDueDate) === JSON.stringify(["No priority, no due date"]) ? "PASS" : "FAIL (" + JSON.stringify(noDueDate) + ")");
  await page.uncheck('.due-filter-cb[value="none"]');

  // --- Due date filter: custom range covering the +20 day task only ---
  const rangeFrom = addDays(today, 10);
  const rangeTo = addDays(today, 25);
  await page.fill(".due-filter-from", rangeFrom);
  await page.waitForTimeout(100);
  await page.fill(".due-filter-to", rangeTo);
  await page.waitForTimeout(150);
  const rangeOnly = await visibleTexts();
  console.log("Custom date range filters to just the task inside that range:", JSON.stringify(rangeOnly) === JSON.stringify(["No priority, far future"]) ? "PASS" : "FAIL (" + JSON.stringify(rangeOnly) + ")");
  const dueBtnActive = await page.locator("#due-filter-btn").evaluate(el => el.classList.contains("active"));
  console.log("Due date filter button shows active state:", dueBtnActive ? "PASS" : "FAIL");

  // Presets and range combine with OR: adding "overdue" back should add that task too
  await page.check('.due-filter-cb[value="overdue"]');
  await page.waitForTimeout(150);
  const rangeOrOverdue = await visibleTexts();
  console.log("Custom range OR a preset combine (union, not intersection):", JSON.stringify(rangeOrOverdue.sort()) === JSON.stringify(["No priority, far future", "High, overdue"].sort()) ? "PASS" : "FAIL (" + JSON.stringify(rangeOrOverdue) + ")");

  // Clear due filter restores all tasks
  await page.click("#due-filter-clear");
  await page.waitForTimeout(150);
  const afterDueClear = await visibleTexts();
  console.log("Clearing the due date filter restores all tasks:", afterDueClear.length === 5 ? "PASS" : "FAIL (" + JSON.stringify(afterDueClear) + ")");
  await page.click("body");

  // --- Priority and due filters combine (AND) when both active ---
  await page.click("#priority-filter-btn");
  await page.waitForSelector(".priority-filter-popover", { timeout: 5000 });
  await page.check('.priority-filter-cb[value="low"]');
  await page.waitForTimeout(150);
  await page.click("body");
  await page.click("#due-filter-btn");
  await page.waitForSelector(".due-filter-popover", { timeout: 5000 });
  await page.check('.due-filter-cb[value="week"]');
  await page.waitForTimeout(150);
  const lowAndThisWeek = await visibleTexts();
  console.log("Priority filter AND due filter combine (both must match):", JSON.stringify(lowAndThisWeek) === JSON.stringify(["Low, due this week"]) ? "PASS" : "FAIL (" + JSON.stringify(lowAndThisWeek) + ")");
  await page.click("body");

  // Reset both filters
  await page.click("#priority-filter-btn");
  await page.waitForSelector(".priority-filter-popover", { timeout: 5000 });
  await page.click("#priority-filter-clear");
  await page.click("body");
  await page.click("#due-filter-btn");
  await page.waitForSelector(".due-filter-popover", { timeout: 5000 });
  await page.click("#due-filter-clear");
  await page.click("body");
  await page.waitForTimeout(150);

  // --- Filters are session-only: reload clears them (same as the existing tag filter) ---
  await page.click("#priority-filter-btn");
  await page.waitForSelector(".priority-filter-popover", { timeout: 5000 });
  await page.check('.priority-filter-cb[value="high"]');
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const afterReload = await visibleTexts();
  console.log("Filters are session-only and reset on reload:", afterReload.length === 5 ? "PASS" : "FAIL (" + JSON.stringify(afterReload) + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

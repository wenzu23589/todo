const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// Dates are computed relative to the real current date, using the same Mon–Sun
// week math the app itself uses (mondayOfWeek), so this test never rots.
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function dateStr(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function mondayOfWeek(d) { var r = new Date(d); var day = (r.getDay() + 6) % 7; r.setDate(r.getDate() - day); return r; }
function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const today = new Date();
  const monday = mondayOfWeek(today);
  const sunday = addDays(monday, 6);
  const nextMonday = addDays(monday, 7);
  const todayDateOnly = dateStr(today);
  const mondayStr = dateStr(monday);
  const wednesdayStr = dateStr(addDays(monday, 2));
  const sundayStr = dateStr(sunday);
  const nextMondayStr = dateStr(nextMonday);

  const repoFiles = {
    "data/tasks.json": { headings: [
      { id: "h1", title: "Work", color: null, tasks: [
        { id: "t1", text: "Due today", done: false, priority: null, due: { date: todayDateOnly, time: null, allDay: true }, subtasks: [] },
        { id: "t2", text: "Due Monday this week", done: false, priority: null, due: { date: mondayStr, time: null, allDay: true }, subtasks: [] },
        { id: "t3", text: "Due Sunday this week", done: false, priority: null, due: { date: sundayStr, time: "09:00", allDay: false }, subtasks: [] },
        { id: "t4", text: "Already done, due Wednesday", done: true, priority: null, due: { date: wednesdayStr, time: null, allDay: true }, subtasks: [] },
        { id: "t5", text: "Due next week (out of range)", done: false, priority: null, due: { date: nextMondayStr, time: null, allDay: true }, subtasks: [] },
        { id: "t6", text: "No due date at all", done: false, priority: null, due: null, subtasks: [] }
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
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      const decoded = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
      repoFiles[filePath] = decoded;
      shas[filePath] = "sha-" + Math.random();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: shas[filePath] } }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
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

  console.log("List view is showing before switching tabs:", await page.locator("#list-view").isHidden() === false ? "PASS" : "FAIL");

  await page.click("#tab-week");
  await page.waitForSelector("#week-view .week-view-head", { timeout: 5000 });
  console.log("Clicking 'This week' hides the List view:", await page.locator("#list-view").isHidden() ? "PASS" : "FAIL");
  console.log("'This week' tab is marked active:", await page.locator("#tab-week").evaluate(el => el.classList.contains("active")) ? "PASS" : "FAIL");

  async function dayTexts(dayLabelSubstring) {
    const section = page.locator(".week-day-section", { hasText: dayLabelSubstring });
    return section.locator(".task-row .task-text").evaluateAll(els => els.map(e => e.value));
  }

  const todayTexts = await dayTexts(new Date().toLocaleDateString(undefined, { weekday: "long" }));
  console.log("Today's day section shows the task due today:", todayTexts.includes("Due today") ? "PASS" : "FAIL (" + JSON.stringify(todayTexts) + ")");

  const todaySection = page.locator(".week-day-section.week-day-today");
  console.log("Exactly one day section is marked as today:", await page.locator(".week-day-section.week-day-today").count() === 1 ? "PASS" : "FAIL");
  console.log("Today's section shows a 'Today' tag:", await todaySection.locator(".week-day-today-tag").count() === 1 ? "PASS" : "FAIL");

  // .task-text is an <input> — its title lives in the `value` attribute, not as a
  // text node, so innerText() would never see it. Read values directly instead.
  const allWeekTitles = await page.locator("#week-view .task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Task due Monday this week is shown:", allWeekTitles.includes("Due Monday this week") ? "PASS" : "FAIL (" + JSON.stringify(allWeekTitles) + ")");
  console.log("Task due Sunday this week is shown:", allWeekTitles.includes("Due Sunday this week") ? "PASS" : "FAIL (" + JSON.stringify(allWeekTitles) + ")");
  console.log("Completed task is excluded even though its due date is this week:", !allWeekTitles.includes("Already done, due Wednesday") ? "PASS" : "FAIL");
  console.log("Task due next week (outside this Mon–Sun) is excluded:", !allWeekTitles.includes("Due next week (out of range)") ? "PASS" : "FAIL");
  console.log("Task with no due date at all is excluded:", !allWeekTitles.includes("No due date at all") ? "PASS" : "FAIL");

  const rangeLabel = await page.locator(".week-view-range").textContent();
  const mondayShortMonth = monday.toLocaleDateString(undefined, { month: "short" });
  console.log("Week range label mentions the week's starting month:", rangeLabel.indexOf(mondayShortMonth) !== -1 ? "PASS" : "FAIL (" + rangeLabel + ")");

  // Checking off a task from within the week view should work exactly like elsewhere —
  // and, same as the Today view, a task that's now done drops out of its day bucket
  // immediately (this view only ever shows what's still outstanding), so we confirm
  // via the row disappearing rather than waiting for the checkbox to stay checked.
  await page.click('.week-day-section.week-day-today .task-row[data-task-id="t1"] .check');
  await page.waitForSelector('.week-day-section.week-day-today .task-row[data-task-id="t1"]', { state: "detached", timeout: 5000 });
  console.log("Checking off a task from the week view removes it from its day bucket:", "PASS");
  await page.waitForTimeout(1500);
  const savedTask1 = repoFiles["data/tasks.json"].headings[0].tasks.find(t => t.id === "t1");
  console.log("Checking off a task from the week view persists to storage:", savedTask1 && savedTask1.done === true ? "PASS" : "FAIL");

  // --- Empty week: a fresh heading with nothing due this week ---
  const repoFiles2 = { "data/tasks.json": { headings: [
    { id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Far future task", done: false, priority: null, due: { date: dateStr(addDays(monday, 30)), time: null, allDay: true }, subtasks: [] }
    ], subheadings: [] }
  ] } };
  const shas2 = {};
  const page2 = await browser.newPage();
  await page2.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!m) return route.fulfill({ status: 404, body: "{}" });
    const filePath = decodeURIComponent(m[3]);
    if (req.method() === "GET") {
      if (repoFiles2[filePath] === undefined) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
      const sha = shas2[filePath] || "sha-1"; shas2[filePath] = sha;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: b64(repoFiles2[filePath]), sha: sha, encoding: "base64" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-2" } }) });
  });
  await page2.goto(HTML_PATH);
  await page2.waitForSelector("#modal-root .modal-box", { timeout: 5000 });
  await page2.fill("#f-owner", "wenzu23589");
  await page2.fill("#f-repo", "todo");
  await page2.fill("#f-branch", "main");
  await page2.fill("#f-path", "data/tasks.json");
  await page2.fill("#f-token", "fake-pat-token");
  await page2.click("#settings-save");
  await page2.waitForSelector("#modal-root .modal-box", { state: "detached", timeout: 5000 });
  await page2.click("#tab-week");
  await page2.waitForSelector("#week-view .empty-state", { timeout: 5000 });
  console.log("A week with nothing due shows the empty state (no day-section boxes):", await page2.locator(".week-day-section").count() === 0 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });

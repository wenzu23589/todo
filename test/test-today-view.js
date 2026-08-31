const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const today = new Date();
  const todayStr = ymd(today);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = ymd(yesterday);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = ymd(tomorrow);

  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t-overdue", text: "Overdue task", done: false, priority: null, due: { date: yesterdayStr, time: null, allDay: true }, subtasks: [] },
      { id: "t-today", text: "Due today task", done: false, priority: null, due: { date: todayStr, time: null, allDay: true }, subtasks: [] },
      { id: "t-flagged", text: "Flagged task", done: false, priority: "high", due: null, subtasks: [] },
      { id: "t-future", text: "Future task, not flagged", done: false, priority: null, due: { date: tomorrowStr, time: null, allDay: true }, subtasks: [] },
      { id: "t-done-overdue", text: "Done but technically overdue", done: true, priority: null, due: { date: yesterdayStr, time: null, allDay: true }, subtasks: [] },
      { id: "t-overdue-flagged", text: "Overdue AND flagged", done: false, priority: "high", due: { date: yesterdayStr, time: null, allDay: true }, subtasks: [] }
    ], subheadings: [
      { id: "s1", title: "Sub A", collapsed: false, tasks: [
        { id: "t-sub-today", text: "Sub task due today", done: false, priority: null, due: { date: todayStr, time: null, allDay: true }, subtasks: [] }
      ] }
    ] }] }
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

  await page.click("#tab-today");
  await page.waitForSelector("#today-view .today-section", { timeout: 5000 });
  const listHidden = await page.locator("#list-view").isHidden();
  console.log("Switching to Today tab hides the List view:", listHidden ? "PASS" : "FAIL");
  const tabActive = await page.getAttribute("#tab-today", "class");
  console.log("Today tab shows as active:", /\bactive\b/.test(tabActive) ? "PASS" : "FAIL (" + tabActive + ")");

  // Overdue section: overdue task + overdue-and-flagged task (shown once, not duplicated in Flagged)
  const overdueSection = page.locator(".today-section", { has: page.locator(".today-section-title", { hasText: "Overdue" }) });
  const overdueIds = await overdueSection.locator(".task-row").evaluateAll(els => els.map(e => e.getAttribute("data-task-id")));
  console.log("Overdue section has exactly the 2 overdue, undone tasks:", JSON.stringify(overdueIds.sort()) === JSON.stringify(["t-overdue", "t-overdue-flagged"].sort()) ? "PASS" : "FAIL (" + JSON.stringify(overdueIds) + ")");

  // Due today section: includes the top-level task AND the sub-heading task
  const dueTodaySection = page.locator(".today-section", { has: page.locator(".today-section-title", { hasText: "Due today" }) });
  const dueTodayIds = await dueTodaySection.locator(".task-row").evaluateAll(els => els.map(e => e.getAttribute("data-task-id")));
  console.log("Due today section has both the top-level and sub-heading tasks due today:", JSON.stringify(dueTodayIds.sort()) === JSON.stringify(["t-sub-today", "t-today"].sort()) ? "PASS" : "FAIL (" + JSON.stringify(dueTodayIds) + ")");

  // Flagged section: only t-flagged (not the overdue-and-flagged one, which already appeared above; not the undone-but-not-flagged ones)
  const flaggedSection = page.locator(".today-section", { has: page.locator(".today-section-title", { hasText: "Flagged" }) });
  const flaggedIds = await flaggedSection.locator(".task-row").evaluateAll(els => els.map(e => e.getAttribute("data-task-id")));
  console.log("Flagged section has only the high-priority task not already shown above:", JSON.stringify(flaggedIds) === JSON.stringify(["t-flagged"]) ? "PASS" : "FAIL (" + JSON.stringify(flaggedIds) + ")");

  // Done tasks and future/unflagged tasks never appear anywhere in the Today view
  const allTodayIds = await page.locator("#today-view .task-row").evaluateAll(els => els.map(e => e.getAttribute("data-task-id")));
  console.log("Done and future/unflagged tasks are excluded entirely:", !allTodayIds.includes("t-done-overdue") && !allTodayIds.includes("t-future") ? "PASS" : "FAIL (" + JSON.stringify(allTodayIds) + ")");
  console.log("No task appears twice across sections:", new Set(allTodayIds).size === allTodayIds.length ? "PASS" : "FAIL (" + JSON.stringify(allTodayIds) + ")");

  // Breadcrumb path label shows the sub-heading's chain
  const subPath = await page.locator('.today-task-wrap:has(.task-row[data-task-id="t-sub-today"]) .today-task-path').textContent();
  console.log("Sub-heading task shows a heading > sub-heading breadcrumb:", /Work/.test(subPath) && /Sub A/.test(subPath) ? "PASS" : "FAIL (" + subPath + ")");

  // Drag grips are hidden in the Today view
  const gripVisible = await page.locator("#today-view .grip").first().isVisible();
  console.log("Drag grips are hidden in the Today view:", gripVisible ? "FAIL" : "PASS");

  // Reused row is fully interactive: checking a task off in Today view persists and removes it from view.
  // The status control now cycles not started -> in progress -> done, so it takes two clicks.
  await page.click('#today-view .task-row[data-task-id="t-today"] .check');
  await page.waitForTimeout(150);
  await page.click('#today-view .task-row[data-task-id="t-today"] .check');
  await page.waitForTimeout(1500);
  const stillThere = await page.locator('#today-view .task-row[data-task-id="t-today"]').count();
  console.log("Checking off a task in Today view removes it from the view:", stillThere === 0 ? "PASS" : "FAIL");
  const savedTask = repoFiles["data/tasks.json"].headings[0].tasks.find(t => t.id === "t-today");
  console.log("Checking off in Today view persists to storage:", savedTask.done === true ? "PASS" : "FAIL");

  // Empty state: clear everything relevant, revisit Today
  await page.click("#tab-list");
  await page.waitForSelector(".task-row");
  await browser.close();

  // Second pass with a repo that has nothing overdue/due-today/flagged
  const browser2 = await chromium.launch();
  const page2 = await browser2.newPage();
  const emptyRepoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Someday task", done: false, priority: null, due: null, subtasks: [] }
    ], subheadings: [] }] }
  };
  const shas2 = {};
  await page2.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!m) return route.fulfill({ status: 404, body: "{}" });
    const filePath = decodeURIComponent(m[3]);
    if (req.method() === "GET") {
      if (emptyRepoFiles[filePath] === undefined) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
      const sha = shas2[filePath] || "sha-1"; shas2[filePath] = sha;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: b64(emptyRepoFiles[filePath]), sha: sha, encoding: "base64" }) });
    }
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      emptyRepoFiles[filePath] = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
      shas2[filePath] = "sha-" + Math.random();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: shas2[filePath] } }) });
    }
    return route.fulfill({ status: 404, body: "{}" });
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
  await page2.waitForSelector(".task-row", { timeout: 5000 });
  await page2.click("#tab-today");
  await page2.waitForSelector("#today-view .empty-state", { timeout: 5000 });
  const noSections = await page2.locator("#today-view .today-section").count();
  console.log("Empty state shown (and no section boxes) when nothing is overdue/due-today/flagged:", noSections === 0 ? "PASS" : "FAIL");
  await browser2.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

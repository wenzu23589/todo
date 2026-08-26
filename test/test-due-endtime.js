const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = { "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
    { id: "t1", text: "Client call", done: false, due: null, subtasks: [] }
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

  // Open the due editor: an end-time field should be present alongside the start time
  await page.click('.task-row[data-task-id="t1"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .due-editor', { timeout: 5000 });
  const endTimeFieldCount = await page.locator('.task-row[data-task-id="t1"] .due-editor .due-time-end').count();
  console.log("Due editor offers an end-time field alongside the start time:", endTimeFieldCount === 1 ? "PASS" : "FAIL");

  // Set date + start time only, leave end blank — no range shown
  await page.fill('.task-row[data-task-id="t1"] .due-editor input[type="date"]', "2026-09-05");
  await page.fill('.task-row[data-task-id="t1"] .due-editor .due-time-start', "10:00");
  await page.click('.task-row[data-task-id="t1"] .due-editor [data-act="save"]');
  await page.waitForTimeout(200);
  const badgeStartOnly = await page.locator('.task-row[data-task-id="t1"] .due-badge').textContent();
  console.log("Start time with no end shows just the start time (no dash):", /10:00/.test(badgeStartOnly) && !/–/.test(badgeStartOnly) ? "PASS" : "FAIL (" + badgeStartOnly + ")");
  await page.waitForTimeout(1300);

  // Reopen, now set an end time
  await page.click('.task-row[data-task-id="t1"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .due-editor', { timeout: 5000 });
  const startValueOnReopen = await page.locator('.task-row[data-task-id="t1"] .due-editor .due-time-start').inputValue();
  console.log("Reopening the editor keeps the previously-set start time:", startValueOnReopen === "10:00" ? "PASS" : "FAIL (" + startValueOnReopen + ")");
  await page.fill('.task-row[data-task-id="t1"] .due-editor .due-time-end', "11:30");
  await page.click('.task-row[data-task-id="t1"] .due-editor [data-act="save"]');
  await page.waitForTimeout(200);
  const badgeWithRange = await page.locator('.task-row[data-task-id="t1"] .due-badge').textContent();
  console.log("Setting an end time shows a start–end range on the badge:", /10:00/.test(badgeWithRange) && /11:30/.test(badgeWithRange) && /–/.test(badgeWithRange) ? "PASS" : "FAIL (" + badgeWithRange + ")");
  await page.waitForTimeout(1300);
  const savedRange = repoFiles["data/tasks.json"].headings[0].tasks[0].due;
  console.log("Both start and end time persist to storage:", savedRange.time === "10:00" && savedRange.endTime === "11:30" ? "PASS" : "FAIL (" + JSON.stringify(savedRange) + ")");

  // An end time before the start time is ignored rather than accepted
  await page.click('.task-row[data-task-id="t1"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .due-editor', { timeout: 5000 });
  await page.fill('.task-row[data-task-id="t1"] .due-editor .due-time-start', "14:00");
  await page.fill('.task-row[data-task-id="t1"] .due-editor .due-time-end', "13:00");
  await page.click('.task-row[data-task-id="t1"] .due-editor [data-act="save"]');
  await page.waitForTimeout(1300);
  const afterInvalidRange = repoFiles["data/tasks.json"].headings[0].tasks[0].due;
  console.log("An end time earlier than the start time is ignored, not saved:", afterInvalidRange.time === "14:00" && afterInvalidRange.endTime === null ? "PASS" : "FAIL (" + JSON.stringify(afterInvalidRange) + ")");

  // Checking "All day" disables both time fields
  await page.click('.task-row[data-task-id="t1"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .due-editor', { timeout: 5000 });
  await page.check('.task-row[data-task-id="t1"] .due-editor input[type="checkbox"]');
  const startDisabled = await page.locator('.task-row[data-task-id="t1"] .due-editor .due-time-start').isDisabled();
  const endDisabled = await page.locator('.task-row[data-task-id="t1"] .due-editor .due-time-end').isDisabled();
  console.log("Checking All day disables both the start and end time fields:", startDisabled && endDisabled ? "PASS" : "FAIL");

  // Survives reload
  await page.click('.task-row[data-task-id="t1"] .due-editor [data-act="close"]');
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const badgeAfterReload = await page.locator('.task-row[data-task-id="t1"] .due-badge').textContent();
  // Note: the "All day" checkbox above was checked but not saved (closed instead),
  // and the last successful save left this task at a 2:00 PM start with no end time
  // (the 14:00/13:00 attempt just above was invalid and got ignored) — so the reload
  // should show that plain start time, no range.
  console.log("Time persists across reload:", /2:00 PM/.test(badgeAfterReload) && !/–/.test(badgeAfterReload) ? "PASS" : "FAIL (" + badgeAfterReload + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

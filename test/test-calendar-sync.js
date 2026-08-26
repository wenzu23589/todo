const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const repoFiles = { "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
    { id: "t-allday", text: "All day task", done: false, due: null, subtasks: [] },
    { id: "t-range", text: "Ranged task", done: false, due: null, subtasks: [] },
    { id: "t-open", text: "Open-ended task", done: false, due: null, subtasks: [] }
  ], subheadings: [] }] } };
  const shas = {};

  await page.addInitScript(() => {
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: function (cfg) {
            const client = { callback: cfg.callback };
            client.requestAccessToken = function () {
              setTimeout(function () { client.callback({ access_token: "fake-token", expires_in: 3600 }); }, 10);
            };
            return client;
          }
        }
      }
    };
  });

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

  const calendarEvents = {};
  let nextEventId = 1;
  const createdBodies = []; // capture every POST body, in order, for direct inspection

  await page.route("https://www.googleapis.com/calendar/v3/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.includes("/users/me/calendarList")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "primary", summary: "To Do", backgroundColor: "#4a5fc1" }] }) });
    }
    const m = url.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (m) {
      if (req.method() === "POST") {
        const body = JSON.parse(req.postData());
        const id = "ev" + (nextEventId++);
        calendarEvents[id] = Object.assign({ id: id, status: "confirmed" }, body);
        createdBodies.push(Object.assign({ id: id }, body));
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(calendarEvents[id]) });
      }
      if (req.method() === "PATCH") {
        const id = m[2];
        const body = JSON.parse(req.postData());
        calendarEvents[id] = Object.assign(calendarEvents[id] || { id: id, status: "confirmed" }, body);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(calendarEvents[id]) });
      }
      if (req.method() === "GET" && !m[2]) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: Object.values(calendarEvents) }) });
      }
      if (req.method() === "DELETE") {
        delete calendarEvents[m[2]];
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
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

  await page.click("#gcal-pill");
  await page.waitForSelector("#f-clientid", { timeout: 5000 });
  await page.fill("#f-clientid", "fake-client-id.apps.googleusercontent.com");
  await page.click("#cal-connect");
  await page.waitForSelector('[data-state="connected"]', { timeout: 5000 });
  await page.click("#cal-cancel");
  await page.waitForSelector("#modal-root .modal-backdrop", { state: "detached", timeout: 5000 });

  // --- Task 1: All-day due date should sync as a 07:00–19:00 timed block ---
  await page.click('.task-row[data-task-id="t-allday"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t-allday"] .due-editor', { timeout: 5000 });
  await page.fill('.task-row[data-task-id="t-allday"] .due-editor input[type="date"]', "2026-09-10");
  await page.check('.task-row[data-task-id="t-allday"] .due-editor input[type="checkbox"]');
  await page.click('.task-row[data-task-id="t-allday"] .due-editor [data-act="save"]');
  await page.waitForTimeout(800);

  const allDayBody = createdBodies.find(b => b.summary === "All day task");
  console.log("All-day task syncs as a timed event (not a genuine all-day event):", allDayBody && allDayBody.start && !!allDayBody.start.dateTime ? "PASS" : "FAIL (" + JSON.stringify(allDayBody) + ")");
  console.log("All-day task's Calendar event starts at 07:00:", allDayBody && /T07:00:00/.test(allDayBody.start.dateTime) ? "PASS" : "FAIL (" + JSON.stringify(allDayBody && allDayBody.start) + ")");
  console.log("All-day task's Calendar event ends at 19:00:", allDayBody && /T19:00:00/.test(allDayBody.end.dateTime) ? "PASS" : "FAIL (" + JSON.stringify(allDayBody && allDayBody.end) + ")");

  const allDayBadgeText = await page.locator('.task-row[data-task-id="t-allday"] .due-badge').textContent();
  console.log("All-day task's own due badge still shows no time (still reads as All day locally):", !/AM|PM/.test(allDayBadgeText) ? "PASS" : "FAIL (" + allDayBadgeText + ")");

  // --- Task 2: an explicit start + end time should sync using that exact range ---
  await page.click('.task-row[data-task-id="t-range"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t-range"] .due-editor', { timeout: 5000 });
  await page.fill('.task-row[data-task-id="t-range"] .due-editor input[type="date"]', "2026-09-10");
  await page.fill('.task-row[data-task-id="t-range"] .due-editor .due-time-start', "14:00");
  await page.fill('.task-row[data-task-id="t-range"] .due-editor .due-time-end', "15:30");
  await page.click('.task-row[data-task-id="t-range"] .due-editor [data-act="save"]');
  await page.waitForTimeout(800);

  const rangeBody = createdBodies.find(b => b.summary === "Ranged task");
  console.log("Task with a set end time syncs start+end exactly as entered:", rangeBody && /T14:00:00/.test(rangeBody.start.dateTime) && /T15:30:00/.test(rangeBody.end.dateTime) ? "PASS" : "FAIL (" + JSON.stringify(rangeBody) + ")");

  const rangeBadgeText = await page.locator('.task-row[data-task-id="t-range"] .due-badge').textContent();
  console.log("Due badge shows the start–end range:", /–/.test(rangeBadgeText) ? "PASS" : "FAIL (" + rangeBadgeText + ")");

  // --- Task 3: start time with no end time falls back to the existing +30min default ---
  await page.click('.task-row[data-task-id="t-open"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t-open"] .due-editor', { timeout: 5000 });
  await page.fill('.task-row[data-task-id="t-open"] .due-editor input[type="date"]', "2026-09-10");
  await page.fill('.task-row[data-task-id="t-open"] .due-editor .due-time-start', "09:00");
  await page.click('.task-row[data-task-id="t-open"] .due-editor [data-act="save"]');
  await page.waitForTimeout(800);

  const openBody = createdBodies.find(b => b.summary === "Open-ended task");
  console.log("Task with only a start time still defaults to a 30-minute block:", openBody && /T09:00:00/.test(openBody.start.dateTime) && /T09:30:00/.test(openBody.end.dateTime) ? "PASS" : "FAIL (" + JSON.stringify(openBody) + ")");

  // --- Round trip: Sync now should NOT flip the all-day task into a timed 7:00 AM task ---
  await page.click("#sync-now-btn");
  await page.waitForTimeout(1000);
  const allDayBadgeAfterSync = await page.locator('.task-row[data-task-id="t-allday"] .due-badge').textContent();
  console.log("After Sync now, the all-day task still shows no time (round trip preserved allDay):", !/AM|PM/.test(allDayBadgeAfterSync) ? "PASS" : "FAIL (" + allDayBadgeAfterSync + ")");
  const savedAllDayTask = repoFiles["data/tasks.json"].headings[0].tasks.find(t => t.id === "t-allday");
  console.log("Saved data still has allDay:true for that task after the round trip:", savedAllDayTask.due.allDay === true ? "PASS" : "FAIL (" + JSON.stringify(savedAllDayTask.due) + ")");

  const rangeBadgeAfterSync = await page.locator('.task-row[data-task-id="t-range"] .due-badge').textContent();
  console.log("Ranged task's badge is unaffected by the round trip:", /–/.test(rangeBadgeAfterSync) && /2:00/.test(rangeBadgeAfterSync) ? "PASS" : "FAIL (" + rangeBadgeAfterSync + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

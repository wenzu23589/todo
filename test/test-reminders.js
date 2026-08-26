const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function dateStr(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function timeStr(d) { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
function plusMinutes(d, m) { return new Date(d.getTime() + m * 60000); }
function dueFrom(d) { return { date: dateStr(d), time: timeStr(d), allDay: false }; }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const now = new Date();
  const repoFiles = {
    "data/tasks.json": { headings: [
      { id: "h1", title: "Work", color: null, tasks: [
        { id: "t1", text: "Standup is starting", done: false, priority: null, due: dueFrom(now), tags: [], notes: "", attachments: [], subtasks: [
          { id: "s1", text: "Post yesterday's update", done: false, due: dueFrom(now) },
          { id: "s2", text: "Already done subtask", done: true, due: dueFrom(now) }
        ] },
        { id: "t2", text: "Not due for hours yet", done: false, priority: null, due: dueFrom(plusMinutes(now, 120)), tags: [], notes: "", attachments: [], subtasks: [] },
        { id: "t3", text: "Way overdue, outside the reminder window", done: false, priority: null, due: dueFrom(plusMinutes(now, -45)), tags: [], notes: "", attachments: [], subtasks: [] },
        { id: "t4", text: "Due now but already checked off", done: true, priority: null, due: dueFrom(now), tags: [], notes: "", attachments: [], subtasks: [] },
        { id: "t5", text: "Due today, all-day (no specific time)", done: false, priority: null, due: { date: dateStr(now), time: null, allDay: true }, tags: [], notes: "", attachments: [], subtasks: [] }
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
  await page.waitForSelector(".reminder-toast", { timeout: 5000 });

  async function toastTitles() {
    return page.locator(".reminder-toast-title").allTextContents();
  }

  const titles = await toastTitles();
  console.log("A task due right now shows a reminder toast:", titles.includes("Standup is starting") ? "PASS" : "FAIL (" + JSON.stringify(titles) + ")");
  console.log("A subtask due right now shows its own reminder toast:", titles.includes("Post yesterday's update") ? "PASS" : "FAIL (" + JSON.stringify(titles) + ")");
  console.log("A done subtask due now does not get a reminder:", !titles.includes("Already done subtask") ? "PASS" : "FAIL");
  console.log("A task due hours from now does not show a reminder yet:", !titles.includes("Not due for hours yet") ? "PASS" : "FAIL");
  console.log("A task overdue well beyond the reminder window does not resurface:", !titles.includes("Way overdue, outside the reminder window") ? "PASS" : "FAIL");
  console.log("A completed task due now does not show a reminder:", !titles.includes("Due now but already checked off") ? "PASS" : "FAIL");
  console.log("An all-day task (no specific time) never gets a time-based reminder:", !titles.includes("Due today, all-day (no specific time)") ? "PASS" : "FAIL");
  console.log("Exactly the two expected reminders are showing, nothing extra:", titles.length === 2 ? "PASS" : "FAIL (" + JSON.stringify(titles) + ")");

  const firstToast = page.locator('.reminder-toast[data-reminder-key="t1"]');
  console.log("The toast shows which heading the task belongs to:", (await firstToast.locator(".reminder-toast-path").textContent()).includes("Work") ? "PASS" : "FAIL");
  console.log("The toast is honest that this only works while the app is open:", (await firstToast.locator(".reminder-toast-time").textContent()).toLowerCase().includes("while daybook is open") ? "PASS" : "FAIL");

  // Dismiss: removes it, and it doesn't come back on the next re-render.
  await firstToast.locator('[data-act="dismiss"]').click();
  await page.waitForSelector('.reminder-toast[data-reminder-key="t1"]', { state: "detached", timeout: 5000 });
  await page.click("#sort-priority-btn"); // any action that triggers render() again
  await page.click("#sort-manual-btn");
  await page.waitForTimeout(200);
  console.log("Dismissing a reminder removes it and it stays gone across re-renders:", await page.locator('.reminder-toast[data-reminder-key="t1"]').count() === 0 ? "PASS" : "FAIL");

  // Snooze: removes it, and it also doesn't come back on the next re-render (since the
  // snooze window hasn't elapsed) — we can't test it reappearing after 5 real minutes,
  // but we CAN test that it's suppressed immediately after snoozing.
  const subtaskToast = page.locator('.reminder-toast[data-reminder-key="t1:s1"]');
  await subtaskToast.locator('[data-snooze="5"]').click();
  await page.waitForSelector('.reminder-toast[data-reminder-key="t1:s1"]', { state: "detached", timeout: 5000 });
  await page.click("#sort-priority-btn");
  await page.click("#sort-manual-btn");
  await page.waitForTimeout(200);
  console.log("Snoozing a reminder removes it and it stays suppressed across re-renders:", await page.locator('.reminder-toast[data-reminder-key="t1:s1"]').count() === 0 ? "PASS" : "FAIL");
  console.log("No reminder toasts remain after dismissing/snoozing both:", await page.locator(".reminder-toast").count() === 0 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });

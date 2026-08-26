const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Dated task", done: false, due: { date: "2026-08-20", time: null, allDay: true } },
      { id: "t2", text: "Undated task", done: false, due: null }
    ], subheadings: [] }] }
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

  // Undated task's due editor should show no snooze row at all
  await page.click('.task-row[data-task-id="t2"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t2"] .due-editor', { timeout: 5000 });
  const noSnoozeRow = await page.locator('.task-row[data-task-id="t2"] .snooze-row').count();
  console.log("No snooze row shown for a task with no due date:", noSnoozeRow === 0 ? "PASS" : "FAIL");
  await page.click('.task-row[data-task-id="t2"] [data-act="close"]');

  // Dated task shows snooze buttons
  await page.click('.task-row[data-task-id="t1"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .snooze-row', { timeout: 5000 });
  console.log("Snooze row shown for a task with a due date:", "PASS");

  // +1 day
  await page.click('.task-row[data-task-id="t1"] [data-act="snooze-1d"]');
  await page.waitForTimeout(200);
  await page.waitForTimeout(1500);
  let saved = repoFiles["data/tasks.json"].headings[0].tasks.find(t => t.id === "t1");
  console.log("Snooze +1 day advances the due date by 1 day:", saved.due.date === "2026-08-21" ? "PASS" : "FAIL (" + saved.due.date + ")");

  // Due editor closed automatically after snoozing (render() rebuilds the row)
  const editorGoneAfterSnooze = await page.locator('.task-row[data-task-id="t1"] .due-editor').count();
  console.log("Editor closes after snoozing:", editorGoneAfterSnooze === 0 ? "PASS" : "FAIL");

  // Badge reflects the new date
  const badgeTextAfterSnooze = await page.locator('.task-row[data-task-id="t1"] .due-badge').textContent();
  console.log("Due badge reflects the snoozed date:", /21/.test(badgeTextAfterSnooze) ? "PASS" : "FAIL (" + badgeTextAfterSnooze + ")");

  // +1 week from the current (already-snoozed) date
  await page.click('.task-row[data-task-id="t1"] .due-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .snooze-row', { timeout: 5000 });
  await page.click('.task-row[data-task-id="t1"] [data-act="snooze-1w"]');
  await page.waitForTimeout(200);
  await page.waitForTimeout(1500);
  saved = repoFiles["data/tasks.json"].headings[0].tasks.find(t => t.id === "t1");
  console.log("Snooze +1 week advances 7 days from the current date:", saved.due.date === "2026-08-28" ? "PASS" : "FAIL (" + saved.due.date + ")");

  // Time and allDay are preserved through a snooze
  console.log("allDay flag preserved through snooze:", saved.due.allDay === true ? "PASS" : "FAIL (" + JSON.stringify(saved.due) + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

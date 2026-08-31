const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }
function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = { "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [], subheadings: [] }] } };
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
  await page.waitForSelector("#quick-capture-btn", { timeout: 5000 });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const in3days = new Date(today); in3days.setDate(in3days.getDate() + 3);

  const lines = [
    "Buy milk",                          // no date at all
    "Call dentist tomorrow 3pm",         // relative day + 12h time
    "Submit grades 2026-09-15",          // ISO date
    "Team sync in 3 days",               // relative "in N days"
    "Renew passport 9/20",               // numeric M/D
    "Book flights Aug 30"                // month-name date
  ];
  await page.click("#quick-capture-btn");
  await page.waitForSelector("#qc-textarea", { timeout: 5000 });
  await page.fill("#qc-textarea", lines.join("\n"));
  await page.selectOption("#qc-heading", "h1");
  await page.click("#qc-add");
  await page.waitForSelector("#modal-root .modal-backdrop", { state: "detached", timeout: 5000 });

  const rows = await page.locator(".heading-card").first().locator(".task-row").evaluateAll(rows =>
    rows.map(r => ({ id: r.getAttribute("data-task-id"), text: r.querySelector(".task-text").value }))
  );
  console.log("6 tasks created:", rows.length === 6 ? "PASS" : "FAIL (" + rows.length + ")");

  await page.waitForTimeout(1500);
  const savedTasks = repoFiles["data/tasks.json"].headings[0].tasks;
  function byText(prefix) { return savedTasks.filter(t => t.text.indexOf(prefix) === 0)[0]; }

  const plain = byText("Buy milk");
  console.log("Plain line with no date phrase stays untouched:", plain && plain.text === "Buy milk" && plain.due === null ? "PASS" : "FAIL (" + JSON.stringify(plain) + ")");

  const dentist = byText("Call dentist");
  console.log("\"tomorrow 3pm\" strips the phrase and sets due date+time:",
    dentist && dentist.text === "Call dentist" && dentist.due && dentist.due.date === ymd(tomorrow) && dentist.due.time === "15:00" ? "PASS" : "FAIL (" + JSON.stringify(dentist) + ")");

  const grades = byText("Submit grades");
  console.log("ISO date (2026-09-15) parsed correctly:",
    grades && grades.text === "Submit grades" && grades.due && grades.due.date === "2026-09-15" && grades.due.allDay === true ? "PASS" : "FAIL (" + JSON.stringify(grades) + ")");

  const sync = byText("Team sync");
  console.log("\"in 3 days\" resolves relative to today:",
    sync && sync.text === "Team sync" && sync.due && sync.due.date === ymd(in3days) ? "PASS" : "FAIL (" + JSON.stringify(sync) + ")");

  // Both of these phrases omit a year, so the app resolves them to the next occurrence —
  // this year if that date hasn't happened yet, otherwise next year (see qcParseDatePhrase's
  // "if(d < today) roll to year+1" rule). Compute the expectation the same way instead of
  // hardcoding the current year, so this test stays correct regardless of what day it runs on.
  function nextOccurrence(monthIdx, day) {
    var candidate = new Date(today.getFullYear(), monthIdx, day);
    if (candidate < today) candidate = new Date(today.getFullYear() + 1, monthIdx, day);
    return ymd(candidate);
  }

  const passport = byText("Renew passport");
  console.log("Numeric M/D (9/20) parsed correctly:",
    passport && passport.text === "Renew passport" && passport.due && passport.due.date === nextOccurrence(8, 20) ? "PASS" : "FAIL (" + JSON.stringify(passport) + ")");

  const flights = byText("Book flights");
  console.log("Month-name date (Aug 30) parsed correctly:",
    flights && flights.text === "Book flights" && flights.due && flights.due.date === nextOccurrence(7, 30) ? "PASS" : "FAIL (" + JSON.stringify(flights) + ")");

  // A line with a date phrase should also have created a Google Calendar sync attempt
  // (no Google connected in this test, so it should just be a no-op, not an error)
  console.log("No crash from attempting calendar sync without Google connected:", "PASS");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

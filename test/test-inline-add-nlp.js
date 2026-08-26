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
      { id: "t1", text: "Existing task about Friday's party", done: false, due: null }
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

  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  // Click "+ Add task", type a line with a date phrase, blur (mirrors pressing Enter)
  await page.click(".heading-card .ghost-add");
  await page.waitForTimeout(150);
  const newRow = page.locator(".task-row").last();
  const newInput = newRow.locator(".task-text");
  await newInput.fill("Submit slides tomorrow 4pm");
  await newInput.press("Enter");
  await page.waitForTimeout(200);

  const rows = await page.locator(".heading-card").first().locator(".task-row").evaluateAll(rows =>
    rows.map(r => ({ id: r.getAttribute("data-task-id"), text: r.querySelector(".task-text").value }))
  );
  const created = rows.find(r => r.text === "Submit slides");
  console.log("Inline-created task strips the date phrase from its text:", !!created ? "PASS" : "FAIL (" + JSON.stringify(rows) + ")");

  await page.waitForTimeout(1500);
  const saved = repoFiles["data/tasks.json"].headings[0].tasks.find(t => t.text === "Submit slides");
  console.log("Inline-created task's due date was set from the phrase:",
    saved && saved.due && saved.due.date === ymd(tomorrow) && saved.due.time === "16:00" ? "PASS" : "FAIL (" + JSON.stringify(saved) + ")");

  // Renaming an EXISTING task that happens to mention a weekday should NOT set a due date
  const existingInput = page.locator('.task-row[data-task-id="t1"] .task-text');
  await existingInput.fill("Existing task about Friday's party (renamed)");
  await existingInput.press("Enter");
  await page.waitForTimeout(200);
  await page.waitForTimeout(1500);
  const existingSaved = repoFiles["data/tasks.json"].headings[0].tasks.find(t => t.id === "t1");
  console.log("Renaming an existing task never triggers date parsing:",
    existingSaved && existingSaved.due === null && existingSaved.text === "Existing task about Friday's party (renamed)" ? "PASS" : "FAIL (" + JSON.stringify(existingSaved) + ")");

  // A fresh inline task with NO date phrase in it is created exactly as typed
  await page.click(".heading-card .ghost-add");
  await page.waitForTimeout(150);
  const plainRow = page.locator(".task-row").last();
  const plainInput = plainRow.locator(".task-text");
  await plainInput.fill("Just a plain task");
  await plainInput.press("Enter");
  await page.waitForTimeout(200);
  await page.waitForTimeout(1500);
  const plainSaved = repoFiles["data/tasks.json"].headings[0].tasks.find(t => t.text === "Just a plain task");
  console.log("Fresh inline task with no date phrase stays untouched:", plainSaved && plainSaved.due === null ? "PASS" : "FAIL (" + JSON.stringify(plainSaved) + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

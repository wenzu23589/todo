const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = { "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [], subheadings: [
    { id: "s1", title: "Sub A", collapsed: false, tasks: [] }
  ] }] } };
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
  await page.waitForSelector(".heading-card", { timeout: 5000 });

  // Heading-level "+ Add task": the "New task" text should be selected on focus, so
  // typing immediately (no backspace/select-all) replaces it entirely.
  await page.locator(".heading-card").first().locator(".ghost-add").first().click();
  await page.waitForTimeout(150);
  const newRow = page.locator(".task-row").last();
  const newInput = newRow.locator(".task-text");
  const initiallySelected = await newInput.evaluate(el => el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0);
  console.log("New task's placeholder text is fully selected on creation:", initiallySelected ? "PASS" : "FAIL");

  await page.keyboard.type("Write report");
  const valueAfterTyping = await newInput.inputValue();
  console.log("Typing immediately replaces \"New task\" (no leftover text):", valueAfterTyping === "Write report" ? "PASS" : "FAIL (" + valueAfterTyping + ")");

  // Same check for a sub-heading's "+ Add task"
  await page.locator(".sub-block").first().locator(".ghost-add").first().click();
  await page.waitForTimeout(150);
  const subNewInput = page.locator(".sub-block").first().locator(".task-row").last().locator(".task-text");
  const subSelected = await subNewInput.evaluate(el => el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0);
  console.log("Sub-heading's new task text is also fully selected on creation:", subSelected ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

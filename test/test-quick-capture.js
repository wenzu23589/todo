const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [], subheadings: [] }] }
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
  await page.waitForSelector(".heading-card", { timeout: 5000 });

  // Open Quick capture, add 3 lines (with a blank line + whitespace-only line that should be ignored) to existing heading
  await page.click("#quick-capture-btn");
  await page.waitForSelector("#qc-textarea", { timeout: 5000 });
  // Note: deliberately no weekday/date words here — that's covered by test-quick-capture-nlp.js.
  await page.fill("#qc-textarea", "Buy milk\n\nCall dentist   \n   \nFinish slides for review");
  await page.selectOption("#qc-heading", "h1");
  await page.click("#qc-add");
  await page.waitForSelector("#modal-root .modal-backdrop", { state: "detached", timeout: 5000 });

  const taskTexts = await page.locator('.heading-card').first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("3 tasks created, blank lines skipped, whitespace trimmed:",
    JSON.stringify(taskTexts) === JSON.stringify(["Buy milk", "Call dentist", "Finish slides for review"]) ? "PASS" : "FAIL (" + JSON.stringify(taskTexts) + ")");

  // Open again, create tasks under a brand-new heading
  await page.click("#quick-capture-btn");
  await page.waitForSelector("#qc-textarea", { timeout: 5000 });
  await page.fill("#qc-textarea", "Renew passport\nBook flights");
  await page.selectOption("#qc-heading", "__new__");
  await page.waitForSelector("#qc-new-heading-field:not([hidden])", { timeout: 5000 });
  await page.fill("#qc-new-heading", "Travel");
  await page.click("#qc-add");
  await page.waitForSelector("#modal-root .modal-backdrop", { state: "detached", timeout: 5000 });

  const headingCount = await page.locator(".heading-card").count();
  console.log("New heading created:", headingCount === 2 ? "PASS" : "FAIL (" + headingCount + ")");
  const newHeadingTasks = await page.locator(".heading-card").nth(1).locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Tasks landed under the new heading:", JSON.stringify(newHeadingTasks) === JSON.stringify(["Renew passport", "Book flights"]) ? "PASS" : "FAIL (" + JSON.stringify(newHeadingTasks) + ")");

  // Empty input should show an error, not silently close
  await page.click("#quick-capture-btn");
  await page.waitForSelector("#qc-textarea", { timeout: 5000 });
  await page.click("#qc-add");
  await page.waitForTimeout(150);
  const errorShown = await page.locator("#qc-error").isVisible();
  console.log("Empty submission shows an error instead of closing:", errorShown ? "PASS" : "FAIL");
  const modalStillOpen = await page.locator("#modal-root .modal-backdrop").count();
  console.log("Modal stays open on error:", modalStillOpen === 1 ? "PASS" : "FAIL");
  await page.click("#qc-cancel");

  // Confirm persistence
  await page.waitForTimeout(1500);
  console.log("Persisted heading count:", repoFiles["data/tasks.json"].headings.length === 2 ? "PASS" : "FAIL (" + repoFiles["data/tasks.json"].headings.length + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

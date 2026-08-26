const path = require("path");
const fs = require("fs");
const os = require("os");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }
function pad2(n) { return n < 10 ? "0" + n : "" + n; }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Sample task", done: false, due: null, tags: ["work"], priority: "high" }
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

  await page.click("#settings-btn");
  await page.waitForSelector("#settings-export", { timeout: 5000 });
  const exportBtnDisabled = await page.locator("#settings-export").isDisabled();
  console.log("Export button is enabled once state is loaded:", !exportBtnDisabled ? "PASS" : "FAIL");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#settings-export")
  ]);

  const now = new Date();
  const expectedName = "daybook-backup-" + now.getFullYear() + "-" + pad2(now.getMonth()+1) + "-" + pad2(now.getDate()) + ".json";
  console.log("Downloaded filename is dated as expected:", download.suggestedFilename() === expectedName ? "PASS" : "FAIL (" + download.suggestedFilename() + ")");

  const savePath = path.join(os.tmpdir(), "daybook-test-export-" + Date.now() + ".json");
  await download.saveAs(savePath);
  const content = JSON.parse(fs.readFileSync(savePath, "utf8"));
  console.log("Downloaded file is valid JSON with the heading intact:", content.headings && content.headings[0].title === "Work" ? "PASS" : "FAIL (" + JSON.stringify(content) + ")");
  console.log("Downloaded file includes task fields (tags, priority):",
    content.headings[0].tasks[0].tags[0] === "work" && content.headings[0].tasks[0].priority === "high" ? "PASS" : "FAIL (" + JSON.stringify(content.headings[0].tasks[0]) + ")");
  fs.unlinkSync(savePath);

  // Export also works before any GitHub connection (in-memory default state)
  await page.click("#settings-cancel");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("#modal-root .modal-box", { timeout: 5000 });
  await page.click("#settings-cancel");
  await page.waitForSelector("#settings-btn", { timeout: 5000 });
  await page.click("#settings-btn");
  await page.waitForSelector("#settings-export", { timeout: 5000 });
  const [download2] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#settings-export")
  ]);
  console.log("Export works even with no GitHub repo connected:", !!download2.suggestedFilename() ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

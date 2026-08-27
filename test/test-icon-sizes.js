const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = { "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
    { id: "t1", text: "Task one", done: false, due: { date: "2026-09-05", time: null, endTime: null, allDay: true }, priority: "high", tags: ["urgent"], subtasks: [] }
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

  // Task-row meta badge icons (notes/tags/subtasks) grew from 12px to 14px
  const notesIconBox = await page.locator(".task-row .notes-badge svg").first().boundingBox();
  console.log("Notes badge icon is bigger than the old 12px:", notesIconBox && notesIconBox.width >= 13.5 ? "PASS" : "FAIL (" + JSON.stringify(notesIconBox) + ")");

  const tagsIconBox = await page.locator(".tags-badge svg").first().boundingBox();
  console.log("Tags badge icon is bigger than the old 12px:", tagsIconBox && tagsIconBox.width >= 13.5 ? "PASS" : "FAIL (" + JSON.stringify(tagsIconBox) + ")");

  const subtasksIconWidth = await page.locator(".subtasks-badge svg").first().getAttribute("width");
  console.log("Subtasks badge icon width attribute grew from 12 to 14:", subtasksIconWidth === "14" ? "PASS" : "FAIL (" + subtasksIconWidth + ")");

  // Priority dot grew from 8px to 10px
  const priorityDotBox = await page.locator(".priority-dot").first().boundingBox();
  console.log("Priority dot is bigger than the old 8px:", priorityDotBox && priorityDotBox.width >= 9.5 ? "PASS" : "FAIL (" + JSON.stringify(priorityDotBox) + ")");

  // Header button icons grew (theme button's icon was 13px)
  const themeIconWidth = await page.locator("#theme-btn svg").getAttribute("width");
  console.log("Header theme icon width attribute grew from 13 to 15:", themeIconWidth === "15" ? "PASS" : "FAIL (" + themeIconWidth + ")");

  const settingsIconWidth = await page.locator("#settings-btn svg").getAttribute("width");
  console.log("Header settings icon width attribute grew:", parseInt(settingsIconWidth, 10) > 13 ? "PASS" : "FAIL (" + settingsIconWidth + ")");

  // Delete (trash) icon on the task row grew
  const trashIconWidth = await page.locator('.task-row[data-task-id="t1"] .icon-btn.danger svg').getAttribute("width");
  console.log("Task delete icon width attribute grew from 14 to 16:", trashIconWidth === "16" ? "PASS" : "FAIL (" + trashIconWidth + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

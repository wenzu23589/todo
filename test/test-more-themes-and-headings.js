const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = { "data/tasks.json": { headings: [
    { id: "h1", title: "Work", color: null, tasks: [{ id: "t1", text: "Task one", done: false, due: null, subtasks: [] }], subheadings: [
      { id: "s1", title: "Sub A", collapsed: false, tasks: [] }
    ] }
  ] } };
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

  // --- More accent-colour themes ---
  await page.click("#theme-btn");
  await page.waitForSelector(".theme-popover", { timeout: 5000 });
  const themeCount = await page.locator(".theme-option").count();
  console.log("More than the original 5 accent-colour themes are offered:", themeCount > 5 ? "PASS (" + themeCount + ")" : "FAIL (" + themeCount + ")");

  const themeNames = await page.locator(".theme-option span:last-child").evaluateAll(els => els.map(e => e.textContent));
  console.log("New themes include Rose, Indigo, Gold, Crimson, Teal:", ["Rose","Indigo","Gold","Crimson","Teal"].every(n => themeNames.includes(n)) ? "PASS" : "FAIL (" + JSON.stringify(themeNames) + ")");

  // Picking a new theme applies and persists across reload
  const indigoBtn = page.locator('.theme-option[data-key="indigo"]');
  await indigoBtn.click();
  const accentAfterPick = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  console.log("Selecting a new theme (Indigo) applies its accent colour:", /#4650b0|rgb\(70, *80, *176\)/i.test(accentAfterPick) ? "PASS" : "FAIL (" + accentAfterPick + ")");
  await page.click("body", { position: { x: 5, y: 5 } });
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const accentAfterReload = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  console.log("The chosen theme persists across reload:", /#4650b0|rgb\(70, *80, *176\)/i.test(accentAfterReload) ? "PASS" : "FAIL (" + accentAfterReload + ")");

  // --- Sub-headings are no longer forced to all caps ---
  const subTextTransform = await page.evaluate(() => {
    const el = document.querySelector(".sub-title");
    return el ? getComputedStyle(el).textTransform : null;
  });
  console.log("Sub-heading title is no longer forced to uppercase:", subTextTransform === "none" ? "PASS" : "FAIL (" + subTextTransform + ")");
  const subTitleValue = await page.locator(".sub-title").inputValue();
  console.log("Sub-heading title keeps its original mixed-case text:", subTitleValue === "Sub A" ? "PASS" : "FAIL (" + subTitleValue + ")");

  // --- Heading background colour ---
  const bgBeforeColor = await page.evaluate(() => getComputedStyle(document.querySelector(".heading-card")).backgroundColor);
  await page.click(".heading-card .color-dot");
  await page.waitForSelector(".color-popover", { timeout: 5000 });
  await page.click('.color-popover .swatch[data-color="#4a5fc1"]');
  await page.waitForTimeout(300);
  const bgAfterColor = await page.evaluate(() => getComputedStyle(document.querySelector(".heading-card")).backgroundColor);
  console.log("Picking a heading colour tints the whole heading box's background:", bgAfterColor !== bgBeforeColor ? "PASS" : "FAIL (still " + bgAfterColor + ")");

  await page.waitForTimeout(1300);
  const savedHeadingColor = repoFiles["data/tasks.json"].headings[0].color;
  console.log("Heading colour persists to storage:", savedHeadingColor === "#4a5fc1" ? "PASS" : "FAIL (" + savedHeadingColor + ")");

  await page.reload();
  await page.waitForSelector(".heading-card", { timeout: 5000 });
  const bgAfterReload = await page.evaluate(() => getComputedStyle(document.querySelector(".heading-card")).backgroundColor);
  console.log("Heading background tint survives reload:", bgAfterReload !== bgBeforeColor ? "PASS" : "FAIL (still " + bgAfterReload + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

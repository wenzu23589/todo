const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "No priority, due soonest", done: false, due: { date: "2026-08-27" } },
      { id: "t2", text: "Low priority", done: false, due: null, priority: "low" },
      { id: "t3", text: "High priority", done: false, due: null, priority: "high" },
      { id: "t4", text: "Medium priority", done: false, due: null, priority: "medium" }
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

  // New task starts with no priority — plain "Priority" placeholder, unset style, white dot
  const firstFlagClass = await page.locator(".priority-flag").first().getAttribute("class");
  const firstFlagText = await page.locator(".priority-flag").first().textContent();
  const firstDotClass = await page.locator(".priority-flag").first().locator(".priority-dot").getAttribute("class");
  console.log("Task with no priority shows the placeholder label, unset, white dot:",
    !/\bset\b/.test(firstFlagClass) && firstFlagText.trim() === "Priority" && /dot-none/.test(firstDotClass) ? "PASS" : "FAIL (" + firstFlagClass + ", " + firstFlagText + ", " + firstDotClass + ")");

  // Pre-seeded priorities render as their text label with the matching traffic-light dot
  const lowRow = page.locator('.task-row[data-task-id="t2"]');
  const lowFlagText = await lowRow.locator(".priority-flag").textContent();
  const lowFlagClass = await lowRow.locator(".priority-flag").getAttribute("class");
  const lowDotClass = await lowRow.locator(".priority-dot").getAttribute("class");
  console.log("Pre-set low priority renders as \"Low\", set, green dot:",
    lowFlagText.trim() === "Low" && /\bset\b/.test(lowFlagClass) && /dot-low/.test(lowDotClass) ? "PASS" : "FAIL (" + lowFlagText + ", " + lowFlagClass + ", " + lowDotClass + ")");

  // Cycle: none -> high -> medium -> low -> none, each with the matching dot color
  const flag = page.locator('.task-row[data-task-id="t1"] .priority-flag');
  await flag.click();
  await page.waitForTimeout(100);
  let txt = await page.locator('.task-row[data-task-id="t1"] .priority-flag').textContent();
  let dotClass = await page.locator('.task-row[data-task-id="t1"] .priority-dot').getAttribute("class");
  console.log("First click sets High with a red dot:", txt.trim() === "High" && /dot-high/.test(dotClass) ? "PASS" : "FAIL (" + txt + ", " + dotClass + ")");

  await page.locator('.task-row[data-task-id="t1"] .priority-flag').click();
  await page.waitForTimeout(100);
  txt = await page.locator('.task-row[data-task-id="t1"] .priority-flag').textContent();
  dotClass = await page.locator('.task-row[data-task-id="t1"] .priority-dot').getAttribute("class");
  console.log("Second click sets Medium with an orange dot:", txt.trim() === "Medium" && /dot-medium/.test(dotClass) ? "PASS" : "FAIL (" + txt + ", " + dotClass + ")");

  await page.locator('.task-row[data-task-id="t1"] .priority-flag').click();
  await page.waitForTimeout(100);
  txt = await page.locator('.task-row[data-task-id="t1"] .priority-flag').textContent();
  dotClass = await page.locator('.task-row[data-task-id="t1"] .priority-dot').getAttribute("class");
  console.log("Third click sets Low with a green dot:", txt.trim() === "Low" && /dot-low/.test(dotClass) ? "PASS" : "FAIL (" + txt + ", " + dotClass + ")");

  await page.locator('.task-row[data-task-id="t1"] .priority-flag').click();
  await page.waitForTimeout(100);
  txt = await page.locator('.task-row[data-task-id="t1"] .priority-flag').textContent();
  console.log("Fourth click cycles back to the placeholder:", txt.trim() === "Priority" ? "PASS" : "FAIL (" + txt + ")");

  // Sort by priority: high, medium, low, none(no-priority tasks, tiebreak by due date)
  await page.click("#sort-priority-btn");
  await page.waitForTimeout(100);
  const order = await page.locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Priority sort orders high, medium, low, then none:",
    JSON.stringify(order) === JSON.stringify(["High priority", "Medium priority", "Low priority", "No priority, due soonest"]) ? "PASS" : "FAIL (" + JSON.stringify(order) + ")");

  // Drag grip disabled while priority-sorted
  const gripInactive = await page.locator(".task-row").first().locator(".grip").evaluate(el => el.classList.contains("inactive"));
  console.log("Grip disabled while sorted by priority:", gripInactive ? "PASS" : "FAIL");

  // Back to manual — original insertion order restored
  await page.click("#sort-manual-btn");
  await page.waitForTimeout(100);
  const manualOrder = await page.locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Manual sort restores original order:",
    JSON.stringify(manualOrder) === JSON.stringify(["No priority, due soonest", "Low priority", "High priority", "Medium priority"]) ? "PASS" : "FAIL (" + JSON.stringify(manualOrder) + ")");

  // Persistence
  await page.waitForTimeout(1500);
  const savedPriorities = repoFiles["data/tasks.json"].headings[0].tasks.map(t => t.priority);
  console.log("Priorities persisted to storage:", JSON.stringify(savedPriorities) === JSON.stringify([null, "low", "high", "medium"]) ? "PASS" : "FAIL (" + JSON.stringify(savedPriorities) + ")");

  // Survives reload
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const t2FlagTextAfterReload = await page.locator('.task-row[data-task-id="t2"] .priority-flag').textContent();
  console.log("Priority survives reload:", t2FlagTextAfterReload.trim() === "Low" ? "PASS" : "FAIL (" + t2FlagTextAfterReload + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

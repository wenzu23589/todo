const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Write report", done: false, due: null, tags: ["work", "urgent"] },
      { id: "t2", text: "Buy groceries", done: false, due: null, tags: ["errands"] },
      { id: "t3", text: "Plan trip", done: false, due: null, tags: [] }
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

  // Pre-seeded tags render on the badge
  const t1BadgeText = await page.locator('.task-row[data-task-id="t1"] .tags-badge').textContent();
  console.log("Pre-set tags render on the badge:", (/work/.test(t1BadgeText) && /urgent/.test(t1BadgeText)) ? "PASS" : "FAIL (" + t1BadgeText + ")");
  const t3BadgeClass = await page.locator('.task-row[data-task-id="t3"] .tags-badge').getAttribute("class");
  console.log("Task with no tags has unset badge:", !/\bset\b/.test(t3BadgeClass) ? "PASS" : "FAIL (" + t3BadgeClass + ")");

  // Add a tag to the untagged task via the editor
  await page.click('.task-row[data-task-id="t3"] .tags-badge');
  await page.waitForSelector('.task-row[data-task-id="t3"] .tags-editor', { timeout: 5000 });
  await page.fill('.task-row[data-task-id="t3"] .tag-add-input', "travel");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  const t3Chips = await page.locator('.task-row[data-task-id="t3"] .tag-chip-text').allTextContents();
  console.log("New tag added via Enter key:", JSON.stringify(t3Chips) === JSON.stringify(["travel"]) ? "PASS" : "FAIL (" + JSON.stringify(t3Chips) + ")");

  // Duplicate tag isn't added twice
  await page.fill('.task-row[data-task-id="t3"] .tag-add-input', "travel");
  await page.click('.task-row[data-task-id="t3"] [data-act="add-tag"]');
  await page.waitForTimeout(150);
  const t3ChipsAfterDupe = await page.locator('.task-row[data-task-id="t3"] .tag-chip-text').count();
  console.log("Duplicate tag not added twice:", t3ChipsAfterDupe === 1 ? "PASS" : "FAIL (" + t3ChipsAfterDupe + ")");

  // Remove a tag via its chip's x button
  await page.click('.task-row[data-task-id="t1"] .tags-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .tags-editor', { timeout: 5000 });
  const urgentChip = page.locator('.task-row[data-task-id="t1"] .tag-chip', { has: page.locator('.tag-chip-text', { hasText: "urgent" }) });
  await urgentChip.locator(".tag-chip-remove").click();
  await page.waitForTimeout(150);
  const t1ChipsAfterRemove = await page.locator('.task-row[data-task-id="t1"] .tag-chip-text').allTextContents();
  console.log("Tag removed via chip x:", JSON.stringify(t1ChipsAfterRemove) === JSON.stringify(["work"]) ? "PASS" : "FAIL (" + JSON.stringify(t1ChipsAfterRemove) + ")");
  await page.click('.task-row[data-task-id="t1"] [data-act="close"]');

  // Persistence
  await page.waitForTimeout(1500);
  const savedTags = repoFiles["data/tasks.json"].headings[0].tasks.map(t => t.tags);
  console.log("Tag changes persisted:", JSON.stringify(savedTags) === JSON.stringify([["work"], ["errands"], ["travel"]]) ? "PASS" : "FAIL (" + JSON.stringify(savedTags) + ")");

  // --- Tag filter ---
  await page.click("#tag-filter-btn");
  await page.waitForSelector(".tag-filter-popover", { timeout: 5000 });
  const filterOptions = await page.locator(".tag-filter-row span:last-child").allTextContents();
  console.log("Filter popover lists all tags in use, sorted:", JSON.stringify(filterOptions) === JSON.stringify(["errands", "travel", "work"]) ? "PASS" : "FAIL (" + JSON.stringify(filterOptions) + ")");

  await page.locator('.tag-filter-cb[value="errands"]').check();
  await page.waitForTimeout(150);
  const visibleAfterFilter = await page.locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Filtering by 'errands' shows only that task:", JSON.stringify(visibleAfterFilter) === JSON.stringify(["Buy groceries"]) ? "PASS" : "FAIL (" + JSON.stringify(visibleAfterFilter) + ")");

  const filterBtnText = await page.locator("#tag-filter-btn").textContent();
  console.log("Filter button shows active count:", /Tags \(1\)/.test(filterBtnText) ? "PASS" : "FAIL (" + filterBtnText + ")");

  // Add a second tag filter (OR logic — both should show). The popover stays open
  // after checking a box (so multi-select doesn't require reopening it each time).
  await page.locator('.tag-filter-cb[value="work"]').check();
  await page.waitForTimeout(150);
  const visibleAfterOrFilter = await page.locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("OR filter across two tags shows both matches:", JSON.stringify(visibleAfterOrFilter.sort()) === JSON.stringify(["Buy groceries", "Write report"]) ? "PASS" : "FAIL (" + JSON.stringify(visibleAfterOrFilter) + ")");

  // Clear filter — popover is already open from the checks above
  await page.waitForSelector("#tag-filter-clear", { timeout: 5000 });
  await page.click("#tag-filter-clear");
  await page.waitForTimeout(150);
  const visibleAfterClear = await page.locator(".task-list").first().locator(".task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Clearing the filter shows every task again:", visibleAfterClear.length === 3 ? "PASS" : "FAIL (" + JSON.stringify(visibleAfterClear) + ")");
  const filterBtnTextAfterClear = await page.locator("#tag-filter-btn").textContent();
  console.log("Filter button resets to plain 'Tags':", /^\s*Tags\s*$/.test(filterBtnTextAfterClear) ? "PASS" : "FAIL (" + filterBtnTextAfterClear + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

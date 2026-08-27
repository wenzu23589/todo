const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// Sub-headings now default to collapsed — both for any sub-heading that already existed
// before this change (a one-time migration on load, keyed off a collapsedDefaultApplied
// flag so a later manual expand is never re-collapsed on a future load) and, per the user's
// choice, for brand new ones created via "+ Add sub-heading" too... except the opposite:
// newly-created ones start EXPANDED so you can add a task to it right away, and only fold
// into the "collapsed by default" behavior once you collapse it yourself. Headings themselves
// are unaffected — only sub-headings changed default.

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const repoFiles = {
    "data/tasks.json": {
      headings: [
        {
          id: "h1", title: "Research", collapsed: false, color: null,
          tasks: [ { id: "t1", text: "Top-level task", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] } ],
          // A pre-existing sub-heading from before this feature: no `collapsed` field and no
          // `collapsedDefaultApplied` flag at all, same as any real save from before today.
          subheadings: [
            { id: "sh1", title: "Ethics approval", tasks: [
              { id: "ts1", text: "Submit form 27B", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
            ], notesList: [], attachments: [] }
          ],
          notesList: [], attachments: []
        }
      ]
    }
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
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: b64(repoFiles[filePath]), sha, encoding: "base64" }) });
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

  const headingCard = page.locator(".heading-card").first();
  const subBlock = page.locator('.sub-block[data-sub-id="sh1"]');

  console.log("A pre-existing sub-heading (no saved collapsed state) loads collapsed by default:",
    await subBlock.evaluate(el => el.classList.contains("collapsed")) ? "PASS" : "FAIL");
  console.log("...its parent heading is unaffected — headings didn't change default:",
    await headingCard.evaluate(el => el.classList.contains("collapsed")) ? "FAIL" : "PASS");
  // The collapsed CSS clips .sub-body to zero height via overflow:hidden — a descendant
  // <input>'s own getBoundingClientRect() still reports its natural (unclipped) box, which
  // makes Playwright's isVisible() an unreliable check here, so check the clipping box itself.
  const subBodyHeightWhileCollapsed = await subBlock.locator(".sub-body").evaluate(el => el.getBoundingClientRect().height);
  console.log("The task inside it is actually clipped to nothing while collapsed:", subBodyHeightWhileCollapsed === 0 ? "PASS" : "FAIL (" + subBodyHeightWhileCollapsed + ")");

  // --- Expanding it is a single click on its own chevron ---
  await subBlock.locator(".collapse-btn").click();
  await page.waitForTimeout(150);
  console.log("Clicking its collapse/expand chevron reveals it immediately:",
    await subBlock.evaluate(el => el.classList.contains("collapsed")) ? "FAIL" : "PASS");
  const taskVisibleAfterExpand = await page.locator('.task-row[data-task-id="ts1"] .task-text').isVisible().catch(() => false);
  console.log("...and the task inside becomes visible:", taskVisibleAfterExpand ? "PASS" : "FAIL");

  // --- The manual expand persists and is never re-collapsed by the one-time migration again ---
  await page.waitForTimeout(1500); // debounced save
  const savedSub = repoFiles["data/tasks.json"].headings[0].subheadings[0];
  console.log("The expanded state is saved:", savedSub.collapsed === false ? "PASS" : "FAIL");
  console.log("...tagged so a future load won't re-collapse it:", savedSub.collapsedDefaultApplied === true ? "PASS" : "FAIL");

  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const subBlockAfterReload = page.locator('.sub-block[data-sub-id="sh1"]');
  console.log("After a reload, the manually-expanded sub-heading stays expanded (not re-collapsed):",
    await subBlockAfterReload.evaluate(el => el.classList.contains("collapsed")) ? "FAIL" : "PASS");

  // --- A brand new sub-heading starts expanded, not collapsed, so you can add a task right away ---
  await page.click(".heading-card >> text=Add sub-heading");
  await page.waitForTimeout(150);
  const newSubBlock = page.locator(".sub-block").last();
  console.log("A freshly-created sub-heading starts expanded:",
    await newSubBlock.evaluate(el => el.classList.contains("collapsed")) ? "FAIL" : "PASS");
  const addTaskVisible = await newSubBlock.locator(".ghost-add").first().isVisible().catch(() => false);
  console.log("...so its 'Add task' button is immediately usable, no extra click needed:", addTaskVisible ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

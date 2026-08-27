const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// Bug report: searching says "1 task found" but the task is never actually visible, because
// its heading (or sub-heading) is collapsed — the search filters which tasks WOULD show, but
// never touches the collapsed/expanded state that hides the whole section. Same problem
// applies to the Tags/Priority/Due date filters, since they share the same underlying
// mechanism. Fixed by force-expanding (visually only, not persisted) any collapsed heading/
// sub-heading that contains a currently-matching task.

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const repoFiles = { "data/tasks.json": { headings: [
    {
      id: "h1", title: "CARS", collapsed: false, color: null, tasks: [
        { id: "t1", text: "Unrelated task", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
      ], subheadings: [], notesList: [], attachments: []
    },
    {
      id: "h2", title: "GreenToC", collapsed: true, color: null, tasks: [
        { id: "t2", text: "Convert 44 Euro/hr into GBP", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] },
        { id: "t3", text: "Something else", done: false, due: null, notes: "", checklist: [], tags: ["urgent"], priority: "high", subtasks: [], attachments: [] }
      ], subheadings: [
        {
          id: "sh1", title: "Sub project", collapsed: true, tasks: [
            { id: "t4", text: "File the Euro invoice", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
          ], notesList: [], attachments: []
        }
      ], notesList: [], attachments: []
    },
    {
      id: "h3", title: "Research", collapsed: true, color: null, tasks: [
        { id: "t5", text: "Nothing relevant here", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
      ], subheadings: [], notesList: [], attachments: []
    }
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

  const cars = page.locator(".heading-card").nth(0);
  const greenToC = page.locator(".heading-card").nth(1);
  const research = page.locator(".heading-card").nth(2);

  console.log("Before searching, the collapsed heading really is collapsed:", await greenToC.evaluate(el => el.classList.contains("collapsed")) ? "PASS" : "FAIL");

  // --- Searching a term that only matches inside a collapsed heading auto-expands it ---
  await page.fill("#task-search-input", "euro");
  await page.waitForTimeout(250);

  console.log("Search status reports the match:", /task.*found/i.test(await page.locator("#search-status").textContent()) ? "PASS" : "FAIL");
  console.log("The heading containing the match is no longer visually collapsed:", await greenToC.evaluate(el => el.classList.contains("collapsed")) ? "FAIL" : "PASS");
  const matchVisible = await page.locator('.task-row[data-task-id="t2"] .task-text').isVisible().catch(() => false);
  console.log("The actual matching task is now visible on screen:", matchVisible ? "PASS" : "FAIL");
  console.log("A heading with no match at all stays collapsed (not force-expanded needlessly):", await research.evaluate(el => el.classList.contains("collapsed")) ? "PASS" : "FAIL");
  console.log("A heading that's already expanded, with no match, is unaffected:", await cars.evaluate(el => el.classList.contains("collapsed")) ? "FAIL" : "PASS");

  // --- The same applies to a match sitting inside a collapsed sub-heading ---
  await page.fill("#task-search-input", "invoice");
  await page.waitForTimeout(250);
  const subBlock = page.locator(".sub-block").first();
  console.log("A collapsed sub-heading containing the only match also auto-expands:", await subBlock.evaluate(el => el.classList.contains("collapsed")) ? "FAIL" : "PASS");
  const subMatchVisible = await page.locator('.task-row[data-task-id="t4"] .task-text').isVisible().catch(() => false);
  console.log("The task inside that sub-heading is actually visible:", subMatchVisible ? "PASS" : "FAIL");

  // --- Clearing the search lets a heading collapse back to its real saved state ---
  await page.fill("#task-search-input", "");
  await page.waitForTimeout(250);
  console.log("Clearing the search re-collapses the heading (its saved state was never actually changed):",
    await greenToC.evaluate(el => el.classList.contains("collapsed")) ? "PASS" : "FAIL");

  // --- The override never persists heading.collapsed as false just because a search matched ---
  await page.fill("#task-search-input", "euro");
  await page.waitForTimeout(1500); // long enough that a debounced save would have fired if one were wrongly triggered
  console.log("Auto-expanding for search never saves a change to the repo:",
    repoFiles["data/tasks.json"].headings.find(h => h.id === "h2").collapsed === true ? "PASS" : "FAIL");

  // --- The same auto-expand applies to a plain tag filter, not just search (same underlying mechanism) ---
  await page.fill("#task-search-input", "");
  await page.waitForTimeout(200);
  await page.click("#tag-filter-btn");
  await page.waitForSelector(".tag-filter-popover", { timeout: 5000 });
  await page.click('.tag-filter-popover .tag-filter-row:has-text("urgent") input');
  await page.waitForTimeout(200);
  console.log("A tag filter also auto-expands a collapsed heading holding the only match:",
    await greenToC.evaluate(el => el.classList.contains("collapsed")) ? "FAIL" : "PASS");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

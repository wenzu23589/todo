const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// Search used to only look at a task's own text/notes/tags/subtasks/attachments — it had no
// idea headings or sub-headings existed, even though they can now carry their own notes and
// attachments. This file covers the fix: a task shows in search results if it matches on its
// own OR the heading/sub-heading containing it does (title, any note, or an attachment's
// filename/OCR'd text) — and on top of that, search now tolerates small typos rather than
// requiring an exact substring.

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const repoFiles = { "data/tasks.json": { headings: [
    {
      id: "h1", title: "Grants", color: null, tasks: [
        { id: "t1", text: "Draft budget spreadsheet", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
      ],
      subheadings: [
        {
          id: "sh1", title: "Admin", tasks: [
            { id: "t3", text: "File paperwork", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
          ],
          notesList: [ { id: "n2", html: "Ask Diane about the printer budget." } ], attachments: []
        }
      ],
      notesList: [ { id: "n1", html: "Point of contact: Diane. Annual conference is in October." } ],
      attachments: [ { id: "a1", name: "scope.pdf", extractedText: "This scope covers consulting services for the grant renewal.", textStatus: "done" } ]
    },
    {
      id: "h2", title: "Unrelated project", color: null, tasks: [
        { id: "t2", text: "Something else entirely", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
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

  async function search(q){
    await page.fill("#task-search-input", q);
    await page.waitForTimeout(250);
  }
  async function visibleTaskTexts(){
    return page.locator(".task-row .task-text").evaluateAll(els => els.map(e => e.value));
  }

  // --- A heading's own note surfaces every task under that heading ---
  await search("Diane");
  let visible = await visibleTaskTexts();
  console.log("Searching a name that only appears in a heading's note shows that heading's direct task:",
    visible.includes("Draft budget spreadsheet") ? "PASS" : "FAIL (" + JSON.stringify(visible) + ")");
  console.log("...and it doesn't drag in a task from an unrelated heading:",
    !visible.includes("Something else entirely") ? "PASS" : "FAIL (" + JSON.stringify(visible) + ")");

  // --- A sub-heading's own note surfaces just its own task, not its parent's other tasks ---
  await search("printer");
  visible = await visibleTaskTexts();
  console.log("A sub-heading's note surfaces its own task:",
    visible.includes("File paperwork") ? "PASS" : "FAIL (" + JSON.stringify(visible) + ")");

  // --- A heading attachment's OCR'd text counts too ---
  await search("consulting");
  visible = await visibleTaskTexts();
  console.log("A heading attachment's extracted text surfaces that heading's task:",
    visible.includes("Draft budget spreadsheet") ? "PASS" : "FAIL (" + JSON.stringify(visible) + ")");

  // --- The search status count reflects the widened match ---
  await search("Diane");
  const status = await page.locator("#search-status").textContent();
  console.log("Search status counts the tasks surfaced by the heading match:", /2 tasks found/.test(status) ? "PASS" : "FAIL (" + status + ")");

  // --- Fuzzy matching tolerates a small typo ---
  await search("conferance"); // real word in the note is "conference"
  visible = await visibleTaskTexts();
  console.log("A near-miss spelling ('conferance' for 'conference') still matches:",
    visible.includes("Draft budget spreadsheet") ? "PASS" : "FAIL (" + JSON.stringify(visible) + ")");

  // --- Fuzzy matching doesn't go so loose it matches everything ---
  await search("xyzzyplugh");
  const noMatchStatus = await page.locator("#search-status").textContent();
  console.log("A genuinely unrelated query still reports no matches:", /No matches/.test(noMatchStatus) ? "PASS" : "FAIL (" + noMatchStatus + ")");
  visible = await visibleTaskTexts();
  console.log("...and shows no tasks at all:", visible.length === 0 ? "PASS" : "FAIL (" + JSON.stringify(visible) + ")");

  // --- Clearing search restores everything ---
  await search("");
  visible = await visibleTaskTexts();
  console.log("Clearing search shows every task again:", visible.length === 3 ? "PASS" : "FAIL (" + JSON.stringify(visible) + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

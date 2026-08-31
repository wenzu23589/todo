const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Plan trip", done: false, due: null, notes: "", checklist: [] }
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
    // capture PUT payloads so we can confirm persistence
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

  // Badge starts unset
  const badgeSetInitially = await page.locator(".task-row .notes-badge").first().evaluate(el => el.classList.contains("set"));
  console.log("Notes badge starts unset:", !badgeSetInitially ? "PASS" : "FAIL");

  // Open the notes editor
  await page.click(".task-row .notes-badge");
  await page.waitForSelector(".notes-editor", { timeout: 5000 });
  console.log("Notes editor opens:", "PASS");

  // Type notes and blur (explicit blur — clicking elsewhere risks landing back inside
  // the now-expanded editor area and not actually leaving the rich-text box)
  await page.click(".notes-rich");
  await page.keyboard.type("Book flights and hotel before Friday.");
  await page.locator(".notes-rich").evaluate(el => el.blur());
  await page.waitForTimeout(200);
  const badgeAfterNotes = await page.locator(".task-row .notes-badge").first().textContent();
  console.log("Badge reflects notes after blur:", /Notes/.test(badgeAfterNotes) ? "PASS" : "FAIL (" + badgeAfterNotes + ")");

  // Editor should still be open (not closed by the badge update / blur)
  const editorStillOpenAfterNotes = await page.locator(".notes-editor").count();
  console.log("Editor stays open after typing notes:", editorStillOpenAfterNotes === 1 ? "PASS" : "FAIL");

  // Add two checklist items
  await page.fill(".checklist-add-input", "Book flights");
  await page.click('[data-act="add-item"]');
  await page.waitForTimeout(100);
  await page.fill(".checklist-add-input", "Book hotel");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  const itemCount = await page.locator(".checklist-item").count();
  console.log("Two checklist items added:", itemCount === 2 ? "PASS" : "FAIL (" + itemCount + ")");

  // Check off one item
  await page.locator(".checklist-item-check").first().check();
  await page.waitForTimeout(150);
  const badgeAfterCheck = await page.locator(".task-row .notes-badge").first().textContent();
  console.log("Badge shows 1/2 after checking one item:", /1\/2/.test(badgeAfterCheck) ? "PASS" : "FAIL (" + badgeAfterCheck + ")");
  const itemMarkedDone = await page.locator(".checklist-item").first().evaluate(el => el.classList.contains("done"));
  console.log("Checked item gets .done styling:", itemMarkedDone ? "PASS" : "FAIL");

  // Remove one item
  await page.locator(".checklist-item").nth(1).hover();
  await page.locator(".checklist-item-remove").nth(1).click();
  await page.waitForTimeout(150);
  const itemCountAfterRemove = await page.locator(".checklist-item").count();
  console.log("Item removed:", itemCountAfterRemove === 1 ? "PASS" : "FAIL (" + itemCountAfterRemove + ")");

  // Collapse the editor (notes/checklist now show automatically once there's content, so
  // there's no "Close" button anymore — folding it away is the chevron in its head instead,
  // and unlike the old Close it doesn't remove the block, just its editable content).
  await page.click('.notes-editor .notes-collapse-btn');
  await page.waitForTimeout(100);
  const editorCollapsedNotClosed = await page.locator(".notes-editor.collapsed").count();
  console.log("Collapsing folds the editor instead of removing it:", editorCollapsedNotClosed === 1 ? "PASS" : "FAIL");
  const richHiddenWhileCollapsed = await page.locator(".notes-editor .notes-rich").count();
  console.log("Its editable content isn't rendered while collapsed:", richHiddenWhileCollapsed === 0 ? "PASS" : "FAIL");

  // Badge persists showing the summary after collapsing
  const badgeAfterClose = await page.locator(".task-row .notes-badge").first().textContent();
  console.log("Badge still shows summary after collapsing:", (/Notes/.test(badgeAfterClose) && /1\/1/.test(badgeAfterClose)) ? "PASS" : "FAIL (" + badgeAfterClose + ")");

  // Clicking the badge while collapsed expands it back, with everything still there
  await page.click(".task-row .notes-badge");
  await page.waitForTimeout(150);
  const expandedAgain = await page.locator(".notes-editor.collapsed").count();
  console.log("Clicking the Notes badge expands a collapsed editor back open:", expandedAgain === 0 ? "PASS" : "FAIL");
  const itemCountAfterExpand = await page.locator(".checklist-item").count();
  console.log("Its checklist is still there after expanding again:", itemCountAfterExpand === 1 ? "PASS" : "FAIL (" + itemCountAfterExpand + ")");

  // Collapse it again so the reload check below exercises the collapsed state
  await page.click('.notes-editor .notes-collapse-btn');

  // Confirm persistence to the backing store (saves are debounced ~1.1s)
  await page.waitForTimeout(1500);
  const savedTask = repoFiles["data/tasks.json"].headings[0].tasks[0];
  const savedNotesText = savedTask.notes.replace(/<[^>]+>/g, "");
  console.log("Notes persisted to storage:", savedNotesText === "Book flights and hotel before Friday." ? "PASS" : "FAIL (" + JSON.stringify(savedTask.notes) + ")");
  console.log("Checklist persisted to storage:", savedTask.checklist.length === 1 && savedTask.checklist[0].done === true ? "PASS" : "FAIL (" + JSON.stringify(savedTask.checklist) + ")");
  console.log("The collapsed preference itself is persisted:", savedTask.notesCollapsed === true ? "PASS" : "FAIL (" + savedTask.notesCollapsed + ")");

  // Reload and confirm it all survives, including staying collapsed
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const badgeAfterReload = await page.locator(".task-row .notes-badge").first().textContent();
  console.log("Badge correct after reload:", (/Notes/.test(badgeAfterReload) && /1\/1/.test(badgeAfterReload)) ? "PASS" : "FAIL (" + badgeAfterReload + ")");
  const collapsedAfterReload = await page.locator(".notes-editor.collapsed").count();
  console.log("Notes block reloads in the same collapsed state it was left in:", collapsedAfterReload === 1 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

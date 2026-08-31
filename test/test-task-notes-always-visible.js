const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// A task's notes/checklist used to be hidden until you clicked its Notes badge, every
// single time — even once you'd already written something there. Now the block shows up
// on its own whenever there's content, same spirit as heading/sub-heading notes, with a
// chevron to fold it away again (and back) if you want it out of the way.

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": {
      headings: [
        {
          id: "h1", title: "Work", color: null,
          tasks: [
            { id: "t1", text: "Empty task", done: false, due: null, notes: "", checklist: [] },
            { id: "t2", text: "Has notes", done: false, due: null, notes: "Bring the charger.", checklist: [] },
            { id: "t3", text: "Has checklist only", done: false, due: null, notes: "", checklist: [
              { id: "c1", text: "Pack bag", done: false }
            ] },
            { id: "t4", text: "Has notes, manually collapsed", done: false, due: null, notes: "Already dealt with.", checklist: [], notesCollapsed: true }
          ],
          subheadings: []
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

  // --- A task with no notes/checklist shows nothing, unprompted ---
  console.log("A task with no notes/checklist shows no notes block on load:",
    await page.locator('.task-row[data-task-id="t1"] .notes-editor').count() === 0 ? "PASS" : "FAIL");

  // --- A task with notes text shows its block automatically, expanded ---
  console.log("A task with existing notes shows its block automatically (no click needed):",
    await page.locator('.task-row[data-task-id="t2"] .notes-editor').count() === 1 ? "PASS" : "FAIL");
  console.log("...and it starts expanded, not collapsed:",
    await page.locator('.task-row[data-task-id="t2"] .notes-editor.collapsed').count() === 0 ? "PASS" : "FAIL");
  const t2Text = await page.locator('.task-row[data-task-id="t2"] .notes-rich').innerText();
  console.log("...showing the actual note content:", t2Text.trim() === "Bring the charger." ? "PASS" : "FAIL (" + t2Text + ")");

  // --- A task with only a checklist (no notes text) also shows automatically ---
  console.log("A task with only checklist items also shows its block automatically:",
    await page.locator('.task-row[data-task-id="t3"] .notes-editor').count() === 1 ? "PASS" : "FAIL");
  console.log("...with the checklist item visible:",
    await page.locator('.task-row[data-task-id="t3"] .checklist-item').count() === 1 ? "PASS" : "FAIL");

  // --- A task manually collapsed on a previous visit stays collapsed on load ---
  console.log("A task previously collapsed loads collapsed, not forced back open:",
    await page.locator('.task-row[data-task-id="t4"] .notes-editor.collapsed').count() === 1 ? "PASS" : "FAIL");
  console.log("...its editable content isn't rendered while collapsed:",
    await page.locator('.task-row[data-task-id="t4"] .notes-rich').count() === 0 ? "PASS" : "FAIL");
  const t4BadgeText = await page.locator('.task-row[data-task-id="t4"] .notes-badge').textContent();
  console.log("...but its badge still reflects the content underneath:", /Notes/.test(t4BadgeText) ? "PASS" : "FAIL (" + t4BadgeText + ")");

  // --- Collapsing t2 via its chevron folds it without losing the text ---
  await page.click('.task-row[data-task-id="t2"] .notes-collapse-btn');
  await page.waitForTimeout(100);
  console.log("Clicking the chevron collapses the block:",
    await page.locator('.task-row[data-task-id="t2"] .notes-editor.collapsed').count() === 1 ? "PASS" : "FAIL");
  await page.waitForTimeout(1500);
  const savedT2 = repoFiles["data/tasks.json"].headings[0].tasks.filter(t => t.id === "t2")[0];
  console.log("The collapse is persisted, but the note text is untouched:",
    savedT2.notesCollapsed === true && savedT2.notes === "Bring the charger." ? "PASS" : "FAIL (" + JSON.stringify(savedT2) + ")");

  // --- Re-expanding via the badge (not the chevron, since it's hidden while collapsed) ---
  await page.click('.task-row[data-task-id="t2"] .notes-badge');
  await page.waitForTimeout(100);
  console.log("Clicking the Notes badge re-expands a collapsed block:",
    await page.locator('.task-row[data-task-id="t2"] .notes-editor.collapsed').count() === 0 ? "PASS" : "FAIL");
  const t2TextAfterExpand = await page.locator('.task-row[data-task-id="t2"] .notes-rich').innerText();
  console.log("...with the note text still there:", t2TextAfterExpand.trim() === "Bring the charger." ? "PASS" : "FAIL (" + t2TextAfterExpand + ")");

  // --- A freshly-typed note on a previously-empty task stays visible after an unrelated
  // full re-render elsewhere (e.g. toggling another task's checkbox) — this is the crux of
  // "shouldn't be collapsed/hidden by default" ---
  await page.click('.task-row[data-task-id="t1"] .notes-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .notes-rich', { timeout: 5000 });
  await page.locator('.task-row[data-task-id="t1"] .notes-rich').click();
  await page.keyboard.type("New note on the fly.");
  await page.locator('.task-row[data-task-id="t1"] .notes-rich').evaluate(el => el.blur());
  await page.waitForTimeout(150);
  // Toggle a different task's checkbox — this triggers a full render() elsewhere in the app.
  await page.locator('.task-row[data-task-id="t3"] .check').click();
  await page.waitForTimeout(150);
  console.log("A newly-written note survives an unrelated re-render, still expanded and visible:",
    await page.locator('.task-row[data-task-id="t1"] .notes-editor:not(.collapsed) .notes-rich').count() === 1 ? "PASS" : "FAIL");
  const t1TextAfterRerender = await page.locator('.task-row[data-task-id="t1"] .notes-rich').innerText();
  console.log("...with the text intact:", t1TextAfterRerender.trim() === "New note on the fly." ? "PASS" : "FAIL (" + t1TextAfterRerender + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

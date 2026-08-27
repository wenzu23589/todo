const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Plan trip", done: false, due: null, notes: "", checklist: [] },
      // Legacy plain-text note (pre-rich-text save) with an embedded newline and a
      // literal "<" character, to check the one-time migration doesn't mis-render it.
      { id: "t2", text: "Old task", done: false, due: null, notes: "Line one\nLine two <urgent>", checklist: [] }
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

  // --- Legacy plain-text migration ---
  await page.click('.task-row[data-task-id="t2"] .notes-badge');
  await page.waitForSelector('.task-row[data-task-id="t2"] .notes-rich', { timeout: 5000 });
  const migratedText = await page.locator('.task-row[data-task-id="t2"] .notes-rich').innerText();
  console.log("Legacy plain-text note's literal '<' survives migration (not parsed as a tag):", /<urgent>/.test(migratedText) ? "PASS" : "FAIL (" + migratedText + ")");
  console.log("Legacy note's line break is preserved as two visible lines:", /Line one/.test(migratedText) && /Line two/.test(migratedText) ? "PASS" : "FAIL (" + migratedText + ")");
  await page.click('.task-row[data-task-id="t2"] .notes-editor [data-act="close"]');

  // --- Toolbar formatting on the fresh task ---
  await page.click('.task-row[data-task-id="t1"] .notes-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .notes-rich', { timeout: 5000 });
  const toolbarCount = await page.locator('.task-row[data-task-id="t1"] .notes-toolbar .notes-fmt-btn').count();
  console.log("Notes toolbar offers 6 formatting controls (bold/italic/underline/bulleted/numbered/link):", toolbarCount === 6 ? "PASS" : "FAIL (" + toolbarCount + ")");

  const richBox = page.locator('.task-row[data-task-id="t1"] .notes-rich');
  await richBox.click();
  await page.keyboard.type("hello world");
  // Select "hello" (first 5 characters) via keyboard, then bold it
  await page.keyboard.press("Home");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.click('.task-row[data-task-id="t1"] .notes-fmt-btn[data-cmd="bold"]');
  await page.waitForTimeout(100);
  const hasBoldTag = await richBox.evaluate(el => /<b>|<strong>/i.test(el.innerHTML));
  console.log("Bold button wraps the selected text in a bold tag:", hasBoldTag ? "PASS" : "FAIL (" + await richBox.evaluate(el => el.innerHTML) + ")");

  // Select "world" and italicize + underline it
  await page.keyboard.press("End");
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.click('.task-row[data-task-id="t1"] .notes-fmt-btn[data-cmd="italic"]');
  await page.click('.task-row[data-task-id="t1"] .notes-fmt-btn[data-cmd="underline"]');
  await page.waitForTimeout(100);
  const hasItalicAndUnderline = await richBox.evaluate(el => (/<i>|<em>/i.test(el.innerHTML)) && (/<u>/i.test(el.innerHTML)));
  console.log("Italic + underline buttons apply to the selected text:", hasItalicAndUnderline ? "PASS" : "FAIL (" + await richBox.evaluate(el => el.innerHTML) + ")");

  // --- Hyperlink ---
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await page.click('.task-row[data-task-id="t1"] .notes-fmt-btn[data-act="link"]');
  await page.waitForSelector('.task-row[data-task-id="t1"] .notes-link-popover', { timeout: 5000 });
  await page.fill('.task-row[data-task-id="t1"] .notes-link-input', "example.com");
  await page.click('.task-row[data-task-id="t1"] .notes-link-popover [data-act="apply-link"]');
  await page.waitForTimeout(150);
  const linkHref = await richBox.locator("a").getAttribute("href");
  console.log("Adding a link with no scheme normalizes to https://:", linkHref === "https://example.com" ? "PASS" : "FAIL (" + linkHref + ")");
  await richBox.evaluate(el => el.blur());
  await page.waitForTimeout(1500);

  // --- Persistence + sanitization ---
  // (rel/target are added by sanitizeNotesHtml at save time, not live in the DOM
  // while still editing — so this is checked against the saved HTML, not the live box.)
  const savedNotes = repoFiles["data/tasks.json"].headings[0].tasks[0].notes;
  console.log("Formatted notes (bold/italic/underline/link) persist to storage:", /<b>|<strong>/i.test(savedNotes) && /<a href="https:\/\/example\.com"/.test(savedNotes) ? "PASS" : "FAIL (" + savedNotes + ")");
  console.log("Saved link gets rel=noopener noreferrer for safety:", /rel="noopener noreferrer"/.test(savedNotes) ? "PASS" : "FAIL (" + savedNotes + ")");
  console.log("Only the allowed tags are stored (no stray attributes like style=):", !/style=/i.test(savedNotes) ? "PASS" : "FAIL (" + savedNotes + ")");

  // --- Reload and confirm formatting survives ---
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  await page.click('.task-row[data-task-id="t1"] .notes-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .notes-rich', { timeout: 5000 });
  const reloadedHtml = await page.locator('.task-row[data-task-id="t1"] .notes-rich').evaluate(el => el.innerHTML);
  console.log("Formatting survives reload:", (/<b>|<strong>/i.test(reloadedHtml)) && /<a href="https:\/\/example\.com"/.test(reloadedHtml) ? "PASS" : "FAIL (" + reloadedHtml + ")");

  // --- Badge unaffected by formatting markup (still just reflects presence of text) ---
  const badgeText = await page.locator('.task-row[data-task-id="t1"] .notes-badge').textContent();
  console.log("Notes badge shows a plain 'Notes' label, not raw markup:", badgeText.trim() === "Notes" ? "PASS" : "FAIL (" + badgeText + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Plan conference", done: false, due: null, subtasks: [
        { id: "st1", text: "Book venue", done: false, due: null },
        { id: "st2", text: "Send invites", done: true, due: { date: "2026-08-10", time: null, allDay: true } }
      ] }
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

  // Badge shows pre-seeded count
  const badgeText = await page.locator(".subtasks-badge").first().textContent();
  console.log("Badge shows pre-seeded 1/2 count:", /1\/2/.test(badgeText) ? "PASS" : "FAIL (" + badgeText + ")");
  const badgeClass = await page.locator(".subtasks-badge").first().getAttribute("class");
  console.log("Badge is 'set' when subtasks exist:", /\bset\b/.test(badgeClass) ? "PASS" : "FAIL (" + badgeClass + ")");

  // Open editor, confirm both subtasks render correctly
  await page.click(".subtasks-badge");
  await page.waitForSelector(".subtasks-editor", { timeout: 5000 });
  const subtaskTexts = await page.locator(".subtask-text").evaluateAll(els => els.map(e => e.value));
  console.log("Both subtasks render with correct text:", JSON.stringify(subtaskTexts) === JSON.stringify(["Book venue", "Send invites"]) ? "PASS" : "FAIL (" + JSON.stringify(subtaskTexts) + ")");
  const doneClass = await page.locator('.subtask-item[data-subtask-id="st2"]').getAttribute("class");
  console.log("Completed subtask has .done styling:", /\bdone\b/.test(doneClass) ? "PASS" : "FAIL (" + doneClass + ")");
  const st2DueText = await page.locator('.subtask-item[data-subtask-id="st2"] .subtask-due-badge').textContent();
  console.log("Subtask with a due date shows it:", /2026|Aug/.test(st2DueText) ? "PASS" : "FAIL (" + st2DueText + ")");
  const st1DueText = await page.locator('.subtask-item[data-subtask-id="st1"] .subtask-due-badge').textContent();
  console.log("Subtask with no due date shows placeholder:", st1DueText.trim() === "Add date" ? "PASS" : "FAIL (" + st1DueText + ")");

  // Add a new subtask via Enter key
  await page.fill(".subtask-add-input", "Order catering");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  const countAfterAdd = await page.locator(".subtask-item").count();
  console.log("New subtask added via Enter:", countAfterAdd === 3 ? "PASS" : "FAIL (" + countAfterAdd + ")");
  const badgeAfterAdd = await page.locator(".subtasks-badge").first().textContent();
  console.log("Badge updates after adding (1/3):", /1\/3/.test(badgeAfterAdd) ? "PASS" : "FAIL (" + badgeAfterAdd + ")");

  // Check off the new subtask
  const newItem = page.locator(".subtask-item", { has: page.locator('.subtask-text[value="Order catering"]') });
  await newItem.locator(".subtask-check").check();
  await page.waitForTimeout(150);
  const badgeAfterCheck = await page.locator(".subtasks-badge").first().textContent();
  console.log("Badge updates after checking one off (2/3):", /2\/3/.test(badgeAfterCheck) ? "PASS" : "FAIL (" + badgeAfterCheck + ")");

  // Set a due date on "Book venue" via its mini due editor
  await page.click('.subtask-item[data-subtask-id="st1"] .subtask-due-badge');
  await page.waitForSelector('.subtask-item[data-subtask-id="st1"] .due-editor', { timeout: 5000 });
  await page.fill('.subtask-item[data-subtask-id="st1"] .due-editor input[type="date"]', "2026-09-01");
  await page.click('.subtask-item[data-subtask-id="st1"] .due-editor [data-act="save"]');
  await page.waitForTimeout(150);
  const editorStillOpen = await page.locator(".subtasks-editor").count();
  console.log("Setting a subtask due date keeps the panel open (no full re-render):", editorStillOpen === 1 ? "PASS" : "FAIL");
  const st1DueTextAfter = await page.locator('.subtask-item[data-subtask-id="st1"] .subtask-due-badge').textContent();
  console.log("Subtask due date updates in place:", !/Add date/.test(st1DueTextAfter) ? "PASS" : "FAIL (" + st1DueTextAfter + ")");

  // Remove the "Send invites" subtask
  const sendInvitesItem = page.locator('.subtask-item[data-subtask-id="st2"]');
  await sendInvitesItem.hover();
  await sendInvitesItem.locator(".subtask-remove").click();
  await page.waitForTimeout(150);
  const countAfterRemove = await page.locator(".subtask-item").count();
  console.log("Subtask removed:", countAfterRemove === 2 ? "PASS" : "FAIL (" + countAfterRemove + ")");

  // Close and confirm persistence
  await page.click('.subtasks-editor [data-act="close"]');
  await page.waitForTimeout(1500);
  const savedSubtasks = repoFiles["data/tasks.json"].headings[0].tasks[0].subtasks;
  console.log("Subtasks persisted to storage:", savedSubtasks.length === 2 ? "PASS" : "FAIL (" + JSON.stringify(savedSubtasks) + ")");
  const bookVenue = savedSubtasks.find(s => s.text === "Book venue");
  console.log("Persisted subtask keeps its due date:", bookVenue && bookVenue.due && bookVenue.due.date === "2026-09-01" ? "PASS" : "FAIL (" + JSON.stringify(bookVenue) + ")");

  // Survives reload — remaining subtasks are "Book venue" (not done) and "Order
  // catering" (checked off above), so the done count is 1 of 2.
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const badgeAfterReload = await page.locator(".subtasks-badge").first().textContent();
  console.log("Badge correct after reload:", /1\/2/.test(badgeAfterReload) ? "PASS" : "FAIL (" + badgeAfterReload + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

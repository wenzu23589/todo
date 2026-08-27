const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const repoFiles = {
    "data/tasks.json": { headings: [
      { id: "h1", title: "Research — Grant Proposal", color: null, tasks: [
        { id: "t1", text: "Draft methodology section", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
      ], subheadings: [
        { id: "sh1", title: "Ethics approval", collapsed: false, collapsedDefaultApplied: true, tasks: [] }
      ] },
      // An old save from before multi-note support: a single plain `notes` string, no notesList.
      { id: "h2", title: "Legacy heading", color: null, tasks: [], subheadings: [],
        notes: "Written back when a heading could only have <b>one</b> note.", attachments: [] }
    ] }
  };
  const shas = {};
  const attachmentFiles = {};
  const putCalls = [];

  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!m) return route.fulfill({ status: 404, body: "{}" });
    const filePath = decodeURIComponent(m[3]);

    if (filePath.startsWith("attachments/")) {
      if (req.method() === "PUT") {
        const body = JSON.parse(req.postData());
        putCalls.push(filePath);
        const sha = "sha-att-" + Object.keys(attachmentFiles).length;
        attachmentFiles[filePath] = { base64: body.content, sha };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha } }) });
      }
      if (req.method() === "GET") {
        const rec = attachmentFiles[filePath];
        if (!rec) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
        return route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from(rec.base64, "base64") });
      }
      return route.fulfill({ status: 404, body: "{}" });
    }

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

  // Heading titles live in an <input value="..."> element, so text-content-based filtering
  // (hasText) can't see them — scope by render order instead (h1 is first in the JSON, h2 second).
  const headingCard = page.locator(".heading-card").nth(0);

  // --- The heading's "Add note" button is a plain add action, not a toggle — no note cards ---
  // --- exist yet, so nothing is shown until you click it. ---
  console.log("No note cards are shown before any note is added:", await headingCard.locator(".notes-editor").count() === 0 ? "PASS" : "FAIL");
  const badgeLabel = await headingCard.locator(".heading-notes-badge").textContent();
  console.log("The heading's notes button reads as an add action:", /Add note/i.test(badgeLabel) ? "PASS" : "FAIL (" + badgeLabel + ")");

  // --- Clicking it adds a note that's immediately visible — no second click needed to see it ---
  await headingCard.locator(".heading-notes-badge").click();
  await page.waitForSelector('.notes-editor', { timeout: 5000 });
  console.log("A new note is visible right away after clicking Add note:", await headingCard.locator(".notes-editor").count() === 1 ? "PASS" : "FAIL");
  console.log("The note has no checklist section (headings don't have one):", await headingCard.locator(".checklist-add-input").count() === 0 ? "PASS" : "FAIL");

  const firstRich = headingCard.locator(".notes-rich").first();
  await firstRich.click();
  await page.keyboard.type("Funded by the national research council. ");
  await headingCard.locator('.notes-fmt-btn[data-cmd="bold"]').first().click();
  await page.keyboard.type("Deadline is Sept 30.");
  await headingCard.locator('.notes-fmt-btn[data-cmd="bold"]').first().click();
  await headingCard.locator('.notes-fmt-btn[data-cmd="italic"]').first().click();
  await page.keyboard.type(" (tentative)");
  await headingCard.locator('.notes-fmt-btn[data-cmd="italic"]').first().click();

  // Bulleted and numbered lists, alongside bold/italic/underline/link. insertUnorderedList
  // is a toggle, so clicking it again would turn the list back off — press Enter twice on an
  // empty item to exit the list instead, same as a real user would.
  await page.keyboard.press("Enter");
  await headingCard.locator('.notes-fmt-btn[data-cmd="insertUnorderedList"]').first().click();
  await page.keyboard.type("Book the ethics room");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await headingCard.locator('.notes-fmt-btn[data-cmd="insertOrderedList"]').first().click();
  await page.keyboard.type("Step one");

  // Add a link the same way task notes does it
  await headingCard.locator('.notes-fmt-btn[data-act="link"]').first().click();
  await page.waitForSelector(".heading-card .notes-link-popover", { timeout: 5000 });
  await headingCard.locator(".notes-link-input").fill("council.example.org");
  await headingCard.locator('[data-act="apply-link"]').click();
  await page.waitForTimeout(150);

  // Finish editing with the explicit "Done" button rather than just clicking away, and check
  // it gives visible confirmation the note actually saved.
  const firstCard = headingCard.locator(".notes-editor").first();
  const firstDoneBtn = firstCard.locator(".notes-done-btn");
  console.log("The note has an explicit Done button, not just a silent blur-to-save:", await firstDoneBtn.count() === 1 ? "PASS" : "FAIL");
  await firstDoneBtn.click();
  await page.waitForTimeout(100);
  console.log("Clicking Done shows a brief 'Saved' confirmation:", /Saved/.test(await firstDoneBtn.textContent()) ? "PASS" : "FAIL (" + await firstDoneBtn.textContent() + ")");
  console.log("Clicking Done visually flags the card as just-saved:", await firstCard.evaluate(el => el.classList.contains("just-saved")) ? "PASS" : "FAIL");
  await page.waitForTimeout(1300);
  console.log("The 'Saved' confirmation fades back to Done shortly after:", /^Done$/.test((await firstDoneBtn.textContent()).trim()) ? "PASS" : "FAIL (" + await firstDoneBtn.textContent() + ")");

  const richHtml = await firstRich.innerHTML();
  console.log("Heading notes preserve bold formatting:", /<b>|<strong>/i.test(richHtml) ? "PASS" : "FAIL (" + richHtml + ")");
  console.log("Heading notes preserve italic formatting:", /<i>|<em>/i.test(richHtml) ? "PASS" : "FAIL (" + richHtml + ")");
  console.log("Heading notes preserve a bulleted list:", /<ul>[\s\S]*<li>/i.test(richHtml) ? "PASS" : "FAIL (" + richHtml + ")");
  console.log("Heading notes preserve a numbered list:", /<ol>[\s\S]*<li>/i.test(richHtml) ? "PASS" : "FAIL (" + richHtml + ")");
  console.log("Heading notes preserve the inserted link:", /<a[^>]+href="https:\/\/council\.example\.org"/i.test(richHtml) ? "PASS" : "FAIL (" + richHtml + ")");

  // --- A second, independent note can be added alongside the first ---
  await headingCard.locator(".heading-notes-badge").click();
  await page.waitForTimeout(150);
  console.log("A second note card appears without disturbing the first:", await headingCard.locator(".notes-editor").count() === 2 ? "PASS" : "FAIL");
  const secondRich = headingCard.locator(".notes-rich").nth(1);
  await secondRich.click();
  await page.keyboard.type("Second, unrelated note: check the printer budget.");
  await secondRich.evaluate(el => el.blur());
  await page.waitForTimeout(200);
  const firstStillIntact = await firstRich.textContent();
  console.log("The first note's content is untouched by adding the second:", /Funded by the national research council/.test(firstStillIntact) ? "PASS" : "FAIL (" + firstStillIntact + ")");

  // --- Attachments editor opens independently of the (always-visible) notes ---
  await headingCard.locator(".heading-attachments-badge").click();
  await page.waitForSelector(".heading-card .attachments-editor", { timeout: 5000 });
  console.log("Attachments editor opens alongside both still-visible notes:", await headingCard.locator(".notes-editor").count() === 2 ? "PASS" : "FAIL");

  await page.setInputFiles(".heading-card .attachment-file-input", {
    name: "budget.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF fake budget doc")
  });
  await page.waitForTimeout(300);
  console.log("Attaching a file directly to a heading works:", await headingCard.locator(".attachment-item").count() === 1 ? "PASS" : "FAIL");
  console.log("Upload PUT went to a path under attachments/:", putCalls.some(p => p.startsWith("attachments/") && p.includes("budget.pdf")) ? "PASS" : "FAIL (" + JSON.stringify(putCalls) + ")");

  const taskAttBadgeText = await page.locator('.task-row[data-task-id="t1"] .attachments-badge').textContent();
  console.log("The task inside the heading still shows 0 attachments of its own:", !/\d/.test(taskAttBadgeText) ? "PASS" : "FAIL (" + taskAttBadgeText + ")");
  await headingCard.locator('.attachments-editor [data-act="close"]').click();

  // --- Removing one note leaves the other in place ---
  await headingCard.locator(".notes-remove-btn").first().click();
  await page.waitForTimeout(150);
  console.log("Removing one note leaves exactly one behind:", await headingCard.locator(".notes-editor").count() === 1 ? "PASS" : "FAIL");
  const remainingText = await headingCard.locator(".notes-rich").first().textContent();
  console.log("The remaining note is the second one, not the removed first:", /printer budget/.test(remainingText) ? "PASS" : "FAIL (" + remainingText + ")");

  // --- Sub-heading gets its own independent, always-visible notes ---
  const subBlock = page.locator(".sub-block").first();
  console.log("Sub-heading has no note cards yet either:", await subBlock.locator(".notes-editor").count() === 0 ? "PASS" : "FAIL");
  await subBlock.locator(".sub-notes-badge").click();
  await page.waitForSelector(".sub-block .notes-editor", { timeout: 5000 });
  await subBlock.locator(".notes-rich").first().click();
  await page.keyboard.type("Submit form 27B before the ethics board meets.");
  await subBlock.locator(".notes-rich").first().evaluate(el => el.blur());
  await page.waitForTimeout(200);
  // Scope to the heading's OWN notes block specifically (.heading-body-content), not just
  // any .notes-editor under headingCard — the sub-block above renders nested inside the same
  // heading-card subtree, so an unscoped count here would double-count its note too.
  const headingOwnNotesCount = await headingCard.locator(".heading-body-content > .heading-notes-block .notes-editor").count();
  console.log("Sub-heading's note is independent of the parent heading's remaining note:",
    headingOwnNotesCount === 1 && (await subBlock.locator(".notes-editor").count()) === 1 ? "PASS" : "FAIL (heading=" + headingOwnNotesCount + ")");

  await page.waitForTimeout(1500); // debounced save

  // --- Persistence: notesList (plural, multiple entries survive) ---
  const savedHeading = repoFiles["data/tasks.json"].headings.find(h => h.id === "h1");
  console.log("Heading notesList persisted with the one remaining note:",
    Array.isArray(savedHeading.notesList) && savedHeading.notesList.length === 1 ? "PASS" : "FAIL (" + JSON.stringify(savedHeading.notesList) + ")");
  console.log("The persisted note's text matches what's left after the removal:",
    /printer budget/.test(savedHeading.notesList[0].html.replace(/<[^>]+>/g, "")) ? "PASS" : "FAIL (" + JSON.stringify(savedHeading.notesList) + ")");
  console.log("Heading attachment persisted to storage:", savedHeading.attachments.length === 1 && savedHeading.attachments[0].name === "budget.pdf" ? "PASS" : "FAIL (" + JSON.stringify(savedHeading.attachments) + ")");
  console.log("Sub-heading notes persisted to storage, independently:",
    /Submit form 27B/.test(savedHeading.subheadings[0].notesList[0].html.replace(/<[^>]+>/g, "")) ? "PASS" : "FAIL (" + JSON.stringify(savedHeading.subheadings[0]) + ")");

  // --- Legacy migration: an old single-`notes`-string heading loads as one note card ---
  const legacyCard = page.locator(".heading-card").nth(1);
  console.log("An old single-note heading shows its note as one always-visible card:", await legacyCard.locator(".notes-editor").count() === 1 ? "PASS" : "FAIL");
  const legacyText = await legacyCard.locator(".notes-rich").first().textContent();
  console.log("The migrated note kept its original text:", /one note/.test(legacyText) ? "PASS" : "FAIL (" + legacyText + ")");

  // --- Survives reload ---
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const headingCardAfterReload = page.locator(".heading-card").nth(0);
  // Scoped the same way as above — the reloaded heading also carries its sub-heading (with
  // its own now-persisted note) nested in the same subtree.
  console.log("Heading note survives reload:",
    await headingCardAfterReload.locator(".heading-body-content > .heading-notes-block .notes-editor").count() === 1 ? "PASS" : "FAIL");
  const reloadedText = await headingCardAfterReload.locator(".notes-rich").first().textContent();
  console.log("The reloaded note's text is intact:", /printer budget/.test(reloadedText) ? "PASS" : "FAIL (" + reloadedText + ")");
  const legacyCardAfterReload = page.locator(".heading-card").nth(1);
  console.log("The migrated legacy note also survives reload, now stored as notesList:", await legacyCardAfterReload.locator(".notes-editor").count() === 1 ? "PASS" : "FAIL");
  const legacySavedShape = repoFiles["data/tasks.json"].headings.find(h => h.id === "h2");
  console.log("The legacy heading no longer carries the old singular `notes` field:", legacySavedShape.notes === undefined ? "PASS" : "FAIL (" + JSON.stringify(legacySavedShape.notes) + ")");

  // --- A brand-new heading (added via the UI) starts with no note cards, no crash ---
  await page.click("text=Add heading");
  await page.waitForTimeout(200);
  const lastCard = page.locator(".heading-card").last();
  console.log("A freshly-added heading starts with no note cards:", await lastCard.locator(".notes-editor").count() === 0 ? "PASS" : "FAIL");
  await lastCard.locator(".heading-notes-badge").click();
  await page.waitForTimeout(150);
  console.log("Adding a note to a freshly-created heading works too:", await lastCard.locator(".notes-editor").count() === 1 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

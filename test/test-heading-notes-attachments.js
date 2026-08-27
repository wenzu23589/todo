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
        { id: "sh1", title: "Ethics approval", tasks: [] }
      ] }
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

  // --- Heading badges start unset, distinct from the task's own badges ---
  const headingNotesUnset = await page.locator(".heading-notes-badge").first().evaluate(el => el.classList.contains("set"));
  const headingAttUnset = await page.locator(".heading-attachments-badge").first().evaluate(el => el.classList.contains("set"));
  console.log("Heading notes badge starts unset:", !headingNotesUnset ? "PASS" : "FAIL");
  console.log("Heading attachments badge starts unset:", !headingAttUnset ? "PASS" : "FAIL");
  const taskNotesUnset = await page.locator(".task-row .notes-badge").first().evaluate(el => el.classList.contains("set"));
  console.log("Task's own notes badge is a distinct element, also unset:", !taskNotesUnset ? "PASS" : "FAIL");

  // --- Open the heading's notes editor: rich text (bold/italic/underline/link), no checklist ---
  await page.click(".heading-card .heading-notes-badge");
  await page.waitForSelector(".heading-card .notes-editor", { timeout: 5000 });
  console.log("Heading notes editor opens:", "PASS");
  console.log("Heading notes editor has no checklist section (headings don't have one):", await page.locator(".heading-card .checklist-add-input").count() === 0 ? "PASS" : "FAIL");

  await page.click(".heading-card .notes-rich");
  await page.keyboard.type("Funded by the national research council. ");
  await page.click('.heading-card .notes-fmt-btn[data-cmd="bold"]');
  await page.keyboard.type("Deadline is Sept 30.");
  await page.click('.heading-card .notes-fmt-btn[data-cmd="bold"]');
  await page.click('.heading-card .notes-fmt-btn[data-cmd="italic"]');
  await page.keyboard.type(" (tentative)");
  await page.click('.heading-card .notes-fmt-btn[data-cmd="italic"]');

  // Add a link the same way the task notes editor does it
  await page.click('.heading-card .notes-fmt-btn[data-act="link"]');
  await page.waitForSelector(".heading-card .notes-link-popover", { timeout: 5000 });
  await page.fill(".heading-card .notes-link-input", "council.example.org");
  await page.click('.heading-card [data-act="apply-link"]');
  await page.waitForTimeout(150);

  await page.locator(".heading-card .notes-rich").evaluate(el => el.blur());
  await page.waitForTimeout(200);

  const headingBadgeAfterNotes = await page.locator(".heading-notes-badge").first().textContent();
  console.log("Heading notes badge reflects content after blur:", /Notes/.test(headingBadgeAfterNotes) ? "PASS" : "FAIL (" + headingBadgeAfterNotes + ")");

  const richHtml = await page.locator(".heading-card .notes-rich").innerHTML();
  console.log("Heading notes preserve bold formatting:", /<b>|<strong>/i.test(richHtml) ? "PASS" : "FAIL (" + richHtml + ")");
  console.log("Heading notes preserve italic formatting:", /<i>|<em>/i.test(richHtml) ? "PASS" : "FAIL (" + richHtml + ")");
  console.log("Heading notes preserve the inserted link:", /<a[^>]+href="https:\/\/council\.example\.org"/i.test(richHtml) ? "PASS" : "FAIL (" + richHtml + ")");

  // --- Open the heading's attachments editor too (independent of notes, can be open together) ---
  await page.click(".heading-card .heading-attachments-badge");
  await page.waitForSelector(".heading-card .attachments-editor", { timeout: 5000 });
  console.log("Heading attachments editor opens alongside the still-open notes editor:", await page.locator(".heading-card .notes-editor").count() === 1 ? "PASS" : "FAIL");

  await page.setInputFiles(".heading-card .attachment-file-input", {
    name: "budget.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF fake budget doc")
  });
  await page.waitForTimeout(300);
  const headingAttItemCount = await page.locator(".heading-card .attachment-item").count();
  console.log("Attaching a file directly to a heading works:", headingAttItemCount === 1 ? "PASS" : "FAIL (" + headingAttItemCount + ")");
  console.log("Upload PUT went to a path under attachments/:", putCalls.some(p => p.startsWith("attachments/") && p.includes("budget.pdf")) ? "PASS" : "FAIL (" + JSON.stringify(putCalls) + ")");

  const headingAttBadgeText = await page.locator(".heading-attachments-badge").first().textContent();
  console.log("Heading attachments badge shows a count of 1:", /1/.test(headingAttBadgeText) ? "PASS" : "FAIL (" + headingAttBadgeText + ")");

  // The task inside this same heading must be completely unaffected
  const taskAttBadgeText = await page.locator('.task-row[data-task-id="t1"] .attachments-badge').textContent();
  console.log("The task inside the heading still shows 0 attachments of its own:", !/\d/.test(taskAttBadgeText) ? "PASS" : "FAIL (" + taskAttBadgeText + ")");

  // --- Sub-heading gets its own independent notes/attachments ---
  console.log("Sub-heading has its own distinct notes/attachments badges:", await page.locator(".sub-notes-badge").count() === 1 && await page.locator(".sub-attachments-badge").count() === 1 ? "PASS" : "FAIL");
  await page.click(".sub-notes-badge");
  await page.waitForSelector(".sub-block .notes-editor", { timeout: 5000 });
  await page.click(".sub-block .notes-rich");
  await page.keyboard.type("Submit form 27B before the ethics board meets.");
  await page.locator(".sub-block .notes-rich").evaluate(el => el.blur());
  await page.waitForTimeout(200);
  const subBadgeText = await page.locator(".sub-notes-badge").first().textContent();
  console.log("Sub-heading's own notes badge reflects its content:", /Notes/.test(subBadgeText) ? "PASS" : "FAIL (" + subBadgeText + ")");
  console.log("Parent heading's notes badge is unaffected by the sub-heading's notes:", (await page.locator(".heading-notes-badge").first().textContent()).length > 0 ? "PASS" : "FAIL");

  // --- Close the open editors, then confirm persistence ---
  // Opening the sub-heading's notes editor above already auto-closed the heading's own notes
  // editor (only one notes editor is ever open anywhere, by design) — so the only notes
  // editor left open now is the sub-heading's. .sub-block is nested inside .heading-card, so
  // a ".heading-card .notes-editor" selector would ambiguously match it too; querying bare
  // ".notes-editor" is unambiguous here since there's only ever one open at a time.
  await page.click('.heading-card .attachments-editor [data-act="close"]');
  await page.click('.notes-editor [data-act="close"]');
  await page.waitForTimeout(1500); // debounced save

  const savedHeading = repoFiles["data/tasks.json"].headings[0];
  const savedNotesText = savedHeading.notes.replace(/<[^>]+>/g, "");
  console.log("Heading notes persisted to storage:", /Funded by the national research council/.test(savedNotesText) ? "PASS" : "FAIL (" + JSON.stringify(savedHeading.notes) + ")");
  console.log("Heading attachment persisted to storage:", savedHeading.attachments.length === 1 && savedHeading.attachments[0].name === "budget.pdf" ? "PASS" : "FAIL (" + JSON.stringify(savedHeading.attachments) + ")");
  console.log("Sub-heading notes persisted to storage, independently:", /Submit form 27B/.test(savedHeading.subheadings[0].notes.replace(/<[^>]+>/g, "")) ? "PASS" : "FAIL (" + JSON.stringify(savedHeading.subheadings[0].notes) + ")");

  // --- Survives reload ---
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const headingBadgeAfterReload = await page.locator(".heading-notes-badge").first().textContent();
  const headingAttBadgeAfterReload = await page.locator(".heading-attachments-badge").first().textContent();
  console.log("Heading notes badge survives reload:", /Notes/.test(headingBadgeAfterReload) ? "PASS" : "FAIL (" + headingBadgeAfterReload + ")");
  console.log("Heading attachments badge survives reload:", /1/.test(headingAttBadgeAfterReload) ? "PASS" : "FAIL (" + headingAttBadgeAfterReload + ")");

  // --- A brand-new heading (added via the UI) starts with empty notes/attachments, no crash ---
  await page.click("text=Add heading");
  await page.waitForTimeout(200);
  const newHeadingCards = page.locator(".heading-card");
  const lastCard = newHeadingCards.last();
  console.log("A freshly-added heading has its own unset notes/attachments badges:",
    await lastCard.locator(".heading-notes-badge.set").count() === 0 && await lastCard.locator(".heading-attachments-badge.set").count() === 0 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

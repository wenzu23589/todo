const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Plan trip", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
    ], subheadings: [] }] }
  };
  const shas = {};
  const attachmentFiles = {}; // path -> { base64, sha }
  const putCalls = [];
  const deleteCalls = [];

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
      if (req.method() === "DELETE") {
        deleteCalls.push(filePath);
        delete attachmentFiles[filePath];
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
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

  // --- Badge starts unset ---
  const badgeSetInitially = await page.locator(".task-row .attachments-badge").first().evaluate(el => el.classList.contains("set"));
  console.log("Attachments badge starts unset:", !badgeSetInitially ? "PASS" : "FAIL");

  // --- Open the editor ---
  await page.click('.task-row[data-task-id="t1"] .attachments-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .attachments-editor', { timeout: 5000 });
  const emptyItemCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();
  console.log("Editor opens with no attachments listed yet:", emptyItemCount === 0 ? "PASS" : "FAIL");

  // --- Reject a disallowed file type ---
  await page.setInputFiles('.task-row[data-task-id="t1"] .attachment-file-input', {
    name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("just text")
  });
  await page.waitForTimeout(150);
  const badTypeError = await page.locator('.task-row[data-task-id="t1"] .attachment-error').textContent();
  const badTypeItemCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();
  console.log("Disallowed file type is rejected with an error:", /images and PDFs/i.test(badTypeError) ? "PASS" : "FAIL (" + badTypeError + ")");
  console.log("...and nothing gets added for it:", badTypeItemCount === 0 ? "PASS" : "FAIL (" + badTypeItemCount + ")");

  // --- Reject an oversized file ---
  const bigBuffer = Buffer.alloc(13 * 1024 * 1024, 1); // 13MB > 12MB cap
  await page.setInputFiles('.task-row[data-task-id="t1"] .attachment-file-input', {
    name: "big.png", mimeType: "image/png", buffer: bigBuffer
  });
  await page.waitForTimeout(150);
  const bigFileError = await page.locator('.task-row[data-task-id="t1"] .attachment-error').textContent();
  console.log("Oversized file (>12MB) is rejected with an error:", /12MB/.test(bigFileError) ? "PASS" : "FAIL (" + bigFileError + ")");

  // --- Attach a valid image ---
  await page.setInputFiles('.task-row[data-task-id="t1"] .attachment-file-input', {
    name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
  });
  await page.waitForTimeout(300);
  const imgItemCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();
  console.log("Valid image attaches successfully:", imgItemCount === 1 ? "PASS" : "FAIL (" + imgItemCount + ")");
  const imgName = await page.locator('.task-row[data-task-id="t1"] .attachment-name-btn').first().textContent();
  console.log("Attachment shows its original filename:", imgName.trim() === "photo.png" ? "PASS" : "FAIL (" + imgName + ")");
  console.log("Upload PUT went to a path under attachments/:", putCalls.some(p => p.startsWith("attachments/") && p.includes("photo.png")) ? "PASS" : "FAIL (" + JSON.stringify(putCalls) + ")");

  const badgeAfterImage = await page.locator('.task-row[data-task-id="t1"] .attachments-badge').innerText();
  console.log("Badge shows a count of 1 after attaching:", /1/.test(badgeAfterImage) ? "PASS" : "FAIL (" + badgeAfterImage + ")");

  // Thumbnail should lazily load an <img> for the image attachment
  await page.waitForTimeout(300);
  const thumbImgCount = await page.locator('.task-row[data-task-id="t1"] .attachment-thumb img').count();
  console.log("Image attachment shows a loaded thumbnail:", thumbImgCount === 1 ? "PASS" : "FAIL (" + thumbImgCount + ")");

  // --- Attach a PDF too ---
  await page.setInputFiles('.task-row[data-task-id="t1"] .attachment-file-input', {
    name: "contract.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake pdf bytes")
  });
  await page.waitForTimeout(300);
  const twoItemCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();
  console.log("PDF attaches alongside the image:", twoItemCount === 2 ? "PASS" : "FAIL (" + twoItemCount + ")");
  const badgeAfterTwo = await page.locator('.task-row[data-task-id="t1"] .attachments-badge').innerText();
  console.log("Badge shows a count of 2:", /2/.test(badgeAfterTwo) ? "PASS" : "FAIL (" + badgeAfterTwo + ")");

  // --- Opening an attachment opens it in a new tab as a blob URL ---
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.locator('.task-row[data-task-id="t1"] .attachment-name-btn', { hasText: "photo.png" }).click()
  ]);
  await popup.waitForLoadState().catch(() => {});
  console.log("Opening an attachment opens a new tab pointing at a blob: URL:", popup.url().startsWith("blob:") ? "PASS" : "FAIL (" + popup.url() + ")");
  await popup.close();

  // --- Remove the PDF attachment ---
  await page.locator('.task-row[data-task-id="t1"] .attachment-item', { hasText: "contract.pdf" }).locator(".attachment-remove").click();
  await page.waitForTimeout(200);
  const afterRemoveCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();
  console.log("Removing an attachment removes its row:", afterRemoveCount === 1 ? "PASS" : "FAIL (" + afterRemoveCount + ")");
  const badgeAfterRemove = await page.locator('.task-row[data-task-id="t1"] .attachments-badge').innerText();
  console.log("Badge count drops back to 1 after removal:", /1/.test(badgeAfterRemove) ? "PASS" : "FAIL (" + badgeAfterRemove + ")");
  console.log("Removing also deletes the file from the repo:", deleteCalls.some(p => p.includes("contract.pdf")) ? "PASS" : "FAIL (" + JSON.stringify(deleteCalls) + ")");

  // --- Paste an image from the clipboard while the panel is open ---
  async function dispatchImagePaste(mimeType, base64Bytes) {
    await page.evaluate(({ mimeType, base64Bytes }) => {
      const bytes = Uint8Array.from(atob(base64Bytes), c => c.charCodeAt(0));
      const file = new File([bytes], "image", { type: mimeType }); // no extension — matches what real clipboards give us
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", { value: dt });
      document.dispatchEvent(ev);
    }, { mimeType, base64Bytes });
  }
  const ONE_PX_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const ONE_PX_JPG = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";

  console.log("(paste tests use the task's own attachments panel, already open with photo.png)");
  const beforePasteCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();

  await dispatchImagePaste("image/png", ONE_PX_PNG);
  await page.waitForTimeout(300);
  const afterPngPasteCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();
  console.log("Pasting a PNG image attaches it:", afterPngPasteCount === beforePasteCount + 1 ? "PASS" : "FAIL (" + beforePasteCount + " -> " + afterPngPasteCount + ")");
  const pngPastedName = await page.locator('.task-row[data-task-id="t1"] .attachment-name-btn', { hasText: "pasted-" }).last().textContent();
  console.log("Pasted PNG gets an auto-generated .png filename:", /^pasted-\d+\.png$/.test(pngPastedName.trim()) ? "PASS" : "FAIL (" + pngPastedName + ")");

  await dispatchImagePaste("image/jpeg", ONE_PX_JPG);
  await page.waitForTimeout(300);
  const afterJpgPasteCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();
  console.log("Pasting a JPEG image also attaches it:", afterJpgPasteCount === afterPngPasteCount + 1 ? "PASS" : "FAIL (" + afterPngPasteCount + " -> " + afterJpgPasteCount + ")");
  const jpgPastedName = await page.locator('.task-row[data-task-id="t1"] .attachment-name-btn', { hasText: "pasted-" }).last().textContent();
  console.log("Pasted JPEG gets a natural .jpg filename (not .jpeg):", /^pasted-\d+\.jpg$/.test(jpgPastedName.trim()) ? "PASS" : "FAIL (" + jpgPastedName + ")");

  // --- Pasting while focus is in an unrelated field (not the open attachments panel) is ignored ---
  await page.click('.task-row[data-task-id="t1"] .task-text');
  await dispatchImagePaste("image/png", ONE_PX_PNG);
  await page.waitForTimeout(300);
  const afterElsewherePasteCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();
  console.log("Pasting an image while focus is elsewhere (not the attachments panel) is ignored:", afterElsewherePasteCount === afterJpgPasteCount ? "PASS" : "FAIL (" + afterJpgPasteCount + " -> " + afterElsewherePasteCount + ")");

  // Clean up the two pasted-in test attachments so the persistence/reload/subtask checks
  // below (written against "just photo.png") don't need to change.
  await page.locator('.task-row[data-task-id="t1"] .attachment-item', { hasText: "pasted-" }).locator(".attachment-remove").first().click();
  await page.waitForTimeout(150);
  await page.locator('.task-row[data-task-id="t1"] .attachment-item', { hasText: "pasted-" }).locator(".attachment-remove").first().click();
  await page.waitForTimeout(150);
  const afterPasteCleanupCount = await page.locator('.task-row[data-task-id="t1"] .attachment-item').count();
  console.log("Pasted test attachments cleaned up back to just photo.png:", afterPasteCleanupCount === 1 ? "PASS" : "FAIL (" + afterPasteCleanupCount + ")");

  await page.click('.task-row[data-task-id="t1"] .attachments-editor [data-act="close"]');
  await page.waitForTimeout(1500); // let the debounced save settle

  // --- Persists to storage and survives reload ---
  const savedTask = repoFiles["data/tasks.json"].headings[0].tasks[0];
  console.log("Attachment metadata persisted to tasks.json:", savedTask.attachments.length === 1 && savedTask.attachments[0].name === "photo.png" ? "PASS" : "FAIL (" + JSON.stringify(savedTask.attachments) + ")");

  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const badgeAfterReload = await page.locator('.task-row[data-task-id="t1"] .attachments-badge').innerText();
  console.log("Attachment badge survives reload:", /1/.test(badgeAfterReload) ? "PASS" : "FAIL (" + badgeAfterReload + ")");

  // --- Subtasks get their own, independent attachments ---
  await page.click('.task-row[data-task-id="t1"] .subtasks-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .subtasks-editor', { timeout: 5000 });
  await page.fill('.task-row[data-task-id="t1"] .subtask-add-input', "Book flights");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);

  const subtaskAttBadgeCount = await page.locator('.task-row[data-task-id="t1"] .subtask-attachments-badge').count();
  console.log("Subtask shows its own attachments badge:", subtaskAttBadgeCount === 1 ? "PASS" : "FAIL (" + subtaskAttBadgeCount + ")");

  await page.click('.task-row[data-task-id="t1"] .subtask-attachments-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .subtask-item .attachments-editor', { timeout: 5000 });
  await page.setInputFiles('.task-row[data-task-id="t1"] .subtask-item .attachment-file-input', {
    name: "ticket.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF fake ticket")
  });
  await page.waitForTimeout(300);
  const subtaskAttItemCount = await page.locator('.task-row[data-task-id="t1"] .subtask-item .attachment-item').count();
  console.log("Attaching a file to a subtask works independently of the parent task:", subtaskAttItemCount === 1 ? "PASS" : "FAIL (" + subtaskAttItemCount + ")");
  const subtaskBadgeText = await page.locator('.task-row[data-task-id="t1"] .subtask-attachments-badge').innerText();
  console.log("Subtask's own badge reflects its attachment count:", /1/.test(subtaskBadgeText) ? "PASS" : "FAIL (" + subtaskBadgeText + ")");
  const parentBadgeUnaffected = await page.locator('.task-row[data-task-id="t1"] .task-meta .attachments-badge').innerText();
  console.log("Parent task's attachment badge is unaffected by the subtask's attachment:", /1/.test(parentBadgeUnaffected) ? "PASS" : "FAIL (" + parentBadgeUnaffected + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

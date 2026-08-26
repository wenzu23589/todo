// Covers two features together: free-text search across tasks/notes/tags/subtasks/
// attachments, and the OCR / PDF text-extraction pipeline that feeds attachment text
// into that search.
//
// The OCR/PDF-extraction libraries (Tesseract.js, pdfjs-dist) are loaded by the app
// from a CDN at runtime. This sandbox's network egress blocks that CDN outright, and
// even with access, Tesseract.js's language model is a multi-MB runtime download with
// no local equivalent available here — so real OCR accuracy isn't something this test
// (or realistically any fully offline test) can exercise end to end. Instead, the CDN
// URLs are intercepted and served fake-tesseract.js / fake-pdfjs.mjs (see those files),
// small stand-ins that implement the real, documented API shape of each library. That
// verifies the app's integration code — calling the library correctly, using its
// result, falling back from PDF text-layer extraction to OCR when there's no text
// layer, handling failures — without depending on the real OCR engine or a language
// model that can't be fetched here.
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

const TESSERACT_CDN = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const PDFJS_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const FAKE_TESSERACT_JS = fs.readFileSync(path.join(__dirname, "fixtures", "fake-tesseract.js"), "utf8");
const FAKE_PDFJS_MJS = fs.readFileSync(path.join(__dirname, "fixtures", "fake-pdfjs.mjs"), "utf8");

function fakePdfBytes(pages) { return Buffer.from(JSON.stringify({ pages: pages })); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Plan launch", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [
        { id: "st1", text: "Draft the rocket budget", done: false, due: null, attachments: [] }
      ], attachments: [] },
      { id: "t2", text: "Unrelated errand", done: false, due: null, notes: "buy milk", checklist: [], tags: ["home"], priority: null, subtasks: [], attachments: [] },
      // A legacy attachment saved before OCR/search shipped — no extractedText/textStatus.
      { id: "t3", text: "Old scanned receipt task", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [
        { id: "a-legacy", name: "legacy.png", path: "attachments/a-legacy-legacy.png", mime: "image/png", type: "image", size: 100, sha: "sha-legacy" }
      ] }
    ], subheadings: [] }] }
  };
  const shas = {};
  const attachmentFiles = {
    "attachments/a-legacy-legacy.png": { base64: Buffer.from("legacy image bytes").toString("base64") }
  };

  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!m) return route.fulfill({ status: 404, body: "{}" });
    const filePath = decodeURIComponent(m[3]);
    if (filePath.startsWith("attachments/")) {
      if (req.method() === "PUT") {
        const body = JSON.parse(req.postData());
        const sha = "sha-att-" + Object.keys(attachmentFiles).length;
        attachmentFiles[filePath] = { base64: body.content, sha };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha } }) });
      }
      if (req.method() === "GET") {
        const rec = attachmentFiles[filePath];
        if (!rec) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
        return route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from(rec.base64, "base64") });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
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

  await page.route(TESSERACT_CDN, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_TESSERACT_JS }));
  await page.route(PDFJS_CDN, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_PDFJS_MJS }));
  await page.route(PDFJS_WORKER_CDN, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));

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

  async function visibleTexts() {
    return page.locator(".task-row .task-text").evaluateAll(els => els.map(e => e.value));
  }
  async function search(q) {
    await page.fill("#task-search-input", q);
    await page.waitForTimeout(250);
  }

  // --- Basic search matching ---
  await search("launch");
  console.log("Search matches task title:", JSON.stringify(await visibleTexts()) === JSON.stringify(["Plan launch"]) ? "PASS" : "FAIL (" + JSON.stringify(await visibleTexts()) + ")");

  await search("milk");
  console.log("Search matches notes text:", JSON.stringify(await visibleTexts()) === JSON.stringify(["Unrelated errand"]) ? "PASS" : "FAIL");

  await search("home");
  console.log("Search matches a tag:", JSON.stringify(await visibleTexts()) === JSON.stringify(["Unrelated errand"]) ? "PASS" : "FAIL");

  await search("rocket budget");
  console.log("Search matches text inside a subtask:", JSON.stringify(await visibleTexts()) === JSON.stringify(["Plan launch"]) ? "PASS" : "FAIL (" + JSON.stringify(await visibleTexts()) + ")");

  await search("legacy.png");
  console.log("Search matches an attachment's filename:", JSON.stringify(await visibleTexts()) === JSON.stringify(["Old scanned receipt task"]) ? "PASS" : "FAIL (" + JSON.stringify(await visibleTexts()) + ")");

  await search("zzz_nomatch");
  const statusNoMatch = await page.locator("#search-status").textContent();
  console.log("Search shows 'No matches' status for a query that matches nothing:", statusNoMatch.trim() === "No matches" ? "PASS" : "FAIL (" + statusNoMatch + ")");

  await search("task");
  const statusSomeMatch = await page.locator("#search-status").textContent();
  console.log("Search status shows a count when something matches:", /tasks? found/.test(statusSomeMatch) ? "PASS" : "FAIL (" + statusSomeMatch + ")");

  await search("");
  const allBack = await visibleTexts();
  console.log("Clearing the search box shows everything again:", allBack.length === 3 ? "PASS" : "FAIL (" + JSON.stringify(allBack) + ")");

  // --- Search combines with the other filters (AND) ---
  await page.evaluate(() => document.querySelector('.task-row[data-task-id="t2"] .priority-flag').click()); // None -> High
  await page.click("#priority-filter-btn");
  await page.waitForSelector(".priority-filter-popover", { timeout: 5000 });
  await page.check('.priority-filter-cb[value="high"]');
  await page.click("body");
  await search("errand");
  const priorityAndSearch = await visibleTexts();
  console.log("Search narrows within an already-active priority filter (AND, not OR):", JSON.stringify(priorityAndSearch) === JSON.stringify(["Unrelated errand"]) ? "PASS" : "FAIL (" + JSON.stringify(priorityAndSearch) + ")");
  await search("launch"); // matches a different task than the priority filter allows
  const priorityBlocksSearch = await visibleTexts();
  console.log("...and a search match that fails the priority filter still doesn't show:", priorityBlocksSearch.length === 0 ? "PASS" : "FAIL (" + JSON.stringify(priorityBlocksSearch) + ")");
  await page.click("#priority-filter-btn");
  await page.waitForSelector(".priority-filter-popover", { timeout: 5000 });
  await page.click("#priority-filter-clear");
  await page.click("body");
  await search("");

  // --- Search is session-only, like the other filters ---
  await search("launch");
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const afterReload = await visibleTexts();
  console.log("Search resets on reload:", afterReload.length === 3 ? "PASS" : "FAIL (" + JSON.stringify(afterReload) + ")");

  // --- A legacy attachment (no extractedText/textStatus) gets OCR'd automatically the
  // --- moment its editor is opened, using its own filename-derived OCR text ---
  await page.evaluate(() => { window.__fakeOcrText = "PROJECT MERCURY"; });
  await page.click('.task-row[data-task-id="t3"] .attachments-badge');
  await page.waitForSelector('.task-row[data-task-id="t3"] .attachment-item', { timeout: 5000 });
  await page.waitForFunction(() => window.__fakeOcrRecognizeCalls >= 1, null, { timeout: 5000 });
  await page.waitForTimeout(300);
  const legacyStatusLine = await page.locator('.task-row[data-task-id="t3"] .attachment-size').first().textContent();
  console.log("Legacy (pre-existing) attachment finishes extraction instead of staying stuck:", legacyStatusLine.trim() !== "Reading text…" ? "PASS" : "FAIL (" + legacyStatusLine + ")");
  await page.click('.task-row[data-task-id="t3"] .attachments-editor [data-act="close"]');
  await search("mercury");
  const legacySearchMatch = await visibleTexts();
  console.log("The legacy attachment's freshly-OCR'd text is searchable:", JSON.stringify(legacySearchMatch) === JSON.stringify(["Old scanned receipt task"]) ? "PASS" : "FAIL (" + JSON.stringify(legacySearchMatch) + ")");
  await search("");

  // --- Fresh image upload triggers OCR, and the OCR'd text becomes searchable ---
  await page.evaluate(() => { window.__fakeOcrRecognizeCalls = 0; window.__fakeOcrText = "INVOICE NUMBER 88213"; });
  await page.click('.task-row[data-task-id="t1"] .attachments-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .attachments-editor', { timeout: 5000 });
  await page.setInputFiles('.task-row[data-task-id="t1"] .attachment-file-input', {
    name: "photo.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
  });
  await page.waitForFunction(() => window.__fakeOcrRecognizeCalls >= 1, null, { timeout: 5000 });
  await page.waitForTimeout(300);
  console.log("Uploading an image runs it through OCR (Tesseract worker created):", await page.evaluate(() => window.__fakeTesseractCreateWorkerCalls >= 1) ? "PASS" : "FAIL");
  await page.click('.task-row[data-task-id="t1"] .attachments-editor [data-act="close"]');
  await search("88213");
  const imageOcrSearchMatch = await visibleTexts();
  console.log("A freshly-uploaded image's OCR'd text is searchable right away:", JSON.stringify(imageOcrSearchMatch) === JSON.stringify(["Plan launch"]) ? "PASS" : "FAIL (" + JSON.stringify(imageOcrSearchMatch) + ")");
  await search("");

  // --- PDF with a real text layer: extracted directly, OCR never runs for it ---
  const ocrCallsBeforePdf = await page.evaluate(() => window.__fakeOcrRecognizeCalls || 0);
  await page.click('.task-row[data-task-id="t2"] .attachments-badge');
  await page.waitForSelector('.task-row[data-task-id="t2"] .attachments-editor', { timeout: 5000 });
  await page.setInputFiles('.task-row[data-task-id="t2"] .attachment-file-input', {
    name: "contract.pdf", mimeType: "application/pdf", buffer: fakePdfBytes(["This agreement covers WIDGET DELIVERY terms."])
  });
  await page.waitForFunction(() => window.__fakePdfjsGetDocumentCalls >= 1, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const ocrCallsAfterTextPdf = await page.evaluate(() => window.__fakeOcrRecognizeCalls || 0);
  console.log("A PDF with a real text layer extracts instantly without falling back to OCR:", ocrCallsAfterTextPdf === ocrCallsBeforePdf ? "PASS" : "FAIL");
  await page.click('.task-row[data-task-id="t2"] .attachments-editor [data-act="close"]');
  await search("widget delivery");
  const pdfTextSearchMatch = await visibleTexts();
  console.log("The PDF's extracted text layer is searchable:", JSON.stringify(pdfTextSearchMatch) === JSON.stringify(["Unrelated errand"]) ? "PASS" : "FAIL (" + JSON.stringify(pdfTextSearchMatch) + ")");
  await search("");

  // --- PDF with NO text layer: falls back to rendering pages + OCR ---
  await page.evaluate(() => { window.__fakeOcrText = "HANDWRITTEN NOTE ABOUT ZEBRAS"; });
  const ocrCallsBeforeScannedPdf = await page.evaluate(() => window.__fakeOcrRecognizeCalls || 0);
  await page.click('.task-row[data-task-id="t1"] .attachments-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .attachments-editor', { timeout: 5000 });
  await page.setInputFiles('.task-row[data-task-id="t1"] .attachment-file-input', {
    name: "scanned.pdf", mimeType: "application/pdf", buffer: fakePdfBytes([""])
  });
  await page.waitForFunction((before) => (window.__fakeOcrRecognizeCalls || 0) > before, ocrCallsBeforeScannedPdf, { timeout: 5000 });
  await page.waitForTimeout(300);
  console.log("A PDF with no text layer falls back to rendering its page(s) and running OCR:", "PASS");
  await page.click('.task-row[data-task-id="t1"] .attachments-editor [data-act="close"]');
  await search("zebras");
  const scannedPdfSearchMatch = await visibleTexts();
  console.log("The scanned PDF's OCR-fallback text is searchable:", JSON.stringify(scannedPdfSearchMatch) === JSON.stringify(["Plan launch"]) ? "PASS" : "FAIL (" + JSON.stringify(scannedPdfSearchMatch) + ")");
  await search("");

  // --- OCR failure is handled gracefully (doesn't hang or crash the row) ---
  await page.evaluate(() => { window.__fakeOcrShouldFail = true; });
  await page.click('.task-row[data-task-id="t2"] .attachments-badge');
  await page.waitForSelector('.task-row[data-task-id="t2"] .attachments-editor', { timeout: 5000 });
  await page.setInputFiles('.task-row[data-task-id="t2"] .attachment-file-input', {
    name: "broken.png", mimeType: "image/png", buffer: Buffer.from([1, 2, 3])
  });
  await page.waitForTimeout(500);
  const brokenRowStillThere = await page.locator('.task-row[data-task-id="t2"] .attachment-item', { hasText: "broken.png" }).count();
  console.log("An attachment whose OCR fails stays in the list (not silently dropped):", brokenRowStillThere === 1 ? "PASS" : "FAIL");
  const brokenRowSize = await page.locator('.task-row[data-task-id="t2"] .attachment-item', { hasText: "broken.png" }).locator(".attachment-size").textContent();
  console.log("...and settles on showing its file size again rather than being stuck on 'Reading text…':", brokenRowSize.trim() !== "Reading text…" ? "PASS" : "FAIL (" + brokenRowSize + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

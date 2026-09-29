// Word, Excel and PowerPoint attachments: accepted (even when the phone reports no file type),
// shown with their own icons, opened by downloading under the real file name, and their text
// made searchable.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
const FIX = path.resolve(__dirname, "fixtures");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }
function check(label, ok, detail) { console.log(label + ":", ok ? "PASS" : "FAIL" + (detail !== undefined ? " (" + detail + ")" : "")); }

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Prepare documents", done: false, due: null, attachments: [] },
      { id: "t2", text: "Unrelated task", done: false, due: null, attachments: [] }
    ], subheadings: [] }] }
  };
  const attachmentFiles = {};
  let sha = "sha-1";

  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const m = new URL(req.url()).pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!m) return route.fulfill({ status: 404, body: "{}" });
    const filePath = decodeURIComponent(m[3]);
    if (filePath.startsWith("attachments/")) {
      if (req.method() === "PUT") {
        attachmentFiles[filePath] = JSON.parse(req.postData()).content;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-" + filePath } }) });
      }
      if (req.method() === "GET") {
        if (!attachmentFiles[filePath]) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
        return route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from(attachmentFiles[filePath], "base64") });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (req.method() === "GET") {
      if (!repoFiles[filePath]) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: b64(repoFiles[filePath]), sha, encoding: "base64" }) });
    }
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      repoFiles[filePath] = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
      sha = "sha-" + Math.random();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha } }) });
    }
    return route.fulfill({ status: 404, body: "{}" });
  });

  await page.goto(HTML_PATH);
  await page.waitForSelector("#modal-root .modal-box", { timeout: 5000 });
  await page.fill("#f-owner", "wenzu23589");
  await page.fill("#f-repo", "todo");
  await page.fill("#f-token", "fake-pat-token");
  await page.click("#settings-save");
  await page.waitForSelector("#modal-root .modal-box", { state: "detached", timeout: 5000 });
  await page.waitForSelector(".task-row", { timeout: 5000 });

  await page.click('.task-row[data-task-id="t1"] .attachments-badge');
  await page.waitForSelector('.task-row[data-task-id="t1"] .attachments-editor');
  const input = '.task-row[data-task-id="t1"] .attachment-file-input';

  const accept = await page.locator(input).getAttribute("accept");
  check("The file picker offers .docx, .xlsx and .pptx", /\.docx/.test(accept) && /\.xlsx/.test(accept) && /\.pptx/.test(accept), accept);
  const hint = await page.locator('.task-row[data-task-id="t1"] .attachment-hint').textContent();
  check("The hint mentions Word, Excel and PowerPoint", /Word/.test(hint) && /Excel/.test(hint) && /PowerPoint/.test(hint), hint);

  // Word with its proper type; Excel with NO type (as some phones report); PowerPoint as generic binary.
  await page.setInputFiles(input, { name: "Guidelines.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: fs.readFileSync(path.join(FIX, "sample.docx")) });
  await page.waitForTimeout(400);
  await page.setInputFiles(input, { name: "Budget.xlsx", mimeType: "", buffer: fs.readFileSync(path.join(FIX, "sample.xlsx")) });
  await page.waitForTimeout(400);
  await page.setInputFiles(input, { name: "Final report.pptx", mimeType: "application/octet-stream", buffer: fs.readFileSync(path.join(FIX, "sample.pptx")) });
  await page.waitForTimeout(1200);

  const names = await page.locator('.task-row[data-task-id="t1"] .attachment-name-btn').allTextContents();
  check("All three Office files attach", JSON.stringify(names.map(n => n.trim())) === JSON.stringify(["Guidelines.docx", "Budget.xlsx", "Final report.pptx"]), JSON.stringify(names));
  const err = await page.locator('.task-row[data-task-id="t1"] .attachment-error').isHidden();
  check("No error is shown for them", err);
  check("Each file was uploaded to the repo", Object.keys(attachmentFiles).length === 3, Object.keys(attachmentFiles).join(", "));

  const letters = await page.locator('.task-row[data-task-id="t1"] .attachment-thumb text').allTextContents();
  check("Each shows its own icon (W, X, P)", JSON.stringify(letters) === JSON.stringify(["W", "X", "P"]), JSON.stringify(letters));

  await page.waitForTimeout(1500); // debounced save
  const saved = repoFiles["data/tasks.json"].headings[0].tasks[0].attachments;
  check("Saved with the right types", JSON.stringify(saved.map(a => a.type)) === JSON.stringify(["docx", "xlsx", "pptx"]), JSON.stringify(saved.map(a => a.type)));
  check("A file with no reported type is saved with the proper Excel type",
    saved[1].mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", saved[1].mime);
  check("Word text is extracted for search", saved[0].textStatus === "done" && /partner school by Friday & confirm/.test(saved[0].extractedText), saved[0].textStatus + " / " + saved[0].extractedText);
  check("Excel text from every sheet is extracted", /Erasmus budget/.test(saved[1].extractedText) && /Travel to Nicosia/.test(saved[1].extractedText) && /Dissemination costs/.test(saved[1].extractedText), saved[1].extractedText);
  const ppt = saved[2].extractedText || "";
  check("PowerPoint text from every slide is extracted", /CARS final report/.test(ppt) && /Closing slide about augmented reality/.test(ppt), ppt.slice(0, 120));
  check("PowerPoint slides come out in order (slide 2 before slide 10)", ppt.indexOf("Children as creators") < ppt.indexOf("Slide 10"), ppt.slice(0, 200));

  // Opening downloads the file under its real name, rather than a blank tab.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('.task-row[data-task-id="t1"] .attachment-name-btn', { hasText: "Budget.xlsx" }).click()
  ]);
  check("Opening an Office file downloads it under its real name", download.suggestedFilename() === "Budget.xlsx", download.suggestedFilename());
  const dlPath = await download.path();
  check("The downloaded file is identical to the original", fs.readFileSync(dlPath).equals(fs.readFileSync(path.join(FIX, "sample.xlsx"))));
  const tip = await page.locator('.task-row[data-task-id="t1"] .attachment-name-btn', { hasText: "Guidelines.docx" }).getAttribute("title");
  check("Hovering explains it opens in Word", tip === "Download to open in Word", tip);

  // Search finds the task by text inside the attachments.
  await page.locator('.task-row[data-task-id="t1"] .attachments-editor [data-act="close"]').click();
  await page.fill("#task-search-input", "Nicosia");
  await page.waitForTimeout(400);
  const hits = await page.locator(".task-row:visible").evaluateAll(els => els.map(e => e.getAttribute("data-task-id")));
  check("Searching for a word inside the spreadsheet finds the task", JSON.stringify(hits) === JSON.stringify(["t1"]), JSON.stringify(hits));
  await page.fill("#task-search-input", "augmented reality");
  await page.waitForTimeout(400);
  const hits2 = await page.locator(".task-row:visible").evaluateAll(els => els.map(e => e.getAttribute("data-task-id")));
  check("Searching for a phrase on a slide finds the task", JSON.stringify(hits2) === JSON.stringify(["t1"]), JSON.stringify(hits2));
  await page.fill("#task-search-input", "");

  // Other file types are still refused.
  await page.click('.task-row[data-task-id="t2"] .attachments-badge');
  await page.setInputFiles('.task-row[data-task-id="t2"] .attachment-file-input', { name: "old.doc", mimeType: "application/msword", buffer: Buffer.from("legacy") });
  await page.waitForTimeout(200);
  const refused = await page.locator('.task-row[data-task-id="t2"] .attachment-error').textContent();
  check("Other file types (e.g. an old .doc) are still refused", /\.docx, \.xlsx, \.pptx/.test(refused) && (await page.locator('.task-row[data-task-id="t2"] .attachment-item').count()) === 0, refused);

  await browser.close();
}
main().catch(err => { console.error(err); process.exit(1); });

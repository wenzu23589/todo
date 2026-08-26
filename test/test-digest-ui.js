const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = { "data/tasks.json": { headings: [] } };
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
  await page.waitForSelector("#quick-capture-btn", { timeout: 5000 });

  // Open Calendar settings — digest section should be present, off by default
  await page.click("#gcal-pill");
  await page.waitForSelector("#digest-enabled", { timeout: 5000 });
  const checkedInitially = await page.locator("#digest-enabled").isChecked();
  console.log("Digest toggle starts unchecked:", !checkedInitially ? "PASS" : "FAIL");

  // Turning it on without an email should show an error, not save
  await page.check("#digest-enabled");
  await page.click("#digest-save");
  await page.waitForTimeout(150);
  const errorShown = await page.locator("#digest-error").isVisible();
  console.log("Enabling without an email shows an error:", errorShown ? "PASS" : "FAIL");
  console.log("Nothing written to storage yet:", repoFiles["data/digest-settings.json"] === undefined ? "PASS" : "FAIL");

  // Fill email and save
  await page.fill("#digest-email", "lawrence.farrugi@um.edu.mt");
  await page.click("#digest-save");
  await page.waitForTimeout(300);
  const savedNoteVisible = await page.locator("#digest-saved-note").isVisible();
  console.log("Shows a saved confirmation:", savedNoteVisible ? "PASS" : "FAIL");
  console.log("Persisted enabled+email to data/digest-settings.json:",
    repoFiles["data/digest-settings.json"] && repoFiles["data/digest-settings.json"].enabled === true && repoFiles["data/digest-settings.json"].email === "lawrence.farrugi@um.edu.mt" ? "PASS" : "FAIL (" + JSON.stringify(repoFiles["data/digest-settings.json"]) + ")");

  // Close and reopen the modal — settings should reload from storage
  await page.click("#cal-cancel");
  await page.waitForTimeout(100);
  await page.click("#gcal-pill");
  await page.waitForSelector("#digest-enabled", { timeout: 5000 });
  const checkedAfterReopen = await page.locator("#digest-enabled").isChecked();
  const emailAfterReopen = await page.locator("#digest-email").inputValue();
  console.log("Reopening the modal shows the saved state:", (checkedAfterReopen && emailAfterReopen === "lawrence.farrugi@um.edu.mt") ? "PASS" : "FAIL");

  // Turn it back off
  await page.uncheck("#digest-enabled");
  await page.click("#digest-save");
  await page.waitForTimeout(300);
  console.log("Turning off persists enabled:false:", repoFiles["data/digest-settings.json"].enabled === false ? "PASS" : "FAIL");

  // Full page reload — persists via GitHub, not just localStorage
  await page.reload();
  await page.waitForSelector("#quick-capture-btn", { timeout: 5000 });
  await page.click("#gcal-pill");
  await page.waitForSelector("#digest-enabled", { timeout: 5000 });
  const checkedAfterReload = await page.locator("#digest-enabled").isChecked();
  console.log("Survives full page reload:", !checkedAfterReload ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

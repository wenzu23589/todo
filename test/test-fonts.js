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
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-2" } }) });
  });

  // Block actual Google Fonts network fetches (sandbox may not allow them) — just
  // confirm the app tries to load the right family, not that the font renders visually.
  const requestedFontUrls = [];
  await page.route("https://fonts.googleapis.com/**", async (route) => {
    requestedFontUrls.push(route.request().url());
    route.fulfill({ status: 200, contentType: "text/css", body: "/* stub */" });
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

  // Default font vars should be the Ledger package
  const defaultHeadingFont = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-heading"));
  console.log("Default heading font is Fraunces:", /Fraunces/.test(defaultHeadingFont) ? "PASS" : "FAIL (" + defaultHeadingFont + ")");

  // Open theme popover, confirm Font section with 5 options is present
  await page.click("#theme-btn");
  await page.waitForSelector(".theme-font-option", { timeout: 5000 });
  const fontOptionCount = await page.locator(".theme-font-option").count();
  console.log("Font section shows 5 packages:", fontOptionCount === 5 ? "PASS" : "FAIL (" + fontOptionCount + ")");

  // Select "Modern" package
  await page.click('.theme-font-option[data-font-key="modern"]');
  await page.waitForTimeout(200);
  const headingFontAfterSwitch = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-heading"));
  const bodyFontAfterSwitch = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-body"));
  const monoFontAfterSwitch = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-mono"));
  console.log("Switched heading font to Space Grotesk:", /Space Grotesk/.test(headingFontAfterSwitch) ? "PASS" : "FAIL (" + headingFontAfterSwitch + ")");
  console.log("Switched body font to Space Grotesk:", /Space Grotesk/.test(bodyFontAfterSwitch) ? "PASS" : "FAIL (" + bodyFontAfterSwitch + ")");
  console.log("Switched mono font to Space Mono:", /Space Mono/.test(monoFontAfterSwitch) ? "PASS" : "FAIL (" + monoFontAfterSwitch + ")");

  // Confirm the Modern package's Google Fonts stylesheet was actually requested
  const requestedModernFont = requestedFontUrls.some((u) => u.includes("Space+Grotesk"));
  console.log("Modern font package's stylesheet was fetched:", requestedModernFont ? "PASS" : "FAIL");

  // Confirm the active class moved to the Modern button
  const activeLabel = await page.locator(".theme-font-option.active .theme-font-label").textContent();
  console.log("Active font option is Modern:", activeLabel === "Modern" ? "PASS" : "FAIL (" + activeLabel + ")");

  // Reload the page — the choice should persist via localStorage
  await page.reload();
  await page.waitForTimeout(300);
  const headingFontAfterReload = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-heading"));
  console.log("Font choice persists across reload:", /Space Grotesk/.test(headingFontAfterReload) ? "PASS" : "FAIL (" + headingFontAfterReload + ")");

  // Confirm h1 in the header actually renders with the chosen heading font
  const h1Font = await page.evaluate(() => getComputedStyle(document.querySelector("h1")).fontFamily);
  console.log("h1 element computed font-family reflects choice:", /Space Grotesk/.test(h1Font) ? "PASS" : "FAIL (" + h1Font + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

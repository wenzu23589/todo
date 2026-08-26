const path = require("path");
const http = require("http");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".json": "application/json", ".js": "application/javascript", ".png": "image/png" };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = req.url.split("?")[0];
      if (urlPath === "/") urlPath = "/index.html";
      const filePath = path.join(ROOT, decodeURIComponent(urlPath));
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const base = "http://127.0.0.1:" + port + "/";

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

  await page.goto(base);
  await page.waitForSelector("#modal-root .modal-box", { timeout: 5000 });
  await page.fill("#f-owner", "wenzu23589");
  await page.fill("#f-repo", "todo");
  await page.fill("#f-branch", "main");
  await page.fill("#f-path", "data/tasks.json");
  await page.fill("#f-token", "fake-pat-token");
  await page.click("#settings-save");
  await page.waitForSelector("#modal-root .modal-box", { state: "detached", timeout: 5000 });

  // Manifest link present and points to valid, well-formed JSON
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  console.log("Manifest link present:", manifestHref === "manifest.json" ? "PASS" : "FAIL (" + manifestHref + ")");

  const manifestResp = await page.request.get(base + "manifest.json");
  const manifest = await manifestResp.json();
  console.log("Manifest fetches as valid JSON:", manifestResp.ok() ? "PASS" : "FAIL");
  console.log("Manifest has name/short_name 'Daybook':", (manifest.name === "Daybook" && manifest.short_name === "Daybook") ? "PASS" : "FAIL");
  console.log("Manifest display is standalone:", manifest.display === "standalone" ? "PASS" : "FAIL");
  console.log("Manifest lists 3 icons (192, 512, maskable):", Array.isArray(manifest.icons) && manifest.icons.length === 3 ? "PASS" : "FAIL (" + JSON.stringify(manifest.icons) + ")");

  // Each icon actually resolves
  for (const icon of manifest.icons) {
    const r = await page.request.get(base + icon.src);
    console.log("Icon resolves (" + icon.src + "):", r.ok() ? "PASS" : "FAIL (" + r.status() + ")");
  }

  // theme-color + apple touch icon present
  const themeColor = await page.locator('meta[name="theme-color"]').getAttribute("content");
  console.log("theme-color meta present:", /^#[0-9a-f]{6}$/i.test(themeColor || "") ? "PASS" : "FAIL (" + themeColor + ")");
  const appleTouchHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  console.log("apple-touch-icon link present:", appleTouchHref === "icons/apple-touch-icon.png" ? "PASS" : "FAIL (" + appleTouchHref + ")");

  // Service worker actually registers (http://127.0.0.1 counts as a secure context)
  await page.waitForFunction(() => navigator.serviceWorker.getRegistrations().then(r => r.length > 0), { timeout: 8000 })
    .then(() => console.log("Service worker registers:", "PASS"))
    .catch(async () => {
      const regs = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(r => r.length));
      console.log("Service worker registers:", "FAIL (registrations=" + regs + ")");
    });

  await browser.close();
  server.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const repoFiles = { "data/tasks.json": { headings: [] } };
  const shas = {};

  await page.addInitScript(() => {
    window.__requestAccessTokenCalls = 0;
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: function (cfg) {
            const client = { callback: cfg.callback };
            client.requestAccessToken = function () {
              window.__requestAccessTokenCalls++;
              setTimeout(function () {
                client.callback({ access_token: "fake-token-" + window.__requestAccessTokenCalls, expires_in: 3600 });
              }, 10);
            };
            return client;
          }
        }
      }
    };
  });

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

  await page.route("https://www.googleapis.com/calendar/v3/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/users/me/calendarList")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "primary", summary: "To Do", backgroundColor: "#4a5fc1" }] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
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

  // Connect Google Calendar for the first time
  await page.click("#gcal-pill");
  await page.waitForSelector("#f-clientid", { timeout: 5000 });
  await page.fill("#f-clientid", "fake-client-id.apps.googleusercontent.com");
  await page.click("#cal-connect");
  await page.waitForSelector('[data-state="connected"]', { timeout: 5000 });
  const callsAfterFirstConnect = await page.evaluate(() => window.__requestAccessTokenCalls);
  console.log("Calls to requestAccessToken after first connect:", callsAfterFirstConnect, callsAfterFirstConnect === 1 ? "(expected 1)" : "(unexpected)");

  // Reload the page — this simulates a plain refresh. window.__requestAccessTokenCalls
  // is reinjected to 0 on every navigation (addInitScript runs fresh each load), so
  // any count > 0 here means the app asked Google for a brand-new token (i.e. a popup)
  // even though the cached one was still valid.
  await page.reload();
  await page.waitForSelector('[data-state="connected"]', { timeout: 5000 });
  const callsAfterReload = await page.evaluate(() => window.__requestAccessTokenCalls);
  console.log("New requestAccessToken calls triggered by reload:", callsAfterReload,
    callsAfterReload === 0 ? "PASS (reused cached token, no new popup)" : "FAIL (triggered a new token request / popup on refresh)");

  // Reload again for good measure
  await page.reload();
  await page.waitForSelector('[data-state="connected"]', { timeout: 5000 });
  const callsAfterSecondReload = await page.evaluate(() => window.__requestAccessTokenCalls);
  console.log("New requestAccessToken calls triggered by 2nd reload:", callsAfterSecondReload,
    callsAfterSecondReload === 0 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });

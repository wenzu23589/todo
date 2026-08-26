// Playwright test for the ICS external-calendar feature.
// Mocks the GitHub Contents API (tasks.json, ics-feeds.json, ics-events.json)
// and Google Identity Services / Calendar API, then drives the UI.
const path = require("path");
const { chromium } = require("playwright");

const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");

function b64(obj) {
  return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64");
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push("console.error: " + msg.text()); });

  // in-memory fake GitHub repo contents
  const repoFiles = {
    "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: "#4a5fc1", tasks: [], subheadings: [] }] },
    // start with NO ics-feeds.json / ics-events.json to test the "doesn't exist yet" path
  };
  const shas = {};

  await page.addInitScript(() => {
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: function (cfg) {
            const client = { callback: cfg.callback };
            client.requestAccessToken = function () {
              setTimeout(function () {
                client.callback({ access_token: "fake-token", expires_in: 3600 });
              }, 10);
            };
            return client;
          }
        }
      }
    };
  });

  await page.route("https://accounts.google.com/gsi/client**", (route) => {
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });

  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!m) { return route.fulfill({ status: 404, body: "{}" }); }
    const filePath = decodeURIComponent(m[3]);
    if (req.method() === "GET") {
      if (repoFiles[filePath] === undefined) {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
      }
      const sha = shas[filePath] || "sha-" + filePath.replace(/[^a-z0-9]/gi, "-") + "-1";
      shas[filePath] = sha;
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ content: b64(repoFiles[filePath]), sha: sha, encoding: "base64" })
      });
    }
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      const decoded = Buffer.from(body.content, "base64").toString("utf8");
      repoFiles[filePath] = JSON.parse(decoded);
      const newSha = "sha-" + filePath.replace(/[^a-z0-9]/gi, "-") + "-" + (Math.floor(Math.random() * 100000));
      shas[filePath] = newSha;
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ content: { sha: newSha } })
      });
    }
    return route.fulfill({ status: 404, body: "{}" });
  });

  await page.route("https://www.googleapis.com/calendar/v3/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/users/me/calendarList")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "primary", summary: "To Do", backgroundColor: "#4a5fc1" }] }) });
    }
    if (/\/calendars\/[^/]+\/events$/.test(new URL(url).pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  await page.goto(HTML_PATH);
  await page.waitForSelector("#modal-root .modal-box", { timeout: 5000 });

  // Connect to the fake GitHub repo
  await page.fill("#f-owner", "wenzu23589");
  await page.fill("#f-repo", "todo");
  await page.fill("#f-branch", "main");
  await page.fill("#f-path", "data/tasks.json");
  await page.fill("#f-token", "fake-pat-token");
  await page.click("#settings-save");
  await page.waitForSelector("#modal-root .modal-box", { state: "detached", timeout: 5000 });

  await page.click("#tab-cal");
  await page.waitForSelector(".cal-month-grid", { timeout: 5000 });

  // === Test 1: open Calendar settings with NO Google connection, confirm ICS section renders ===
  await page.click("#gcal-pill");
  await page.waitForSelector(".ics-feeds-field", { timeout: 5000 });
  const notConnectedHasIcs = await page.locator(".ics-feeds-field").count();
  console.log("Test 1 (ICS section visible without Google connection):", notConnectedHasIcs === 1 ? "PASS" : "FAIL");
  const hintText = await page.locator(".ics-feeds-field .field-hint").first().textContent();
  console.log("Test 1b (empty-state hint shown):", /no external calendars/i.test(hintText || "") ? "PASS" : "FAIL (" + hintText + ")");

  // === Test 2: add a feed ===
  await page.fill("#ics-add-name", "UM Timetable");
  await page.fill("#ics-add-url", "https://calendar.google.com/calendar/ical/example%40um.edu.mt/private-abc/basic.ics");
  await page.click("#ics-add-btn");
  await page.waitForSelector(".ics-feed-row", { timeout: 5000 });
  const feedRowText = await page.locator(".ics-feed-row .ics-feed-name").first().textContent();
  console.log("Test 2 (feed added & shown):", feedRowText === "UM Timetable" ? "PASS" : "FAIL (" + feedRowText + ")");
  const statusText = await page.locator(".ics-feed-row .ics-feed-status").first().textContent();
  console.log("Test 2b (status shows not-yet-synced):", /not yet synced/i.test(statusText || "") ? "PASS" : "FAIL (" + statusText + ")");

  // Confirm it persisted to the fake repo
  console.log("Test 2c (persisted to data/ics-feeds.json):", Array.isArray(repoFiles["data/ics-feeds.json"]) && repoFiles["data/ics-feeds.json"].length === 1 ? "PASS" : "FAIL");

  // Close settings, reopen to confirm persistence across modal reopen
  await page.click("#cal-cancel");
  await page.waitForSelector("#modal-root .modal-backdrop", { state: "detached", timeout: 5000 });
  await page.click("#gcal-pill");
  await page.waitForSelector(".ics-feed-row", { timeout: 5000 });
  const feedCountAfterReopen = await page.locator(".ics-feed-row").count();
  console.log("Test 3 (feed persists across modal reopen):", feedCountAfterReopen === 1 ? "PASS" : "FAIL (" + feedCountAfterReopen + ")");

  // === Test 4: seed data/ics-events.json now (simulating the GitHub Action having run), then force reload ===
  const feedId = repoFiles["data/ics-feeds.json"][0].id;
  repoFiles["data/ics-events.json"] = {
    generatedAt: new Date().toISOString(),
    timezone: "Europe/Malta",
    feeds: [{ id: feedId, name: "UM Timetable", ok: true, error: null, count: 1 }],
    events: [{ feedId: feedId, uid: "evt1", summary: "Lecture: Databases", date: new Date().toISOString().slice(0, 10), time: "10:00", allDay: false }]
  };
  await page.click("#cal-cancel");
  await page.waitForSelector("#modal-root .modal-backdrop", { state: "detached", timeout: 5000 });

  // ensureIcsEvents caches for 5 minutes, so simulate what happens on the next normal
  // visit (a fresh page load, e.g. next day / another device) after the background
  // GitHub Action has synced data/ics-events.json.
  await page.reload();
  await page.waitForSelector("#tab-cal", { timeout: 5000 });
  await page.click("#tab-cal");
  await page.waitForSelector(".cal-month-grid", { timeout: 5000 });
  await page.waitForTimeout(500);

  const chipTexts = await page.locator(".cal-chip").allTextContents();
  const found = chipTexts.some((t) => t.includes("Lecture: Databases"));
  console.log("Test 4 (external event renders as a calendar chip):", found ? "PASS" : "FAIL (chips: " + JSON.stringify(chipTexts) + ")");

  // Check the chip has the "other-cal" class (distinguishing it from Daybook's own task chips)
  const otherCalChip = await page.locator(".cal-chip.other-cal").count();
  console.log("Test 4b (chip uses other-cal styling):", otherCalChip >= 1 ? "PASS" : "FAIL");

  // === Test 5: remove the feed ===
  await page.click("#gcal-pill");
  await page.waitForSelector(".ics-feed-remove", { timeout: 5000 });
  await page.click(".ics-feed-remove");
  await page.waitForSelector(".ics-feed-row", { state: "detached", timeout: 5000 });
  const emptyHint = await page.locator(".ics-feeds-field .field-hint").first().textContent();
  console.log("Test 5 (feed removed, empty state returns):", /no external calendars/i.test(emptyHint || "") ? "PASS" : "FAIL (" + emptyHint + ")");
  console.log("Test 5b (persisted removal to repo):", Array.isArray(repoFiles["data/ics-feeds.json"]) && repoFiles["data/ics-feeds.json"].length === 0 ? "PASS" : "FAIL");

  await page.click("#cal-cancel");
  await page.waitForSelector("#modal-root .modal-backdrop", { state: "detached", timeout: 5000 });
  await page.waitForTimeout(300);
  const chipTextsAfterRemove = await page.locator(".cal-chip").allTextContents();
  const stillThere = chipTextsAfterRemove.some((t) => t.includes("Lecture: Databases"));
  console.log("Test 5c (removed feed's events no longer shown):", !stillThere ? "PASS" : "FAIL (chips: " + JSON.stringify(chipTextsAfterRemove) + ")");

  console.log("\nPage errors:", errors.length ? JSON.stringify(errors, null, 2) : "none");

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

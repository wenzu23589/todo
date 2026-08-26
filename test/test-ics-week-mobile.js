const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const repoFiles = { "data/tasks.json": { headings: [{ id: "h1", title: "Work", color: "#4a5fc1", tasks: [], subheadings: [] }] } };
  const feedId = "feed1";
  repoFiles["data/ics-feeds.json"] = [{ id: feedId, name: "UM Timetable", url: "https://example.com/x.ics", color: "#b3486b" }];
  const today = new Date().toISOString().slice(0, 10);
  repoFiles["data/ics-events.json"] = {
    generatedAt: new Date().toISOString(), timezone: "Europe/Malta",
    feeds: [{ id: feedId, name: "UM Timetable", ok: true, error: null, count: 1 }],
    events: [{ feedId: feedId, uid: "e1", summary: "Lecture: Databases", date: today, time: "10:00", allDay: false }]
  };
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

  await page.goto(HTML_PATH);
  await page.waitForSelector("#modal-root .modal-box", { timeout: 5000 });
  await page.fill("#f-owner", "wenzu23589");
  await page.fill("#f-repo", "todo");
  await page.fill("#f-branch", "main");
  await page.fill("#f-path", "data/tasks.json");
  await page.fill("#f-token", "fake-pat-token");
  await page.click("#settings-save");
  await page.waitForSelector("#modal-root .modal-box", { state: "detached", timeout: 5000 });

  await page.click("#tab-cal");
  await page.waitForSelector(".cal-month-grid", { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.click("#cal-mode-week");
  await page.waitForSelector(".cal-week-grid", { timeout: 5000 });
  await page.waitForTimeout(400);

  const weekChips = await page.locator(".cal-week-chip").allTextContents();
  console.log("Week view shows ICS event:", weekChips.some(t => t.includes("Lecture: Databases")) ? "PASS" : "FAIL (" + JSON.stringify(weekChips) + ")");

  const bodyOverflow = await page.evaluate(() => document.body.scrollWidth <= window.innerWidth);
  console.log("Mobile week view: no horizontal page overflow:", bodyOverflow ? "PASS" : "FAIL");

  // Open calendar settings on mobile and check no overflow there either.
  // On narrow viewports the header controls (incl. #gcal-pill) collapse into
  // a "more" menu — open it first.
  await page.click("#header-more-btn");
  await page.waitForSelector("#header-controls-inner.open", { timeout: 5000 });
  await page.click("#gcal-pill");
  await page.waitForSelector(".ics-feed-row", { timeout: 5000 });
  const settingsOverflow = await page.evaluate(() => document.body.scrollWidth <= window.innerWidth);
  console.log("Mobile calendar-settings modal: no horizontal page overflow:", settingsOverflow ? "PASS" : "FAIL");

  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });

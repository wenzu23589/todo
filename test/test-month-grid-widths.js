const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const repoFiles = {
    "data/tasks.json": {
      headings: [
        { id: "h1", title: "Work", color: "#4a5fc1", tasks: [
          { id: "t1", text: "Dating anniversary dinner @ Radisson Golden Sands", done: false, due: { date: "2026-08-17", time: null } },
          { id: "t2", text: "Shopping @ Homemate and Piscopo Gardens. Dinner and granita @ Bugibba", done: false, due: { date: "2026-08-11", time: null } },
          { id: "t3", text: "Shopping @ St George's Mall Sliema then coffee", done: false, due: { date: "2026-08-12", time: null } }
        ], subheadings: [] }
      ]
    }
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
  await page.waitForTimeout(300);

  // Measure the width of each of the 7 day-cells in the row containing Aug 11
  // (the row with the long "Shopping @ Homemate..." title, which is the reproduction case).
  const widths = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll(".cal-day-cell"));
    // Find the cell whose day-number is "11" and not "outside"
    const targetIdx = cells.findIndex(c => !c.classList.contains("outside") && c.querySelector(".cal-day-num").textContent.trim() === "11");
    if (targetIdx < 0) return null;
    const rowStart = Math.floor(targetIdx / 7) * 7;
    return cells.slice(rowStart, rowStart + 7).map(c => Math.round(c.getBoundingClientRect().width));
  });

  console.log("Day-cell widths across the row (should all be ~equal):", widths);
  if (!widths) {
    console.log("FAIL: couldn't locate the row");
  } else {
    const max = Math.max(...widths), min = Math.min(...widths);
    const spread = max - min;
    console.log("Max width:", max, "Min width:", min, "Spread:", spread);
    console.log("Columns are roughly equal width (spread <= 4px):", spread <= 4 ? "PASS" : "FAIL");
  }

  // Also confirm no horizontal page overflow resulted
  const noOverflow = await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1);
  console.log("No horizontal page overflow from long titles:", noOverflow ? "PASS" : "FAIL");

  // Confirm the long text is still findable (truncated) inside its chip, not just vanished
  const chipTexts = await page.locator(".cal-chip").allTextContents();
  const hasLongOne = chipTexts.some(t => t.includes("Shopping @ Homemate"));
  console.log("Long-title event chip still renders (truncated) rather than disappearing:", hasLongOne ? "PASS" : "FAIL (" + JSON.stringify(chipTexts) + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// The native smooth-scroll animation triggered by scrollIntoView({behavior:"smooth"}) has no
// spec'd duration, so polling for scrollY to stop changing is more robust than a fixed wait.
async function waitForScrollToSettle(page, maxWaitMs) {
  maxWaitMs = maxWaitMs || 3000;
  var start = Date.now();
  var last = null;
  var stableCount = 0;
  while (Date.now() - start < maxWaitMs) {
    var y = await page.evaluate(() => window.scrollY);
    if (y === last) {
      stableCount++;
      if (stableCount >= 2) return;
    } else {
      stableCount = 0;
    }
    last = y;
    await page.waitForTimeout(100);
  }
}

// A long list of headings meant scrolling all the way down to find one further along, with
// no way to jump directly to it. This covers the "Outline" panel: a left-side "Jump to
// heading" drawer listing every heading (and sub-heading) with a live task count. Unlike a
// one-shot modal, it stays open across clicks so you can jump to several sections in a row —
// it's dismissed explicitly (its own close button, clicking outside it, Escape, or toggling
// the Outline button again), never automatically after a single jump.

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } }); // short viewport so a jump is meaningful

  var headings = [];
  for (var i = 0; i < 12; i++) {
    headings.push({
      id: "h" + i, title: "Heading " + i, collapsed: false, color: i === 7 ? "#6f7d3a" : null,
      tasks: [
        { id: "t" + i + "a", text: "Task in heading " + i, done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
      ],
      subheadings: i === 7 ? [
        { id: "sh1", title: "A sub-heading", collapsed: false, tasks: [
          { id: "tsub", text: "Sub task", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
        ], notesList: [], attachments: [] }
      ] : [],
      notesList: [], attachments: []
    });
  }
  const repoFiles = { "data/tasks.json": { headings: headings } };
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

  console.log("Outline button is present above the list:", await page.locator("#outline-btn").count() === 1 ? "PASS" : "FAIL");

  await page.click("#outline-btn");
  await page.waitForSelector(".outline-drawer.open", { timeout: 5000 });
  console.log("Outline button shows an active state while the drawer is open:",
    await page.locator("#outline-btn").evaluate(el => el.classList.contains("active")) ? "PASS" : "FAIL");
  const itemCount = await page.locator(".outline-item").count();
  console.log("Outline lists every heading plus the one sub-heading:", itemCount === 13 ? "PASS" : "FAIL (" + itemCount + ")");

  const lastHeadingItem = page.locator('.outline-item[data-target-id="h11"]');
  console.log("Each heading item shows a task count:", /1/.test(await lastHeadingItem.locator(".outline-item-count").textContent()) ? "PASS" : "FAIL");

  const subItem = page.locator('.outline-item[data-target-id="sh1"]');
  console.log("The sub-heading item is present and visually indented:", await subItem.evaluate(el => el.classList.contains("outline-sub-item")) ? "PASS" : "FAIL");

  // --- Clicking a heading scrolls straight to it but leaves the side menu open ---
  await lastHeadingItem.click();
  await page.waitForTimeout(150); // scroll starts almost immediately
  console.log("Clicking a heading does NOT close the side menu (it stays open for more jumps):",
    await page.locator(".outline-drawer.open").count() === 1 ? "PASS" : "FAIL");
  // The browser's native smooth-scroll animation duration isn't spec'd, so poll until the
  // scroll position stops changing rather than betting on a single fixed wait.
  await waitForScrollToSettle(page);
  const targetInView = await page.locator('.heading-card[data-heading-id="h11"]').evaluate(el => {
    const r = el.getBoundingClientRect();
    // block:"start" aims to land the element flush with the viewport top; allow a hair of
    // sub-pixel rounding either side rather than requiring an exact >= 0.
    return r.top >= -2 && r.top < window.innerHeight;
  });
  console.log("The clicked heading actually scrolled into view:", targetInView ? "PASS" : "FAIL");
  console.log("The jumped-to heading gets a brief highlight flash:",
    await page.locator('.heading-card[data-heading-id="h11"]').evaluate(el => el.classList.contains("outline-highlight")) ? "PASS" : "FAIL");
  await page.waitForTimeout(1600);
  console.log("...and the highlight fades again shortly after:",
    !(await page.locator('.heading-card[data-heading-id="h11"]').evaluate(el => el.classList.contains("outline-highlight"))) ? "PASS" : "FAIL");

  // --- Jumping to a sub-heading works too, still without closing (menu was never reopened) ---
  console.log("Side menu is still open going into the second jump (no need to reopen it):",
    await page.locator(".outline-drawer.open").count() === 1 ? "PASS" : "FAIL");
  await page.click('.outline-item[data-target-id="sh1"]');
  await page.waitForTimeout(150);
  await waitForScrollToSettle(page);
  const subInView = await page.locator('.sub-block[data-sub-id="sh1"]').evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= -2 && r.top < window.innerHeight;
  });
  console.log("Jumping to a sub-heading scrolls it into view:", subInView ? "PASS" : "FAIL");
  console.log("...and still hasn't closed the menu:", await page.locator(".outline-drawer.open").count() === 1 ? "PASS" : "FAIL");

  // --- Toggling the Outline button again closes it ---
  await page.click("#outline-btn");
  await page.waitForTimeout(300);
  console.log("Clicking the Outline button again toggles the side menu closed:",
    await page.locator(".outline-drawer").count() === 0 ? "PASS" : "FAIL");
  console.log("Outline button loses its active state once closed:",
    await page.locator("#outline-btn").evaluate(el => el.classList.contains("active")) ? "FAIL" : "PASS");

  // --- Closing via the explicit Close (X) button ---
  await page.click("#outline-btn");
  await page.waitForSelector(".outline-drawer.open", { timeout: 5000 });
  await page.click("#outline-close-btn");
  await page.waitForTimeout(300);
  console.log("The close (X) button dismisses the side menu:", await page.locator(".outline-drawer").count() === 0 ? "PASS" : "FAIL");

  // --- Closing via clicking outside it (the dimmed backdrop) ---
  await page.click("#outline-btn");
  await page.waitForSelector(".outline-drawer.open", { timeout: 5000 });
  await page.mouse.click(700, 400); // well outside the 320px-wide drawer
  await page.waitForTimeout(300);
  console.log("Clicking outside the side menu also dismisses it:", await page.locator(".outline-drawer").count() === 0 ? "PASS" : "FAIL");

  // --- Closing via the Escape key ---
  await page.click("#outline-btn");
  await page.waitForSelector(".outline-drawer.open", { timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  console.log("Pressing Escape also dismisses the side menu:", await page.locator(".outline-drawer").count() === 0 ? "PASS" : "FAIL");

  // --- Clicking inside the drawer itself (not on an item) never closes it ---
  await page.click("#outline-btn");
  await page.waitForSelector(".outline-drawer.open", { timeout: 5000 });
  await page.click("#outline-title");
  await page.waitForTimeout(200);
  console.log("Clicking the drawer's own header doesn't dismiss it:", await page.locator(".outline-drawer.open").count() === 1 ? "PASS" : "FAIL");
  await page.click("#outline-close-btn");
  await page.waitForTimeout(200);

  // --- Opening/using the outline never mutates or saves anything ---
  await page.waitForTimeout(1500);
  console.log("Opening/using the outline side menu never triggers a save:",
    repoFiles["data/tasks.json"].headings.length === 12 ? "PASS" : "FAIL");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

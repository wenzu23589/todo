// The View row after simplification: only Tabs and Status layouts, no Sort control, and tasks
// always in their manual (drag) order — including for anyone with old saved preferences.
const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }
function check(label, ok, detail) { console.log(label + ":", ok ? "PASS" : "FAIL" + (detail !== undefined ? " (" + detail + ")" : "")); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const repoFiles = {
    "data/tasks.json": {
      headings: [
        { id: "h1", title: "Work", color: null, tasks: [
          { id: "t1", text: "No due date A", done: false, due: null },
          { id: "t2", text: "Due later (Sep 10)", done: false, due: { date: "2026-09-10", time: null, allDay: true }, priority: "low" },
          { id: "t3", text: "Overdue (Aug 1)", done: false, due: { date: "2026-08-01", time: null, allDay: true }, priority: "high" }
        ], subheadings: [] },
        { id: "h2", title: "Home", color: null, tasks: [ { id: "t4", text: "Home task", done: false, due: null } ], subheadings: [] }
      ]
    }
  };
  await page.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "GET") {
      if (!/data\/tasks\.json/.test(req.url())) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: b64(repoFiles["data/tasks.json"]), sha: "sha-1", encoding: "base64" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: "sha-2" } }) });
  });

  // Someone who last used Daybook with Stacked layout and Due-date sort selected.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("daybook-listlayout-v1", "stacked");
      localStorage.setItem("daybook-tasksort-v1", "due");
      sessionStorage.setItem("seeded", "1");
    }
  });
  await page.goto(HTML_PATH);
  await page.waitForSelector("#modal-root .modal-box", { timeout: 5000 });
  await page.fill("#f-owner", "wenzu23589");
  await page.fill("#f-repo", "todo");
  await page.fill("#f-token", "fake-pat-token");
  await page.click("#settings-save");
  await page.waitForSelector("#modal-root .modal-box", { state: "detached", timeout: 5000 });
  await page.waitForSelector(".task-row", { timeout: 5000 });

  check("No Sort control on the page", (await page.locator("#sort-manual-btn, #sort-priority-btn, #sort-due-btn").count()) === 0);
  check("The word Sort no longer appears in the View row", !/\bSort\b/.test(await page.locator("#list-sort-row").innerText()));
  check("No Stacked layout button", (await page.locator("#layout-stacked-btn").count()) === 0);
  const layoutLabels = await page.locator("#list-layout-toggle .list-sort-btn").allInnerTexts();
  check("View offers exactly Tabs and Status", JSON.stringify(layoutLabels) === JSON.stringify(["Tabs", "Status"]), JSON.stringify(layoutLabels));
  check("A saved Stacked preference falls back to Tabs", await page.locator("#layout-tabs-btn").evaluate(el => el.classList.contains("active")));
  const cleared = await page.evaluate(() => localStorage.getItem("daybook-tasksort-v1"));
  check("The old saved sort preference is cleared", cleared === null, cleared);

  const order = await page.locator('.heading-card[data-heading-id="h1"] .task-row .task-text').evaluateAll(els => els.map(e => e.value));
  check("Tasks show in their manual order even with an old Due-date sort saved",
    JSON.stringify(order) === JSON.stringify(["No due date A", "Due later (Sep 10)", "Overdue (Aug 1)"]), JSON.stringify(order));
  const gripsOk = await page.locator(".task-row .grip").evaluateAll(els => els.every(e => e.getAttribute("draggable") === "true" && !e.classList.contains("inactive")));
  check("Every task's drag grip is active", gripsOk);

  check("The All tab shows every heading one after another (what Stacked used to do)",
    (await page.locator(".heading-card").count()) === 2);
  await page.locator(".heading-tab-btn", { hasText: "Home" }).click();
  check("Picking a heading tab isolates that heading",
    (await page.locator(".heading-card").count()) === 1 && (await page.locator('.heading-card[data-heading-id="h2"]').count()) === 1);

  await page.click("#layout-status-btn");
  check("Status board still available", (await page.locator("#layout-status-btn").evaluate(el => el.classList.contains("active"))));
  await page.click("#layout-tabs-btn");
  check("Switching back to Tabs works", (await page.locator(".heading-card").count()) >= 1);

  await browser.close();
}
main().catch(err => { console.error(err); process.exit(1); });

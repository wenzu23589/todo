const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const repoFiles = {
    "data/tasks.json": {
      headings: [
        { id: "h1", title: "Work", color: "#4a5fc1", tasks: [
          { id: "t1", text: "No due date A", done: false, due: null },
          { id: "t2", text: "Due later (Sep 10)", done: false, due: { date: "2026-09-10", time: null, allDay: true } },
          { id: "t3", text: "Overdue (Aug 1)", done: false, due: { date: "2026-08-01", time: null, allDay: true } },
          { id: "t4", text: "No due date B", done: false, due: null },
          { id: "t5", text: "Due soon (Aug 20)", done: false, due: { date: "2026-08-20", time: "09:00", allDay: false } }
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
  await page.waitForSelector(".task-row", { timeout: 5000 });

  // Default should be Manual order (as stored)
  const manualOrder = await page.locator(".task-row .task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Default (manual) order matches storage order:",
    JSON.stringify(manualOrder) === JSON.stringify(["No due date A", "Due later (Sep 10)", "Overdue (Aug 1)", "No due date B", "Due soon (Aug 20)"])
      ? "PASS" : "FAIL (" + JSON.stringify(manualOrder) + ")");

  const manualBtnActiveBefore = await page.locator("#sort-manual-btn").evaluate(el => el.classList.contains("active"));
  console.log("Manual button starts active:", manualBtnActiveBefore ? "PASS" : "FAIL");

  // Switch to Due date sort
  await page.click("#sort-due-btn");
  await page.waitForTimeout(200);
  const dueOrder = await page.locator(".task-row .task-text").evaluateAll(els => els.map(e => e.value));
  const expectedDueOrder = ["Overdue (Aug 1)", "Due soon (Aug 20)", "Due later (Sep 10)", "No due date A", "No due date B"];
  console.log("Due-date sort order (overdue first, undated last, stable):",
    JSON.stringify(dueOrder) === JSON.stringify(expectedDueOrder) ? "PASS" : "FAIL (" + JSON.stringify(dueOrder) + ")");

  const dueBtnActive = await page.locator("#sort-due-btn").evaluate(el => el.classList.contains("active"));
  console.log("Due date button becomes active:", dueBtnActive ? "PASS" : "FAIL");

  // Grip should be inactive (non-draggable) while sorted
  const gripDraggable = await page.locator(".task-row .grip").first().evaluate(el => el.getAttribute("draggable"));
  const gripHasInactiveClass = await page.locator(".task-row .grip").first().evaluate(el => el.classList.contains("inactive"));
  console.log("Task grip is non-draggable while sorted by due date:", gripDraggable === null ? "PASS" : "FAIL (draggable=" + gripDraggable + ")");
  console.log("Task grip shows inactive styling while sorted:", gripHasInactiveClass ? "PASS" : "FAIL");

  // Reload — sort preference should persist
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const dueBtnActiveAfterReload = await page.locator("#sort-due-btn").evaluate(el => el.classList.contains("active"));
  const orderAfterReload = await page.locator(".task-row .task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Sort preference persists across reload:", dueBtnActiveAfterReload ? "PASS" : "FAIL");
  console.log("Order still due-date-sorted after reload:", JSON.stringify(orderAfterReload) === JSON.stringify(expectedDueOrder) ? "PASS" : "FAIL (" + JSON.stringify(orderAfterReload) + ")");

  // Switch back to Manual — underlying storage order should be untouched (never mutated by sort)
  await page.click("#sort-manual-btn");
  await page.waitForTimeout(200);
  const backToManualOrder = await page.locator(".task-row .task-text").evaluateAll(els => els.map(e => e.value));
  console.log("Switching back to Manual restores original stored order:",
    JSON.stringify(backToManualOrder) === JSON.stringify(["No due date A", "Due later (Sep 10)", "Overdue (Aug 1)", "No due date B", "Due soon (Aug 20)"])
      ? "PASS" : "FAIL (" + JSON.stringify(backToManualOrder) + ")");
  const gripDraggableAfterManual = await page.locator(".task-row .grip").first().evaluate(el => el.getAttribute("draggable"));
  console.log("Task grip draggable again in Manual mode:", gripDraggableAfterManual === "true" ? "PASS" : "FAIL (draggable=" + gripDraggableAfterManual + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

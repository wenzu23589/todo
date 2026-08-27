const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }

// Regression coverage for a reported data-loss bug: "I made a change, and when I refreshed
// the page the change was not there." Three distinct gaps in the old save pipeline could
// each cause exactly that symptom, and this file proves each one is closed:
//   1. The ~1.1s debounce had no flush-on-exit — closing/refreshing the tab inside that
//      window silently dropped the edit. Fixed with visibilitychange/pagehide handlers that
//      flush immediately (via a keepalive fetch) plus a beforeunload warning as a backstop.
//   2. A failed save (network blip, rate limit, etc.) cleared pendingSave even though nothing
//      was actually persisted — so the edit looked "safe" when it wasn't. Fixed by keeping
//      pendingSave true on non-conflict failures and retrying automatically.
//   3. Because pendingSave was cleared on failure, refocusing the tab 15+s later triggered a
//      refetch that silently overwrote the unsaved edit with the stale server copy. Fixed as
//      a side effect of #2: the refocus refetch is gated on pendingSave being false.

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.clock.install({ time: Date.now() });

  const repoFiles = { "data/tasks.json": { headings: [
    { id: "h1", title: "Work", color: null, tasks: [
      { id: "t1", text: "Original text", done: false, due: null, notes: "", checklist: [], tags: [], priority: null, subtasks: [], attachments: [] }
    ], subheadings: [] }
  ] } };
  const shas = {};
  let failNextPuts = 0;

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
      if (failNextPuts > 0) {
        failNextPuts--;
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "simulated outage" }) });
      }
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

  // --- 1. An edit made just before the tab is hidden is flushed immediately, not left to the debounce ---
  const input = page.locator('.task-row[data-task-id="t1"] .task-text');
  await input.fill("Edited right before switching tabs");
  await input.press("Enter");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForTimeout(300); // real time for the mocked network round-trip only
  const afterFlush = repoFiles["data/tasks.json"].headings[0].tasks[0].text;
  console.log("An edit is flushed immediately on pagehide, ahead of the normal debounce:",
    afterFlush === "Edited right before switching tabs" ? "PASS" : "FAIL (" + afterFlush + ")");

  // --- 2. beforeunload warns while a save is still outstanding, and stays quiet once it's saved ---
  await input.fill("Second edit, not yet saved");
  await input.press("Enter");
  const preventedWhilePending = await page.evaluate(() => {
    const ev = new Event("beforeunload", { cancelable: true });
    const notCancelled = window.dispatchEvent(ev);
    return !notCancelled;
  });
  console.log("beforeunload is intercepted while a save is still pending:", preventedWhilePending ? "PASS" : "FAIL");

  await page.clock.fastForward(1300); // run out the ~1.1s debounce (this PUT succeeds)
  await page.waitForTimeout(300);
  const preventedAfterSaved = await page.evaluate(() => {
    const ev = new Event("beforeunload", { cancelable: true });
    const notCancelled = window.dispatchEvent(ev);
    return !notCancelled;
  });
  console.log("beforeunload is left alone once the change is safely saved:", !preventedAfterSaved ? "PASS" : "FAIL");

  // --- 3. A save that keeps failing is never silently discarded by refocusing the tab, and ---
  //         recovers automatically once the connection is good again ---
  failNextPuts = 2; // the debounced attempt AND the first automatic retry both fail
  await input.fill("Edit made during a flaky connection");
  await input.press("Enter");
  await page.clock.fastForward(1300); // debounced attempt fires and fails
  await page.waitForTimeout(300);
  const indicatorAfterFailure = await page.locator("#save-indicator-text").textContent();
  console.log("A failed save shows an error rather than silently succeeding:",
    /couldn.?t save/i.test(indicatorAfterFailure) ? "PASS" : "FAIL (" + indicatorAfterFailure + ")");

  await page.clock.fastForward(13000); // past the automatic retry (also fails) and the 15s refocus threshold
  await page.waitForTimeout(300);

  // Simulate the user tabbing away and back well past the 15s "refetch on refocus" gate. If the
  // earlier failure had cleared pendingSave, this would silently overwrite the edit with the
  // stale server copy — which still reads "Original text" at this point.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(300);
  const textAfterRefocus = await input.inputValue();
  console.log("Refocusing the tab after a failed save does not discard the unsaved edit:",
    textAfterRefocus === "Edit made during a flaky connection" ? "PASS" : "FAIL (" + textAfterRefocus + ")");

  // The connection recovers; the user notices the banner and clicks "sync now" (the same
  // recovery path that was already there — now it actually has something to recover).
  failNextPuts = 0;
  await page.click("#sync-now-btn");
  await page.waitForTimeout(300);
  const savedAfterRecovery = repoFiles["data/tasks.json"].headings[0].tasks[0].text;
  console.log("The edit is persisted once the connection recovers and sync is retried:",
    savedAfterRecovery === "Edit made during a flaky connection" ? "PASS" : "FAIL (" + savedAfterRecovery + ")");

  const indicatorAfterRecovery = await page.locator("#save-indicator-text").textContent();
  console.log("The save indicator reflects the recovered save:",
    /saved/i.test(indicatorAfterRecovery) ? "PASS" : "FAIL (" + indicatorAfterRecovery + ")");

  // --- Survives an actual reload too, for good measure ---
  await page.reload();
  await page.waitForSelector(".task-row", { timeout: 5000 });
  const textAfterReload = await page.locator('.task-row[data-task-id="t1"] .task-text').inputValue();
  console.log("The recovered edit survives an actual page reload:",
    textAfterReload === "Edit made during a flaky connection" ? "PASS" : "FAIL (" + textAfterReload + ")");

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

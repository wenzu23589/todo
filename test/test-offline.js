// Offline support: the list is kept on the device, opens and edits with no connection,
// and changes made offline sync (merged with changes from elsewhere) once back online.
const path = require("path");
const { chromium } = require("playwright");
const HTML_PATH = "file://" + path.resolve(__dirname, "..", "index.html");
function b64(obj) { return Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)).toString("base64"); }
function unb64(s) { return JSON.parse(Buffer.from(s, "base64").toString("utf8")); }
function check(label, ok, detail) { console.log(label + ":", ok ? "PASS" : "FAIL" + (detail !== undefined ? " (" + detail + ")" : "")); }

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const repoFiles = {
    "data/tasks.json": {
      version: 3,
      headings: [
        { id: "h1", title: "Work", color: null, tasks: [
          { id: "t1", text: "Original title", done: false, due: null },
          { id: "t2", text: "Second task", done: false, due: null }
        ], subheadings: [] }
      ]
    }
  };
  let currentSha = "sha-1";
  let shaCounter = 1;
  let offline = false;
  let conflicts = 0;

  await page.route("https://api.github.com/**", async (route) => {
    if (offline) return route.abort("internetdisconnected");
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/);
    if (!m) return route.fulfill({ status: 404, body: "{}" });
    const filePath = decodeURIComponent(m[3]);
    if (filePath !== "data/tasks.json") return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Not Found" }) });
    if (req.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: b64(repoFiles[filePath]), sha: currentSha, encoding: "base64" }) });
    }
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData());
      if (body.sha !== currentSha) {
        conflicts++;
        return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "sha does not match" }) });
      }
      repoFiles[filePath] = unb64(body.content);
      currentSha = "sha-" + (++shaCounter);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: { sha: currentSha } }) });
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

  const readDeviceCopy = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.indexOf("daybook-offline-v1:") === 0);
    return key ? { key, value: JSON.parse(localStorage.getItem(key)) } : null;
  });

  // --- 1. Connecting keeps a copy of the list on the device, without the token ---
  let copy = await readDeviceCopy();
  check("A copy of the list is kept on this device after connecting", !!copy && copy.value.data.headings[0].tasks.length === 2);
  check("The device copy is marked as in sync with GitHub", !!copy && copy.value.dirty === false);
  check("The device copy does not contain the GitHub token", !!copy && JSON.stringify(copy.value).indexOf("fake-pat-token") === -1);

  // --- 2. Editing with no connection: calm offline state, change stored on the device ---
  offline = true;
  await context.setOffline(true);
  const t1 = page.locator('.task-row[data-task-id="t1"] .task-text');
  await t1.fill("Edited offline");
  await t1.press("Enter");
  await page.waitForTimeout(1800); // debounce + failed upload attempt
  const pill = await page.locator("#status-text").textContent();
  check("Status pill shows Offline rather than a sync error", pill === "Offline", pill);
  const indicator = await page.locator("#save-indicator-text").textContent();
  check("Save indicator says the change is saved on this device", /saved on this device/.test(indicator), indicator);
  const bannerHidden = await page.locator("#banner").evaluate(el => el.hidden);
  check("No red error banner is shown for being offline", bannerHidden);
  copy = await readDeviceCopy();
  check("The offline edit is in the device copy, flagged as not yet synced",
    !!copy && copy.value.dirty === true && copy.value.data.headings[0].tasks[0].text === "Edited offline");
  const warnsOnLeave = await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
  check("Leaving the page does not warn, since the change is safe on the device", !warnsOnLeave);

  // --- 3. Reopening Daybook with no connection still shows the list, including the offline edit ---
  await page.reload();
  await page.waitForSelector('.task-row[data-task-id="t1"]', { timeout: 5000 });
  const afterReload = await page.locator('.task-row[data-task-id="t1"] .task-text').inputValue();
  check("Reopened offline, the list loads from the device copy", afterReload === "Edited offline", afterReload);
  await page.waitForTimeout(500);
  const pillAfterReload = await page.locator("#status-text").textContent();
  check("Reopened offline, the status pill shows Offline", pillAfterReload === "Offline", pillAfterReload);
  const settingsOpen = await page.locator("#modal-root .modal-box").count();
  check("Reopened offline, the settings dialog does not appear", settingsOpen === 0);

  // --- 4. Meanwhile another device changes the list on GitHub ---
  const remote = repoFiles["data/tasks.json"];
  remote.headings[0].tasks[1].text = "Second task (edited on phone)";
  remote.headings[0].tasks.push({ id: "t3", text: "Added on phone", done: false, due: null });
  currentSha = "sha-phone";

  // --- 5. Back online: the offline change is merged with the phone's changes and uploaded ---
  offline = false;
  await context.setOffline(false); // fires the "online" event
  await page.waitForTimeout(2500);
  const saved = repoFiles["data/tasks.json"].headings[0].tasks;
  const byId = Object.fromEntries(saved.map(t => [t.id, t.text]));
  check("After reconnecting, the offline edit reaches GitHub", byId.t1 === "Edited offline", byId.t1);
  check("The other device's edit to a different task is kept", byId.t2 === "Second task (edited on phone)", byId.t2);
  check("The other device's new task is kept", byId.t3 === "Added on phone", byId.t3);
  check("A version conflict was actually met and merged, not overwritten", conflicts >= 1, conflicts);
  const shown = await page.locator(".task-row .task-text").evaluateAll(els => els.map(e => e.value));
  check("The merged list is what's shown on screen",
    JSON.stringify(shown) === JSON.stringify(["Edited offline", "Second task (edited on phone)", "Added on phone"]), JSON.stringify(shown));
  copy = await readDeviceCopy();
  check("The device copy is back in sync after uploading", !!copy && copy.value.dirty === false && copy.value.sha === currentSha);
  const pillOnline = await page.locator("#status-text").textContent();
  check("Status pill returns to the connected repo", pillOnline === "wenzu23589/todo", pillOnline);

  // --- 6. Edits made offline, app closed, reopened later with a connection: merged at start-up ---
  // (Network requests fail but the browser isn't told it's offline, so no "online" event
  // fires on the way back — the sync has to come from start-up itself.)
  offline = true;
  const t3 = page.locator('.task-row[data-task-id="t3"] .task-text');
  await t3.fill("Phone task, renamed offline on laptop");
  await t3.press("Enter");
  await page.waitForTimeout(1800);
  repoFiles["data/tasks.json"] = JSON.parse(JSON.stringify(repoFiles["data/tasks.json"]));
  repoFiles["data/tasks.json"].headings[0].tasks.push({ id: "t4", text: "Another from phone", done: false, due: null });
  currentSha = "sha-phone-2";
  offline = false;
  await page.reload();
  await page.waitForSelector('.task-row[data-task-id="t4"]', { timeout: 5000 });
  await page.waitForTimeout(1500);
  const saved2 = Object.fromEntries(repoFiles["data/tasks.json"].headings[0].tasks.map(t => [t.id, t.text]));
  check("Reopened online with unsynced changes: the offline rename reaches GitHub", saved2.t3 === "Phone task, renamed offline on laptop", saved2.t3);
  check("Reopened online with unsynced changes: the newer GitHub task is kept", saved2.t4 === "Another from phone", saved2.t4);

  // --- 7. Disconnecting removes the device copy ---
  await page.click("#settings-btn").catch(() => {});
  const disc = page.locator("#settings-disconnect");
  if (await disc.count()) {
    await disc.click();
    copy = await readDeviceCopy();
    check("Disconnecting removes the device copy", copy === null);
  } else {
    check("Disconnecting removes the device copy", false, "settings disconnect button not found");
  }

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });

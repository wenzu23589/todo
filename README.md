# Daybook

A to-do list with headings and sub-headings, built as a single static page. Tasks are stored as a JSON file in a GitHub repo you own, so the same list follows you across every computer and your phone — just open the page and sign in with a token once per device.

This folder has three files:

- `index.html` — the whole app (one file, no build step)
- `CNAME` — tells GitHub Pages to serve the site at `todo.lawrencefarrugiacaruana.com`
- `README.md` — this file

## 1. Create the repo

1. On GitHub, create a new repository (public or private both work) — e.g. `daybook`.
2. Upload `index.html` and `CNAME` to the root of the repo (drag-and-drop on the GitHub web UI works fine, or `git add`/`commit`/`push` if you're using git locally).

## 2. Turn on GitHub Pages

1. In the repo, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`. Save.
4. Under **Custom domain**, enter `todo.lawrencefarrugiacaruana.com` and save — this is what the `CNAME` file is for, so GitHub already expects this domain.
5. Leave the tab open; you'll come back to tick **Enforce HTTPS** once the domain is verified (step 4 below).

## 3. Point the subdomain at GitHub (Namecheap)

Since the domain is on Namecheap:

1. Log into Namecheap → **Domain List** → **Manage** next to `lawrencefarrugiacaruana.com` → **Advanced DNS**.
2. Add a new record:
   - **Type:** CNAME Record
   - **Host:** `todo`
   - **Value:** `<your-github-username>.github.io.` (note the trailing dot; use the account or org that owns the repo)
   - **TTL:** Automatic
3. Save. DNS can take anywhere from a few minutes to a few hours to propagate.
4. Back in GitHub **Settings → Pages**, once it shows the domain as verified, tick **Enforce HTTPS** (GitHub issues the certificate automatically — this can take a little while after DNS propagates).

Once that's done, `https://todo.lawrencefarrugiacaruana.com` opens the app directly.

## 4. Create a GitHub token for the app to use

The app needs a token to read and write the tasks file on your behalf. A **fine-grained personal access token**, scoped to just this repo, is the safer option:

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** "Only select repositories" → pick your `daybook` repo.
3. **Permissions → Repository permissions → Contents:** set to **Read and write**.
4. Generate, and copy the token — GitHub only shows it once.

You'll do this once per device you use the app from (or reuse the same token everywhere — your choice).

## 5. Connect the app

1. Open `https://todo.lawrencefarrugiacaruana.com`.
2. The Settings panel opens automatically the first time. Fill in:
   - **Owner:** your GitHub username (or org)
   - **Repository:** `daybook` (or whatever you named it)
   - **Branch:** `main`
   - **File path:** `data/tasks.json` (this file doesn't need to exist yet — the app creates it on first save)
   - **Personal access token:** the token from step 4
3. Click **Connect**.

The token is stored only in that browser's local storage — it's never sent anywhere except GitHub's API, and you'll need to re-enter it (or your own copy of it) on each new device or browser.

## How it works

- Add headings (e.g. "Work", "This week"), sub-headings inside them, and tasks inside those.
- Click a task's due-date pill to give it a date (and optional time). Overdue tasks are flagged in red.
- Every change auto-saves to the GitHub file a second or so after you stop typing. The pill in the header shows the connected repo; the little indicator in the bottom-right shows save status.
- Open the same URL on another device, connect it to the same repo/token, and you'll see the same list. The **Sync now** button force-refreshes from GitHub (handy right after making a change elsewhere).
- If two devices save at almost the same moment, the second save detects the conflict, reloads the latest version from GitHub, and shows a banner — just redo the change that got dropped.

## Notes

- There's no calendar integration in this version — it's a plain to-do list, synced only through your GitHub repo.
- Nothing here handles multiple *people* sharing one list concurrently — it's built for one person across their own devices.

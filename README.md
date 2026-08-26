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

- Add headings (e.g. "Work", "This week"), sub-headings inside them, and tasks either directly under a heading or inside a sub-heading.
- Drag the grip handle (⋮⋮) on any task, sub-heading, or heading to reorder it or move it into a different heading/sub-heading.
- Click the coloured dot on a heading to give it its own colour — it shows up on the heading's left edge, in the Calendar view, and in the Stats view.
- Click the ▾ arrow on a heading or sub-heading to collapse it.
- Click a task's due-date pill to give it a date (and optional time). Overdue tasks are flagged in red.
- The **Theme** button in the header lets you pick a different accent colour palette for the whole app (Ledger, Ocean, Plum, Forest, Slate) — this is separate from per-heading colours and is remembered per browser.
- The **Calendar** tab (top of the page) shows a Month grid or Week agenda of everything with a due date, colour-coded by heading. Click any day to quickly add a task due that day — it appears in your list immediately. If Google Calendar is connected, other events on that calendar show up alongside your tasks too (in grey), so you can see your whole day in one place.
- The **Stats** tab shows completion percentage, overdue/upcoming counts, a per-heading progress breakdown, and a list of what's coming up.
- Every change auto-saves to the GitHub file a second or so after you stop typing. The pill in the header shows the connected repo; the little indicator in the bottom-right shows save status.
- Open the same URL on another device, connect it to the same repo/token, and you'll see the same list. The **Sync now** button force-refreshes from GitHub (handy right after making a change elsewhere).
- If two devices save at almost the same moment, the second save detects the conflict, reloads the latest version from GitHub, and shows a banner — just redo the change that got dropped.

## 6. Connect Google Calendar (optional, two-way sync)

Give any task a due date and Daybook can create a real event for it on your Google Calendar. Events you add, move, rename, or complete (✓ prefix) on that calendar flow back into Daybook too. This runs entirely in your browser — there's no server involved — but Google requires every app to have its own (free) OAuth "Client ID", so you create a small Cloud project once, just for yourself.

**A. Create the Google Cloud project and enable the Calendar API**

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with the Google account whose calendar you want to sync.
2. Click the project dropdown at the top → **New Project**. Give it any name (e.g. "Daybook") → **Create**.
3. With that project selected, go to **APIs & Services → Library**, search for **Google Calendar API**, open it, and click **Enable**.

**B. Configure the consent screen**

1. Go to **APIs & Services → Google Auth platform**. If prompted to get started, choose **External** user type (this just means "not restricted to a Google Workspace org") and fill in an app name and your email.
2. Under **Audience**, make sure the app's publishing status is **Testing** — you do not need to publish or verify it.
3. Still under Audience, scroll to **Test users** → **Add users** → add your own Google account email. Only test users can sign in while the app is in Testing status, which is exactly what you want here.

**C. Create the OAuth Client ID**

1. Go to **Clients** (in the same Google Auth platform section) → **Create Client**.
2. **Application type:** Web application. Name it anything (e.g. "Daybook web").
3. Under **Authorized JavaScript origins**, click **Add URI** and enter exactly: `https://todo.lawrencefarrugiacaruana.com` (no trailing slash, no path). Leave "Authorized redirect URIs" empty — it isn't needed.
4. Click **Create**. Copy the **Client ID** shown (it ends in `.apps.googleusercontent.com`) — you don't need the client secret.

**D. Connect it in the app**

1. Open `https://todo.lawrencefarrugiacaruana.com` and click **Set up Calendar** in the header.
2. Paste the Client ID into the field and click **Connect Google Calendar**.
3. Google will show its normal sign-in / consent screen (since the app is in Testing, it'll show an "unverified app" notice — click **Continue**, this is expected for a personal project). Approve calendar access.
4. Daybook loads your calendar list and automatically picks the one that looks like "To Do" if you have one (it matched yours from your screenshot). To point it at a different calendar, reopen **Set up Calendar** and use the dropdown that appears once connected.

From then on: any task you give a due date to gets created as an event on that calendar; editing the due date, title, or ticking a task off updates the event; and Daybook periodically re-reads events from that calendar so changes made directly in Google Calendar (new time, renamed, marked done by adding a ✓, or deleted) flow back into your task list.

Notes on this integration:
- The sign-in only lasts about an hour at a time in the browser; the app quietly re-authenticates in the background as long as you keep visiting from the same browser (you may occasionally see a brief consent popup).
- This only works over `https://` — it won't work opening `index.html` straight from a file, only from the live GitHub Pages site.
- The Client ID is not secret (it's fine that it lives in this static page / your browser's local storage) — it only identifies which app is asking, Google's sign-in step is what actually protects your calendar.

## Notes

- Nothing here handles multiple *people* sharing one list concurrently — it's built for one person across their own devices.

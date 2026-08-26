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
- The **Calendar** tab (top of the page) shows a Month grid or Week agenda of everything with a due date, colour-coded by heading. Click any day to quickly add a task due that day — it appears in your list immediately, and you can create a brand-new heading right from that popover if you don't want to use an existing one. If Google Calendar is connected, other events on that calendar show up alongside your tasks too, so you can see your whole day in one place.
- In **Set up Calendar**, once connected, there's an "Also show on the Calendar view (read-only)" checklist — tick any of your other Google calendars (shared calendars, a team calendar, birthdays, etc.) to overlay their events on the Calendar view too, each shown in that calendar's own Google colour. This is purely for viewing — Daybook only ever creates or edits events on the one calendar picked in the dropdown above it; the others are never written to.
- **Set up Calendar** also has an "External calendars (read-only)" section that works without connecting Google Calendar at all — see [Add other calendars without Google sign-in](#7-add-other-calendars-without-google-sign-in-eg-university-calendars) below. This is the way to see a calendar that doesn't support Google sign-in, such as most University of Malta calendars.
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

## 7. Add other calendars without Google sign-in (e.g. University calendars)

Some Google accounts — most University of Malta accounts included — don't allow you to connect outside apps via Google sign-in (OAuth) at all, so the "Also show other Google calendars" feature above can't reach them. There's a separate way in for exactly this case, and it doesn't need any sign-in: every Google Calendar has a private "secret address" that lets anything read its events, and Daybook can fetch that in the background and show it on the Calendar view, read-only.

**A. Get the calendar's secret iCal link**

1. In Google Calendar (the account that owns the calendar you want, e.g. your UM account), find the calendar in the left sidebar under "My calendars" or "Other calendars", hover over it, click the **⋮** menu → **Settings and sharing**.
2. Scroll to **Integrate calendar** → copy the **Secret address in iCal format** (it's a long `https://calendar.google.com/calendar/ical/…/basic.ics` link).
3. Treat this link like a password — anyone with it can read that calendar's events (though not edit anything, and not see anything else in the account). Don't post it publicly.

**B. Add the two extra files to your repo**

This feature needs a small background job (a GitHub Action) to fetch the link on Daybook's behalf, since browsers aren't allowed to fetch another site's private calendar data directly. Two extra files make that happen — add them to your repo the same way you uploaded `index.html`:

1. `scripts/sync-ics.js` — upload it to a `scripts` folder in the repo (so the file ends up at `scripts/sync-ics.js`).
2. `.github/workflows/sync-ics.yml` — upload it to a `.github/workflows` folder (so the file ends up at `.github/workflows/sync-ics.yml`). GitHub's web UI lets you type the folder path as part of the filename when you drag a file in, or create the folders first with "Add file → Create new file" and paste the path in the name box.

GitHub Actions is on by default for new repos, so no extra setup is needed there. If it's ever off (Settings → Actions → General), switch it to "Allow all actions".

**C. Add the calendar in Daybook**

1. Open `https://todo.lawrencefarrugiacaruana.com` and click the calendar pill in the header (or **Set up Calendar**) — you don't need to connect Google Calendar first, this section works either way.
2. Under **External calendars (read-only)**, give it a name (e.g. "UM Timetable"), paste the secret iCal link, and click **Add**.

The first sync happens automatically within a minute or two of adding it (saving a feed triggers the background job right away). After that, it refreshes roughly every 30 minutes on its own — this is a background sync, not a live feed, so a change made in the source calendar can take up to half an hour to show up in Daybook. You can add as many external calendars as you like; each gets its own colour on the Calendar view, and hovering an event shows which calendar it came from. Remove one any time from the same panel.

This is read-only in every direction: Daybook never writes anything back to these calendars, and all synced events are assumed to be in the `Europe/Malta` timezone (this is fixed in the script, not auto-detected — fine for UM calendars, but worth knowing if you ever add a calendar based somewhere else).

## Notes

- Nothing here handles multiple *people* sharing one list concurrently — it's built for one person across their own devices.

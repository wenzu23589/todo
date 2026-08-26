# Daybook

A to-do list with headings and sub-headings, built as a single static page. Tasks are stored as a JSON file in a GitHub repo you own, so the same list follows you across every computer and your phone — just open the page and sign in with a token once per device.

This folder has these files:

- `index.html` — the whole app (one file, no build step)
- `manifest.json`, `sw.js`, `icons/` — let you install Daybook as an app on your phone or computer (see [Install Daybook as an app](#9-install-daybook-as-an-app))
- `CNAME` — tells GitHub Pages to serve the site at `todo.lawrencefarrugiacaruana.com`
- `scripts/sync-ics.js`, `.github/workflows/sync-ics.yml` — the background job for external (iCal) calendars, see section 7
- `scripts/send-digest.js`, `.github/workflows/daily-digest.yml` — the background job for the daily email digest, see section 8
- `README.md` — this file

Upload all of these to your repo, keeping the folder structure (`icons/`, `scripts/`, `.github/workflows/`) intact — the same drag-and-drop-with-a-typed-path trick described in section 7B works for any of them.

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
- Click the coloured dot on a heading to give it its own colour — it tints the whole heading box's background (a subtle wash, not a solid fill) as well as the left edge, and that colour also shows up in the Calendar view and the Stats view.
- Click the ▾ arrow on a heading or sub-heading to collapse it.
- Click a task's due-date pill to give it a date and, optionally, a start time — and once a start time is set, an **end time** field appears alongside it, so a task can show as "2:00 PM – 3:30 PM" rather than just a single time. Leaving the end time blank keeps just the start time. Overdue tasks are flagged in red. If the task already has a due date, the same pill also offers **Snooze** shortcuts — **+1 day** or **+1 week** — to push it back without opening the full date picker.
- The **Theme** button in the header lets you pick a different accent colour palette for the whole app — 10 to choose from (Ledger, Ocean, Plum, Forest, Slate, Rose, Indigo, Gold, Crimson, Teal) — plus a separate Font picker and Light/Dark/Auto appearance. This accent-colour choice is separate from per-heading colours and is remembered per browser.
- The **Calendar** tab (top of the page) shows a Month grid or Week agenda of everything with a due date, colour-coded by heading. Click any day to quickly add a task due that day — it appears in your list immediately, and you can create a brand-new heading right from that popover if you don't want to use an existing one. If Google Calendar is connected, other events on that calendar show up alongside your tasks too, so you can see your whole day in one place.
- In **Set up Calendar**, once connected, there's an "Also show on the Calendar view (read-only)" checklist — tick any of your other Google calendars (shared calendars, a team calendar, birthdays, etc.) to overlay their events on the Calendar view too, each shown in that calendar's own Google colour. This is purely for viewing — Daybook only ever creates or edits events on the one calendar picked in the dropdown above it; the others are never written to.
- **Set up Calendar** also has an "External calendars (read-only)" section that works without connecting Google Calendar at all — see [Add other calendars without Google sign-in](#7-add-other-calendars-without-google-sign-in-eg-university-calendars) below. This is the way to see a calendar that doesn't support Google sign-in, such as most University of Malta calendars.
- The **Today** tab pulls together what needs attention right now, in one flat list: everything overdue, everything due today, and anything flagged High priority that isn't already shown in one of those two — grouped into three sections, each showing which heading (and sub-heading, if any) the task belongs to. It's read-only for reordering (no drag handles here, since it's a filtered view across the whole list), but every other action — checking a task off, changing its due date, opening its notes or subtasks — works exactly as it does in the List view.
- The **Stats** tab shows completion percentage, overdue/upcoming counts, a per-heading progress breakdown, and a list of what's coming up.
- Every change auto-saves to the GitHub file a second or so after you stop typing. The pill in the header shows the connected repo; the little indicator in the bottom-right shows save status.
- Open the same URL on another device, connect it to the same repo/token, and you'll see the same list. The **Sync now** button force-refreshes from GitHub (handy right after making a change elsewhere).
- If two devices save at almost the same moment, the second save detects the conflict, reloads the latest version from GitHub, and shows a banner — just redo the change that got dropped.
- **Sort:** above the list, toggle between **Manual** (your own drag-and-drop order), **Priority** (High → Medium → Low → unflagged, due date as tiebreaker), and **Due date** (soonest first, undated tasks last). Switching back to Manual always restores your original order. This only ever reorders tasks within their heading — it never hides any; for that, see filtering below.
- **Notes & checklists:** click the notes icon on any task to jot free-text notes and/or add a checklist inside it — handy for a task with sub-steps. The notes box has a small formatting toolbar (**B** / *I* / U / 🔗) for bold, italic, underline, and hyperlinks — select some text and click a button, or place your cursor and click 🔗 to add a link (typing a bare domain like `example.com` automatically becomes `https://example.com`). The badge on the task shows a quick summary (e.g. "Notes • 2/3") without opening it.
- **Subtasks:** click the subtasks badge on any task, or its arrow, to break it into smaller steps, each with its own text, checkbox, and optional due date — unlike checklist items, a subtask can be given its own date and shows as overdue in the same red styling as a regular task. The badge shows a "done/total" count (e.g. "1/3") and a small arrow that flips to show whether the panel is open. Once a task has at least one subtask, a second matching arrow appears right next to the task's own title — either arrow opens and closes the same panel, so there's a quick, obvious way in from right next to the task name. This is distinct from Notes & checklists (plain text steps with no dates) — use subtasks when the steps themselves have deadlines.
- **Attachments:** click the paperclip badge on any task — or on a subtask, in its own row — to attach one or more images or PDFs, up to 12MB each. Each attachment is uploaded as its own file into an `attachments/` folder in your GitHub repo (tasks.json itself just keeps a small reference), so the list stays fast to load no matter how many files you attach. Images show a thumbnail once opened; click a file's name to open it in a new tab. Removing an attachment deletes its file from the repo too.
- **Quick capture:** the **Quick capture** button above the list opens a box where you can paste or type several lines at once — each line becomes its own task, under an existing heading or a new one you name on the spot. Good for brain-dumping a list quickly.
- **Undo:** deleting a task, sub-heading, or heading shows an **Undo** toast for a few seconds — click it to put the item back exactly where it was, including any linked Google Calendar event.
- **Archive:** once a task is checked off, an archive icon appears on it — archiving tucks it out of the main list (a "Show archived (N)" toggle on the heading reveals it again) without deleting it. Completed tasks also archive themselves automatically after two weeks, just to keep long-finished items from cluttering the list; nothing is ever deleted unless you delete it yourself, and archived tasks can always be restored from the same panel — or sent to the recycle bin below via "Delete permanently."
- **Recycle bin:** deleting a task from the list (the trash icon on the task itself, or "Delete permanently" from the Archive panel) doesn't erase it — a toast offers **Undo** for a few seconds, and even after that it keeps sitting in the **Trash** tab (which shows a count once anything's in it), tagged with which heading or sub-heading it came from. From there you can **Restore** it back to exactly where it was, or **Delete forever**, which is the one truly irreversible action — it asks you to confirm first, and doesn't go back into the bin.
- **Priority markers:** click the priority pill next to a task's due-date badge to cycle it through None → High → Medium → Low. Each level shows both the word and a traffic-light dot — red for High, orange for Medium, green for Low, white for None. **Priority** is also a third option in the Sort toggle above the list — it orders High, then Medium, then Low, then unflagged, using the due date as a tiebreaker within each level.
- **Natural-language dates:** both Quick capture and the regular "+ Add task" row read dates out of what you type. "Call dentist tomorrow 3pm", "Submit grades Sept 15", "Team sync in 3 days", or a bare weekday like "Friday" all get picked up automatically — the date phrase is pulled out as the task's due date and stripped from the task text, so you're left with a clean title and a due date already set. A line with no date phrase in it is created exactly as typed, unchanged. On the "+ Add task" row this only applies the moment you're naming a brand-new task — renaming an existing task later never triggers it, even if the new title happens to mention a day.
- **Tags & filtering:** click the tag icon on a task to add one or more free-text tags (each gets its own colour, consistent across the app). The **Tags** button above the list opens a filter — tick one or more tags to show only tasks that have at least one of them; the button shows how many filters are active, and "Clear filter" resets it. The filter is a view-only lens for the current session — it doesn't change what's saved, and resets on reload.
- **Filtering by priority or due date:** the **Priority** and **Due date** buttons next to Tags work the same way, but hide tasks by their priority level or due date instead of by tag. **Priority** filters by High/Medium/Low/No priority (tick any combination). **Due date** offers quick presets — Overdue, Due today, Due this week, No due date — plus a custom date range, and everything ticked combines as an "or" (a task shows if it matches any of them). All three filters (Tags, Priority, Due date) combine with each other as an "and" — a task has to clear every filter you've set to show. Like Tags, these reset on reload rather than being saved.
- **Search:** the search box above the list matches everything about a task — its title, notes, tags, subtasks, and attachments (both filenames and, for images/PDFs, the text inside them — see below) — and combines with the Tags/Priority/Due date filters as an "and," same as they combine with each other. Like those filters, it's session-only and clears on reload.
- **Attachment text search (OCR):** when you attach an image or a PDF, Daybook automatically reads the text inside it in the background — a moment or two after upload, the attachment briefly shows "Reading text…" — so you can later find it just by searching for a word that appears in the photo or document itself, even though nothing about the search box mentions attachments. PDFs with a real text layer (i.e. one you could normally select/copy text from) extract instantly and precisely; scanned PDFs and plain images go through on-device OCR (all in your browser — nothing is uploaded to any OCR service). This runs once per attachment and the result is saved, so it only has to happen the one time.
- **Export backup:** the Settings panel (the gear icon) has a **Download backup (.json)** button that saves your current list to your device as a dated file — a local copy independent of GitHub, purely for peace of mind. This works whether or not you're connected to a repo.

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
- A task marked **All day** doesn't create a true all-day (banner) event — it syncs as a timed block from **7:00 AM to 7:00 PM** on the due date, so it shows up in your calendar's normal time grid instead of floating above the day. This is purely how it appears on the calendar; in Daybook itself the task still just shows its date, with no time on it.
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

## 8. Set up the daily email digest (optional)

Once a day, Daybook can email you a summary of overdue tasks, tasks due today, and tasks due in the next few days. Like the external-calendar sync, this runs as a background job (a GitHub Action), so it works even if you never open the app that day — sending needs a small one-time setup:

**A. Create a Gmail App Password**

The digest sends through Gmail's SMTP server using an **App Password** — a 16-character code scoped just to sending mail, separate from your real Gmail password (Google requires this for any app that isn't Google itself).

1. This needs 2-Step Verification turned on for the Google account you want to send from — turn it on first at [myaccount.google.com/security](https://myaccount.google.com/security) if it isn't already.
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), sign in, name it anything (e.g. "Daybook digest"), and click **Create**.
3. Copy the 16-character password shown — Google only shows it once.

**B. Add the two extra files to your repo**

1. `scripts/send-digest.js` — upload to a `scripts` folder (same folder `sync-ics.js` lives in, if you set that up already).
2. `.github/workflows/daily-digest.yml` — upload to `.github/workflows` (alongside `sync-ics.yml`, if present).

**C. Store the Gmail address and App Password as repo secrets**

These are the only credentials Daybook needs outside your browser, so they're kept as GitHub Actions secrets rather than in the app itself:

1. In your repo, go to **Settings → Secrets and variables → Actions → New repository secret**.
2. Add a secret named `GMAIL_USER` with the Gmail address you're sending from (e.g. `you@gmail.com`).
3. Add a second secret named `GMAIL_APP_PASSWORD` with the 16-character App Password from step A.

**D. Turn it on in the app**

1. Open `https://todo.lawrencefarrugiacaruana.com` and click the calendar pill (or **Set up Calendar**) in the header — the digest setting lives in the same panel as the calendar settings.
2. Under **Daily email digest**, tick **Send me the daily digest**, enter the address to send it *to* (this can be the same Gmail address, or any other inbox you check), and click **Save digest settings**.

By default the job runs at 06:00 UTC (07:00 or 08:00 in Malta, depending on daylight saving) — edit the `cron` line near the top of `.github/workflows/daily-digest.yml` if you'd like a different time, or trigger it on demand any time from the repo's **Actions** tab → **Daily email digest** → **Run workflow**. If the toggle is off, or no recipient is set, the job runs but sends nothing.

## 9. Install Daybook as an app

Daybook can be installed like a native app on your phone, tablet, or computer, so it opens in its own window (no browser address bar) with its own icon on your home screen or dock.

- **Desktop Chrome/Edge:** open `https://todo.lawrencefarrugiacaruana.com`, then click **Install app** in the header (or the install icon ⊕ at the right of the address bar).
- **Android (Chrome):** open the site, tap the **⋮** menu → **Install app** (or use the **Install app** button in the header if it appears).
- **iPhone/iPad (Safari):** Safari doesn't support the automatic install prompt — instead, open the site, tap the **Share** icon, then **Add to Home Screen**.

Once installed, the app shell (not your tasks) loads instantly even with a flaky connection, since the page itself is cached on your device — your tasks, calendar, and settings still need a live connection to load and save, exactly as in the browser.

## Notes

- Nothing here handles multiple *people* sharing one list concurrently — it's built for one person across their own devices.
- Attachments live permanently in your repo's `attachments/` folder (and in its git history, like any committed file) — removing an attachment from a task deletes that file, but GitHub repos aren't meant to be bulk file storage, so this is best for the odd photo or PDF rather than hundreds of large files.

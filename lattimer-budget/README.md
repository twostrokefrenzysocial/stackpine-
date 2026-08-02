# Lattimer Family Budget

A mobile-first Progressive Web App for two people — Chris and Miriam — sharing one
budget in real time. One Node process serves both the API and the app; SQLite holds
the data; the phones install it straight from the browser, no app store.

- **Quick Add** — one tap on the orange **+**, punch the amount on a big keypad, tap a
  category. Saved, tagged with who entered it and today's date, in about two seconds.
  A Spending/Income switch on the keypad logs money in the same way.
- **Paychecks as they actually land** — the Budget tab lists each income source with a
  **Log** button: keypad opens pre-filled with the usual amount, adjust to what the
  check really was, save. The dashboard tracks received vs. expected; one-off money
  (a bonus, a sale) logs as "Other income" with no setup.
- **Budget tab** — income vs. spent vs. remaining, fixed bills as a tap-to-pay
  checklist, spending categories as progress bars (green under 80%, yellow to 100%,
  red past it).
- **Due dates** — give a bill a day of the month and the checklist sorts by it and
  labels each one *Due today* / *Due in 2 days* / *Overdue by 3 days*, with a red bar
  at the top counting what is late or due this week. Marking it paid clears it. A bill
  due on the 31st lands on the 30th in September and the 28th in February.
- **Scheduled bills** — a bill can be set to begin in a future month. It stays out of
  the budget until then, listed under *Coming up* along with what the budget will look
  like once it starts.
- **Bank statement import (PDF or CSV)** — History → Import. Upload the monthly
  statement PDF or a CSV export (PNC: Account Activity → Download), or paste the
  text. Merchants are matched to categories — first from what you picked on previous
  imports, then by keyword — you review and fix anything wrong, and re-importing the
  same file never duplicates. Statements may target any past month (they're the
  bank's record of what already happened); manual entry keeps the closed-month rule.
  Deposits can be imported as income (off by default so logged paychecks don't
  double-count). Scanned-image PDFs can't be read — use the CSV export for those.
- **Month report** — when a new month starts, the dashboard shows last month's report
  card: which categories went over budget and by how much, with a one-tap jump into
  the tune-up. If tracked income beat spending, it offers to move the leftover into
  savings.
- **Plan tab** — the budget as a plan you can read: income minus bills minus everyday
  spending minus the savings goal, with the breathing room (or shortfall) at the
  bottom, every budget listed, and due dates alongside bills.
- **Savings** — a running savings balance with add/withdraw, a monthly goal set in
  Settings, and a progress bar on the Plan tab.
- **Smart budget tune-up** — Settings → Review budget suggestions. Compares each
  spending budget to your actual spending over the last few closed months and
  proposes new numbers (nearest $5), with a running check against income. You pick
  which suggestions to apply; past months keep their snapshots.
- **Reminders on the lock screen** — Settings → Reminders → Turn on (per phone). A
  morning push when bills are due within two days or overdue, and a nudge when a new
  month's report is ready. VAPID keys generate themselves on first use and live in
  the database; nothing to configure. iPhone requires iOS 16.4+ and the app installed
  to the home screen.
- **Undo everywhere** — deleting anything shows a 6-second Undo toast instead of an
  "are you sure?" dialog.
- **Search & who-spent-what** — History has a search box and per-person totals for
  whatever filter is active.
- **Named savings goals** — "Christmas", "Emergency fund" — each with its own target
  and progress bar on the Plan tab, funded from the same savings ledger.
- **Real-time** — one phone adds something, the other updates in well under a second
  over Server-Sent Events, with 15-second polling as a fallback.
- **History tab** — this month's transactions newest first, filter by category and
  person, tap any row to edit or delete.
- **Debt tab** — the five settlement targets, a settlement fund balance that takes
  manual deposits, and a record of what each settled debt cost and when.
- **Months roll over on their own** — a new month starts with fresh actuals; past
  months stay viewable but read-only, each holding the budget it was actually run on.
  Last month stays editable for the first few days of the new one, so a purchase made
  on the 31st can still be logged on the 1st.

---

## Quick start (local)

```bash
npm install
FAMILY_PIN=1234 npm start
# http://localhost:3000
```

The database is created on first run and seeded once with the family's real income,
bills, categories, and debts. **Seeding never runs again** — redeploys and restarts
leave your data alone.

Run the API test suite:

```bash
npm test
```

## Environment variables

| Variable        | Default             | What it does |
| --------------- | ------------------- | ------------ |
| `PORT`          | `3000`              | HTTP port. Railway sets this for you. |
| `DB_PATH`       | `./data/budget.db`  | Where the SQLite file lives. **Point this at your Railway volume.** |
| `FAMILY_PIN`    | `0000`              | The shared 4-digit PIN on the login screen. Always set this. |
| `SESSION_SECRET`| derived from the PIN| Signs the login tokens. Set it if you want sessions to survive a PIN change. |
| `TZ_NAME`       | `America/New_York`  | Which clock decides "today" and "this month". |
| `BACKDATE_GRACE_DAYS` | `5`           | How many days into a new month last month stays editable, so a purchase made on the 31st can be entered on the 1st. `0` closes last month immediately; `31` keeps it open all month. |

---

## Deploying to Railway

**The five-minute version.** New Project → Deploy from GitHub repo → this repo. Then,
on the service: **Settings → Root Directory** = `lattimer-budget`; **Settings → Source →
Branch** = whichever branch has this code; **+ New → Volume** mounted at `/data`;
**Variables** → `DB_PATH=/data/budget.db` and `FAMILY_PIN=<your four digits>`;
**Settings → Networking → Generate Domain**. Open the domain on both phones.
The start command and health check come from `railway.json` — you don't need to set them.

The rest of this section is the same thing, slower.

### 1. Create the service

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, pick the repo.
3. If the app is in a subdirectory of the repo, open **Settings → Root Directory**
   and set it to `lattimer-budget`.

Railway detects Node, runs `npm install`, and starts it with `npm start`. No build
step, no Dockerfile. `PORT` is injected automatically and the server reads it.

### 2. Attach a volume so the database survives redeploys

This is the step that matters. Without it, every deploy starts from an empty
database and re-seeds.

1. On the service, click **+ New → Volume** (or **Settings → Volumes → Add Volume**).
2. Set the **mount path** to `/data`.
3. Go to **Variables** and add:

   ```
   DB_PATH=/data/budget.db
   ```

4. Redeploy. From then on the SQLite file lives on the volume, and deploys, restarts,
   and rollbacks all leave the data intact.

### 3. Set the family PIN

Under **Variables**, add:

```
FAMILY_PIN=1234        # pick your own four digits
```

Optionally add `SESSION_SECRET` (any long random string) so that changing the PIN
later doesn't sign both phones out.

### 4. Get a URL

**Settings → Networking → Generate Domain.** You'll get something like
`lattimer-budget-production.up.railway.app`. That's the address both phones use.
A custom domain works too, as long as it's HTTPS — the service worker and
"Add to Home Screen" require it.

### Verifying a deploy

```bash
curl https://your-app.up.railway.app/healthz     # {"ok":true,"sse":0}
```

---

## Installing on each phone

Both phones open the same URL and sign in with their own name plus the shared PIN.
The session sticks in `localStorage`, so it's a one-time thing per phone.

**iPhone (must be Safari — Chrome on iOS can't install web apps):**

1. Open the URL in **Safari**.
2. Tap the **Share** button (the square with the up arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**. The icon lands on the home screen and opens full-screen, no address bar.

**Android (Chrome):**

1. Open the URL in **Chrome**.
2. Tap the **⋮** menu (top right).
3. Tap **Add to Home Screen** (Chrome may also show an "Install app" banner — either works).
4. Tap **Install**.

After installing, sign in once inside the installed app; the browser session and the
installed app keep separate storage on iOS.

---

## How things work

**Auth.** Two names, one shared PIN, no emails or passwords. A successful login returns
an HMAC-signed token that identifies which of the two people you are; the phone keeps
it in `localStorage`. Tokens survive redeploys.

**Real-time sync.** Every write bumps a version stamp and pushes a `change` event over
`/api/events` (SSE). Listeners refetch and re-render. If the stream drops — dead zone,
phone asleep, a proxy that dislikes SSE — the app silently falls back to polling
`/api/version` every 15 seconds and switches back to the stream when it reconnects.
The dot in the header shows which mode you're in: **live**, **syncing**, or **offline**.

**Fixed bills.** Tapping a bill records a transaction for the budgeted amount, tagged
`billpay`. Tapping again removes it. Tapping twice never double-charges. You can still
add a manual transaction to a bill category if the real amount differed.

**Months.** Transactions carry the month they belong to, so a new month starts empty on
its own. When a month is first opened, the app snapshots that month's budgets and
income, so raising the grocery budget in November doesn't rewrite October's history.
Closed months reject writes at the API level, not just in the UI.

**Back-dating grace.** For the first `BACKDATE_GRACE_DAYS` (default 5) of a new month,
last month is still writable — add, edit, delete, and tick off its bills. Step back a
month during that window and the header turns green with *"Still open through Aug 5"*
instead of the orange read-only bar; the **+** button stays live and defaults the date
to the last day of that month. On day 6 the month closes for good. The window never
reaches back two months, and future dates are always refused.

**Settlement fund.** The balance is: the "Settlement fund" bill payments, plus manual
deposits (extra paychecks), minus what settled debts actually cost. Each target's bar
shows how much of it the fund can cover right now.

**Offline.** The service worker caches the app shell, so the app opens without a signal
and says so plainly instead of showing a blank screen. Budget data itself always comes
from the server — there is no offline write queue, on purpose: two phones editing a
shared budget offline would need conflict resolution that isn't worth the complexity
here.

**Money.** Stored as integer cents everywhere; dollars only exist at the API boundary.
No floating-point drift.

## API

All routes except `POST /api/login` need `Authorization: Bearer <token>`.

| Method | Route | Purpose |
| ------ | ----- | ------- |
| POST   | `/api/login` | `{person, pin}` → `{token, person}` |
| GET    | `/api/state?month=YYYY-MM` | Everything the UI renders for a month |
| GET    | `/api/events` | SSE change stream (`?token=` since EventSource can't send headers) |
| GET    | `/api/version` | Polling fallback for the change stamp |
| POST   | `/api/transactions` | `{category_id, amount, note?, date?, person?}` |
| PUT    | `/api/transactions/:id` | Edit any field |
| DELETE | `/api/transactions/:id` | Remove |
| POST   | `/api/bills/:categoryId/pay` | `{paid: true\|false}` — the checklist toggle |
| POST   | `/api/categories` · PUT · DELETE `/:id` | Add, edit budget/name, archive |
| POST   | `/api/income` · PUT · DELETE `/:id` | Income sources |
| PUT    | `/api/debts/:id` | Edit name, balance, target, flag |
| POST   | `/api/debts/:id/settle` · `/unsettle` | Record or undo a settlement |
| POST   | `/api/fund/deposits` · DELETE `/:id` | Manual deposits into the settlement fund |
| GET    | `/healthz` | Uptime check |

Every write responds with the full refreshed state, so the UI never needs a second
round trip.

## Project layout

```
server.js              Express app: API + static shell + SPA fallback
src/db.js              Schema, migrations, one-time seeding
src/seed.js            The family's starting income, bills, categories, debts
src/api.js             Every endpoint, plus the SSE broadcaster
src/util.js            Dates in the family's timezone, money in cents, tokens
public/                index.html · app.js · styles.css · sw.js · manifest.json
tools/make-icons.js    Regenerates the PWA icons (no image dependencies)
test/api.test.js       End-to-end API tests
```

## Changing the seed data

`src/seed.js` only runs against a brand-new database, so editing it will not change a
budget that's already live. Once you're running, change budgets, income, categories,
and debts in the **Settings** and **Debt** tabs — that's what they're for.

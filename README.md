# Academy Ready

A mobile first Progressive Web App that manages training and nutrition for the Akron Police
Department physical entry exam, judged against OPOTC standards for a male aged 30 to 39.

Single user. Install it to your phone home screen and it behaves like a native app.

> This repository also hosts the static stackpine.org marketing site at the root. Academy Ready
> lives entirely inside `client/` and `server/` and does not touch it.

## What it does

- **Today screen** with the exact prescription for the day, a start and log flow, quick log buttons
  for weight, water, and protein, a progress ring against the 68 lb goal, and a countdown once the
  test date is set.
- **Workout logging** for runs, push-ups and sit-ups, strength, and 1.5 mile time trials. Missed
  days roll a gentle catch-up suggestion into the next day and never stack a double session.
- **Progress charts** for weight, one minute push-up and sit-up tests, and time trials, each drawn
  against the entry and exit standards, plus a pass readiness card.
- **Meal planning** generated server side by the Anthropic API, with a grocery list grouped by
  store section, single meal swaps, and every past week kept.
- **Push notifications** on a schedule you control from Settings.

## Repository layout

```
client/     React 18 + Vite + Tailwind + Recharts PWA        deploys to Vercel
server/     Node + Express + SQLite API and scheduler        deploys to Railway
```

## The plan that is seeded

The plan starts **2026-08-14**, a Friday. Week 1 is a partial week of Friday through Sunday. Every
week after that runs Monday through Sunday. Sixteen weeks are written into the database on first
run, and the server keeps the schedule stretched six weeks past today from there on.

| Day | Blocks |
|---|---|
| Monday | Run, push-ups and sit-ups |
| Tuesday | Strength |
| Wednesday | Run |
| Thursday | Push-ups and sit-ups, planks |
| Friday | Run, strength |
| Saturday | Push-ups and sit-ups, weekly one minute max tests |
| Sunday | Rest |

Every fourth Wednesday the run is replaced by a 1.5 mile time trial.

**Running.** Phase 1 (weeks 1 to 4) is a 30 to 40 minute brisk walk with jog 1 / walk 2 intervals,
8 to 10 times. Phase 2 (weeks 5 to 8) stretches the jog interval each session until 20 minutes is
continuous, with pace ignored. Phase 3 (weeks 9 to 16) is two easy runs of 2 to 2.5 miles plus one
interval day of 6 x 400m at 2:04 with 90 seconds walking rest. Phase 4 (week 17 onward) holds that
structure while tightening the interval pace and stretching one easy run toward 3 miles.

**Push-ups.** Five sets of max clean reps minus 2 with 90 seconds rest, starting at counter height.
When every set hits 15 the app drops you to the next incline on its own: counter, bench, low box,
floor. Once on the floor the five set structure stays.

**Sit-ups.** Four sets of max reps in test format with 60 seconds rest, plus three planks of 30 to
60 seconds.

**Strength, twice a week.** Squat or leg press, dumbbell row, dumbbell bench press, farmer carries,
three sets of 8 to 12 each. This is the muscle preservation work that matters most while on a
GLP-1.

## Standards used

OPOTC, male, age 30 to 39.

| Event | Entry standard | Academy exit standard |
|---|---|---|
| Sit-ups in 1 minute | 28 | 36 |
| Push-ups in 1 minute | 15 | 27 |
| 1.5 mile run | 15:13 | 12:25 |

Both appear as reference lines on the relevant charts. The Standards screen carries the test rules:
push-ups rest only in the up position, sit-ups are bent knee with hands behind the head and feet
anchored, and the run is a timed 1.5 miles.

## Local development

Requires Node 20 or newer.

### Server

```bash
cd server
npm install
cp .env.example .env      # then fill in what you need
npm run seed              # creates the database, sets the PIN, writes weeks 1 to 16
npm run dev               # http://localhost:8080
```

The seed sets the PIN from `INITIAL_PIN`, defaulting to `2468`. Change it from the Settings screen
after the first sign in. Seeding is safe to run again: it never overwrites settings and never
duplicates a scheduled block.

### Client

```bash
cd client
npm install
npm run dev               # http://localhost:5173
```

In development the Vite dev server proxies `/api` to `VITE_DEV_API` (default
`http://localhost:8080`), so no CORS setup is needed locally.

## Generating VAPID keys

Push notifications need a VAPID key pair. Generate one once:

```bash
cd server
npm run vapid
```

It prints a public and a private key. Put both on the server:

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

The client never needs its own copy. It fetches the public key from
`GET /api/push/vapid-public-key` when you turn notifications on. Keep the private key secret, and
note that regenerating the pair invalidates every existing subscription, so you would need to turn
notifications back on for each device.

## Deploying the server to Railway

1. Create a new Railway project from this repository and set the service **root directory** to
   `server`. `railway.json` supplies the start command and a `/health` healthcheck.
2. Add a **volume** mounted at `/data`. Without it the SQLite file is wiped on every redeploy.
3. Set these service variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_PATH` | `/data/academy.db` |
   | `CORS_ORIGIN` | your Vercel URL, for example `https://academy-ready.vercel.app` |
   | `INITIAL_PIN` | the PIN to seed on first boot |
   | `ANTHROPIC_API_KEY` | your Anthropic API key |
   | `VAPID_PUBLIC_KEY` | from `npm run vapid` |
   | `VAPID_PRIVATE_KEY` | from `npm run vapid` |
   | `VAPID_SUBJECT` | `mailto:you@example.com` |

   `PORT` is set by Railway. `ENABLE_SCHEDULER` defaults on; set it to `0` to turn the scheduler
   off. The timezone defaults to `America/New_York` and is editable in the settings table.
4. Deploy. The server seeds itself on first boot, so there is no separate migration step.

`CORS_ORIGIN` takes a comma separated list if you have preview deployments to allow. A blocked
origin returns a 403 naming the origin, so it is easy to spot.

## Deploying the client to Vercel

1. Import this repository and set the project **root directory** to `client`. `vercel.json` sets
   the framework, the SPA rewrite, and cache headers that keep the service worker fresh.
2. Set one environment variable:

   ```
   VITE_API_BASE=https://your-service.up.railway.app
   ```

   No trailing slash. This is what points the app at the Railway API.
3. Deploy, then add the Vercel URL to `CORS_ORIGIN` on Railway.

The build script regenerates the PWA icons before bundling, so there are no binary assets to keep
in sync by hand.

## Installing to your phone

**iPhone.** Open the Vercel URL in Safari, tap Share, then Add to Home Screen.
**iOS requires the PWA to be installed to the home screen before push notifications will work at
all.** A browser tab in Safari cannot receive them. Once installed, open the app from the home
screen icon and turn notifications on in Settings. The Settings screen detects this case and says
so rather than failing quietly.

**Android.** Open the URL in Chrome and accept the install prompt, or use the menu and Install app.
Push works from the browser too, but installing gives you the standalone window.

## Notifications

All times are editable in Settings. The server runs a `node-cron` job once a minute in your
timezone and compares the clock against those settings, so a change takes effect immediately. Each
item sends at most once a day.

| When | What |
|---|---|
| 7:00 AM daily | Today's workout summary |
| 8:00 PM daily | Reminder to log, and only if the workout or the weight is still missing |
| Sunday 10:00 AM | Meal plan and grocery list are ready, generated first and then announced |
| Friday 7:00 AM | Weekly weigh-in reminder |
| Monday of a time trial week | Heads up that Wednesday is the time trial |

## Meal plan generation

`POST /api/meals/generate` builds the prompt from your nutrition rules and any preferences or
exclusions saved in Settings, then calls the Anthropic API with `claude-sonnet-4-6`. The API key is
read from `ANTHROPIC_API_KEY` on the server and is never sent to the browser.

The response has to be a single JSON object. The server validates it for seven days, five meals per
day, valid slots, numeric protein, present ingredients, and a daily protein total inside your
target. If validation fails, it retries once with the specific errors fed back. If the second
attempt also fails it falls back to a static template week that is baked in, and the response says
which was used. That means the app always has a usable plan and grocery list even with no API key
set at all.

The grocery list is rebuilt from the plan, deduped across the week by section and item, with
repeated quantities merged. Ticked boxes survive a rebuild.

## Data model

SQLite, created automatically on first run.

| Table | Holds |
|---|---|
| `settings` | Single row: profile, targets, notification times, PIN hash, timezone |
| `sessions` | Session tokens |
| `weigh_ins` | One weight per date |
| `water_logs`, `protein_logs` | Append only entries, summed per day |
| `workouts` | The generated schedule, one row per block per day |
| `workout_logs` | What actually happened, including sets as JSON |
| `strength_logs` | One row per exercise per set |
| `test_results` | `pushup`, `situp`, and `run_trial` results. Run trials store seconds |
| `meal_plans` | One row per week, plan stored as JSON |
| `grocery_items` | Flattened list per week with checked state |
| `push_subscriptions` | Web push endpoints |
| `notification_log` | One row per notification per day, which is what stops duplicate sends |

## Notes on the pace flags

The Today and Progress screens flag the trend rather than nagging about a single weigh-in.

- Losing faster than **2.5 lbs per week** over the trailing 7 days raises a warning.
- Weekly averages moving less than **1 lb per week for three weeks running** raises a prompt to look
  at intake.
- A 7 day trend inside the **1.5 to 2.0 lbs per week** target is confirmed as on pace.

## Disclaimer

Academy Ready is a personal training tracker. It is not medical advice. Keep your prescriber in the
loop on training load, food intake, and how fast the weight is coming off, especially while on a
GLP-1. Confirm the current OPOTC standards and your test date with the department rather than
relying on the numbers stored here.

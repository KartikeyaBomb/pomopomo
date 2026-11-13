# Pomopomo

A simple progressive web app with a task list, 25-minute focus timer, optional 5-minute breaks, and a weighted task wheel. Tasks and timer state sync across devices signed in to the same account.

## Run locally

Requires Node 22.13 or later.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_silent_mercury.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_petite_sabretooth.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_dashing_norman_osborn.sql
npm run dev
```

Apply each migration only once to a fresh local database. Dev mode supplies the Sites test identity. Production requires Sites authentication. Use `npm run start` for the production Worker and service worker preview; it does not mock authentication.

## Use

- Enter a task and an estimate of 1–999 pomodoros.
- Click a task to open its side panel. Edit its name, description, and total pomodoros, then save. Completed pomodoros are preserved; a running or paused focus session requires one remaining pomodoro.
- Spin or use a task’s play button to select it, then start its timer.
- The timer progress bar shows the current session. Each task’s completion bar includes completed sessions and progress within its selected focus session.
- A task's chance is its remaining pomodoros divided by all remaining pomodoros. 5 versus 15 means 25% versus 75%.
- Completed focus sessions subtract one remaining pomodoro. Finished tasks leave the wheel.
- Pause/resume keeps elapsed time; reset discards the current session without credit.
- Open the hosted URL and sign in with the same account on your phone and computer. Changes sync immediately after edits and refresh from other devices every five seconds while open.
- Install using the app's Install button or Safari's Share → Add to Home Screen / Chrome's menu → Install app.

## Sync and offline behavior

Cloudflare D1 stores a separate task and timer snapshot for each authenticated Sites user. Writes use atomic revision checks; stale snapshots cannot overwrite newer cloud state. Competing edits show a choice between device and cloud versions. The replaced snapshot is backed up to `pomopomo-conflict-backup` in localStorage.

A service worker caches the app shell and static assets. API and authentication responses are never cached. After the first online load, the app can open offline. Tasks and pending changes are saved locally and uploaded when the app is open online again. Sync status is displayed beneath the task list. Cloud data remains separate from local test data.

Timer controls require a connection; task edits retain offline saving. Timer deadlines survive device sleep and reload. Expired focus sessions are credited once, and matching updates from multiple devices resolve automatically. Completion shows a persistent popup with an optional chime and a button to start a break. Timer → Alerts controls sound and opt-in browser notifications. Notifications use the service worker when available and require browser permission. Tapping a notification focuses the app. An undismissed popup is restored on reload. This is not a server-push alarm service: closed or suspended apps can only detect expiry when resumed. Phone OSes may suspend a background PWA, and sync resumes when reopened.

## Verify

```sh
node --experimental-strip-types --test tests/*.test.mjs
npx tsc --noEmit
npm run build
```

Built with React, TypeScript, Vinext, and Cloudflare D1. Sites hosting identity and database binding live in `.openai/hosting.json`. Schema migrations are under `drizzle/`; Sites applies them during deployment.

## Activity history

The compact History day view sits below the wheel and records completed focus sessions and breaks. Use previous/next day, Today, or the date picker to see task-name snapshots, completion times, and daily totals. Longer session lists scroll within the card. Dates and times use the device’s local timezone.

A session is dated by its stored timer deadline, even if the app wakes later. Paused or reset sessions are not logged. Earlier task counters have no timestamps and are not backfilled with guessed dates. History records survive task renames, deletions, and task-sync conflict choices.

New records are written atomically on the server with timer settlement and task progress. The legacy localStorage outbox remains available to upload older pending history. The D1 `activity_sessions` table is keyed by authenticated user and deterministic session ID. Duplicate completions and retries cannot inflate totals. Cached months remain readable offline; pending sessions upload while the app is open online. Cloud history refreshes every five seconds. Older installed versions must be refreshed to use server-authoritative timer controls.

For local API integration checks, start the production preview on port 8787 and run `node tests/history-api.mjs`. This writes only to the local test database and checks persistence, deduplication, account isolation, retained history after deleting tasks, validation, and month boundaries.

## E-paper device integration

See [the complete hardware, pairing, and hosting guide](docs/EPAPER.md). Firmware is in `firmware/MyEpaperApp`. The device gateway runs at `https://pomopomo-device-gateway.pomopomo-karti.workers.dev`. Timer control now requires a connection and uses server-authoritative commands; task edits retain offline storage. Refresh older installed clients. Completion runs on server requests, including device polling with browsers closed.

To change the e-paper device Wi-Fi without USB, hold BOOT for five seconds while running. Join the temporary `Pomopomo-Setup-xxxx` network using the password on its screen, then open `http://192.168.4.1`. Choose a 2.4 GHz network and connect. Existing account pairing is preserved. See `docs/EPAPER.md` for details.

## Copyable day log

History includes a read-only day log and Copy day button for pasting into Notion. It lists completed focus work in chronological order as `7:03 - 7:28 task`, omits breaks, merges adjacent same-task sessions, and inserts a blank line when a gap is at least one minute. Days run from 8 AM to 8 AM in the viewing device’s local timezone; after-midnight work appears on the preceding date. Work crossing 8 AM is split at that boundary. New sessions record active spans across pauses on the server (including ESP32 commands). Older records infer start as finish minus 25 minutes and are labeled estimated because past pauses cannot be reconstructed. Running/abandoned sessions do not appear.

`node tests/day-log-api.mjs` tests overlapping history retrieval against the local production server; `tests/day-log.test.mjs` covers formatting, gaps, DST and rollover.

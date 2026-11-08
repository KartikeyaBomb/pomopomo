# Pomopomo

A simple progressive web app with a task list, 25-minute focus timer, optional 5-minute breaks, and a weighted task wheel. Tasks and timer state sync across devices signed in to the same account.

## Run locally

Requires Node 22.13 or later.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_silent_mercury.sql
npm run dev
```

Apply the migration only once to a fresh local database. Dev mode supplies the Sites test identity. Production requires Sites authentication. Use `npm run start` for the production Worker and service worker preview; it does not mock authentication.

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

Timer deadlines survive device sleep and reload. Expired focus sessions are credited once, and matching updates from multiple devices resolve automatically. The app does not provide a background alarm or push-notification service; returning to the app updates the timer. Phone OSes may suspend a background PWA, and sync resumes when reopened.

## Verify

```sh
node --experimental-strip-types --test tests/pomodoro.test.mjs
npx tsc --noEmit
npm run build
```

Built with React, TypeScript, Vinext, and Cloudflare D1. Sites hosting identity and database binding live in `.openai/hosting.json`. Schema migrations are under `drizzle/`; Sites applies them during deployment.

# Pomopomo

A simple pomodoro app with a task list, a 25-minute focus timer, optional 5-minute breaks, and a weighted task wheel.

## Run locally

Requires Node 22.13 or later.

```sh
npm ci
npm run dev
```

Open the Local URL printed by the dev server.

## Behavior

- Enter a task and an estimate of 1–999 pomodoros.
- Spin or select a task, then start its timer.
- A task's chance is its remaining pomodoros divided by all remaining pomodoros. 5 versus 15 means 25% versus 75%.
- Completed focus sessions subtract one remaining pomodoro. Finished tasks leave the wheel.
- Pause/resume keeps elapsed time; reset discards the current session without credit.
- Tasks and timer deadlines are saved in localStorage on this browser. Reloading catches up an expired timer exactly once. Data does not sync across browsers, and only one active tab should be used.
- This app has no notification or background alarm service. Returning to a sleeping or closed tab updates the session state.

## Verify

```sh
node --experimental-strip-types --test tests/pomodoro.test.mjs
npx tsc --noEmit
npm run build
```

Built with React, TypeScript, and Vinext. Sites hosting identity lives in `.openai/hosting.json`.

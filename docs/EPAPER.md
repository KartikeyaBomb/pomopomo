# Pomopomo e-paper integration

Status: backend and gateway deployed; MyEpaperApp compiled and uploaded to the V2 board. Wi-Fi and account pairing have worked on hardware. Phone setup is supported by the local Wi-Fi portal described below; screen quality, battery power-off and the complete phone flow require physical checks. The original Downloads example is unchanged.

## Hosting verification and authentication

On 2026-11-08, anonymous requests and a plain `Authorization: Bearer ...` request to the private Sites URL returned the **Sites dispatch HTML 401**, before application code. The documented `OAI-Sites-Authorization` service credential reached `/api/state` and returned Pomopomo's own JSON 401 (no user identity). This proves application device tokens alone cannot reach private Sites.

The chosen, deployed gateway is:

`https://pomopomo-device-gateway.pomopomo-karti.workers.dev`

It keeps the Sites service credential in a Cloudflare Worker secret named `SITES_SERVICE_TOKEN`. That credential is never sent to firmware or browser code. The gateway only forwards GET `/api/device/state`, POST `/api/device/command`, and POST `/api/device/pair` to the fixed Pomopomo origin. Caller cookies, identity headers, destination URLs and redirects are not forwarded. The Site remains owner-private. No second database is created.

The logged-in PWA generates an account-linked, 128-bit pairing code valid for ten minutes. The device generates a 256-bit token and persists it before claiming the code. D1 stores SHA-256 hashes, never raw pairing codes/tokens. Pairing consumes the code; retries with the same device token are safe, while a different token cannot reclaim it. Revocation is checked for every subsequent request, including command retries. A request already in progress may finish before a simultaneous revocation.

## Shared state and completion

The existing `user_states` D1 table and `{taskId, mode, remaining, deadline}` timer are retained. Server `SharedState` reuses `settleTimer`, `activityFor`, and existing task/history types. Both PWA and ESP32 send explicit timer commands. Full browser task snapshots cannot overwrite timer state or completed counts. Stale commands return HTTP 409 and the latest state; the client requires another deliberate action. Task-edit conflicts retain the existing cloud/device choice, with the cloud timer and progress preserved.

Every accepted command records `(account, actor, commandId)` plus its request hash atomically with the state revision. Retrying the same ID and payload returns current state without repeating the action. Reusing an ID for different input is rejected. The ESP32 persists pending commands before sending, including across reboot. On browser request timeouts the same command is retried once; polling subsequently reconciles state.

At the deadline, a state request or command settles the session on the server. Conditional D1 batch statements atomically insert the deterministic history entry and update progress/timer at the expected revision. Racing browsers/devices cannot double-credit. History records the actual deadline, not the time a delayed device reconnects.

The online ESP32 polls every five seconds, so completion works with all browsers closed. **There is no scheduler when every client is off or offline**: the deadline remains saved, and completion is credited on the next request. Starting, pausing, resuming and resetting require a connection. Task edits can still be saved locally offline. Refresh older installed PWAs before using shared timer controls; legacy snapshot timer writes are rejected rather than overriding the server.

## Firmware foundation and drivers

The user authorized using the Arduino IDE's open `09_LVGL_V8_Test` example as MyEpaperApp's foundation because no existing MyEpaperApp was found. `firmware/MyEpaperApp/` retains its Waveshare display and power drivers, pin configuration, and LVGL framebuffer approach. The demo image loop is replaced with task/timer UI and a separate network task.

Inspected local sources and upstream Waveshare commit `aaf395c1bbd86f7c5b7a2f9f0401241ff5c44956`:

- Display SPI: SCK 12, MOSI 13, CS 11, DC 10, RST 9, BUSY 8; panel power GPIO 6 is active LOW.
- BOOT is GPIO 0; PWR is GPIO 18. Both use pull-ups and active-LOW presses.
- Battery latch GPIO 17 must stay HIGH after power-on. Releasing it powers down on battery. Audio power GPIO 42 is kept HIGH/off.
- The vendor PWR demo interprets long press as power-off. Its button sample also attaches BOOT long-press callbacks to the wrong button object; this sketch instead uses its own debounced event task.
- The initial power-on PWR hold is ignored until released. Long PWR retains deliberate power-off; on USB, where power cannot be cut, it enters deep sleep and wakes from PWR.
- Battery level is read on GPIO4 (ADC1 channel 3) through the board's 1:2 divider, averaged over 16 calibrated samples every 30 seconds. `battery_level.h` maps the single-cell LiPo voltage to a percentage rounded to 5%, shown as an icon and number in the top-right corner. It is hidden when the reading is outside 2.5–4.6 V (for example no battery). Charging state is not detected, so the figure reads high while charging. Voltage-based estimates are approximate; verify against a real battery. `g++ -std=c++17 tests/firmware/battery_level_test.cpp -o /tmp/battery_test && /tmp/battery_test` checks the curve.

The vendor display driver exposes full/base-image and partial-refresh functions. The first frame and every ten partial refreshes use a full base refresh. Idle identical screens do not refresh. Running time is rounded up to the next 30-second display increment; timing and server completion still use millisecond deadlines. Actions refresh after acknowledgement, with a 1.2-second minimum spacing. The display runs separately from network operations; BUSY has a 15-second timeout/restart safeguard. These settings compile and follow the driver protocol; ghosting and acceptable flicker need physical verification. The built-in Latin font may show boxes for unsupported scripts/emoji, and long titles wrap into the available title area.

## Arduino IDE settings (V2 non-touch)

Confirm the board has V2 marking. Do not use V1 or touch firmware.

| Setting | Value |
|---|---|
| Board package | esp32 by Espressif Systems **3.3.0** (compiled version) |
| Board | ESP32S3 Dev Module |
| CPU Frequency | 240 MHz (WiFi) |
| Flash Size | 8 MB (64 Mb) |
| Flash Mode | QIO 80 MHz |
| Partition Scheme | 8M with spiffs (3MB APP/1.5MB SPIFFS) |
| PSRAM | OPI PSRAM |
| USB Mode | Hardware CDC and JTAG |
| USB CDC On Boot | Enabled |
| Upload Mode | UART0 / Hardware CDC |
| Upload Speed | 460800 (reduce to 115200 if unreliable) |
| Serial Monitor | 115200 baud; Newline ending |
| Erase All Flash Before Sketch Upload | Disabled (preserves pairing/Wi-Fi) |

Install **LVGL 8.3.11** and **ArduinoJson 7.4.2** in Library Manager. Copy `firmware/lv_conf.h` beside the installed `lvgl` directory (normally `<Sketchbook>/libraries/lv_conf.h`). This enables RGB565 and the 28px timer font. Do not use LVGL 9. Open `firmware/MyEpaperApp/MyEpaperApp.ino`, select the board/port and Verify.

A repeatable local build without modifying your IDE libraries is also available:

```sh
cd /Users/kartibomb/Coding/pomopomo/pomopomo
./firmware/build.sh
```

This uses the installed ESP32 core in `~/Library/Arduino15` and isolated libraries under ignored `firmware/build`. On other systems set `ARDUINO_DATA_DIR` to the Arduino data directory. The exact compiled FQBN is:

```text
esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi,CDCOnBoot=cdc,USBMode=hwcdc,FlashMode=qio
```

## Change Wi-Fi from your phone

Hold **BOOT for five seconds while the device is running**, then release it. Setup works even when the device is offline. Do not hold PWR for this gesture: PWR still powers off the board. A shorter BOOT hold (2–5 seconds) performs its existing back/reset action only on release; continuing to five seconds opens setup without resetting the shared timer.

The screen shows a network named `Pomopomo-Setup-xxxx`, a temporary password and `http://192.168.4.1`.

1. In your phone's Wi-Fi settings, join that network with the password shown on the device. Stay connected even if your phone says it has no internet.
2. Open `http://192.168.4.1` in Safari/Chrome if the setup page does not open automatically.
3. Select the new **2.4 GHz** Wi-Fi (or type a hidden network's name), enter its password, and tap **Connect**.
4. The device tests the connection before saving it. Incorrect details leave the setup page open and retain your previously saved settings. Once it connects, the device saves only the new Wi-Fi configuration and restarts. Return your phone to normal Wi-Fi.

Your account token, pairing and any pending timer command are preserved. There is no need to revoke or pair again when changing Wi-Fi. A new/unconfigured device opens the same portal automatically and also asks for the pairing code from the PWA.

The temporary access point uses a random WPA password, is available only after the physical gesture (or first boot), and closes on success, Cancel, or a ten-minute timeout. Cancel/timeout restart with saved settings. A per-session token protects configuration requests; credentials are neither logged nor sent to the cloud. The network worker pauses before the portal changes Wi-Fi or Preferences. A running cloud timer continues, and completion is reconciled after reconnection.

USB Serial remains a recovery path. Sending `{"wifiSetup":true}` opens the same portal without clearing stored settings. Sending `{"reset":true}` still factory-resets local credentials; do not use reset just to change Wi-Fi.

## Upload and first-time Wi-Fi/pairing

1. Connect a USB **data** cable. Select the actual port in Arduino IDE. The previously selected `/dev/cu.usbmodem1101` was not connected during inspection; do not assume that port is still correct.
2. Upload. If no port appears, hold BOOT while connecting/powering on, then release BOOT after the download port appears. Upload again. Do not keep BOOT pressed during normal boot.
3. In the refreshed [Pomopomo PWA](https://pomopomo-focus-kr7.cloudywand21.chatgpt.site), expand **E-paper devices**, click **Pair a device**, and copy the ten-minute code.
4. Open Serial Monitor at 115200 with Newline. Send this single-line JSON, replacing SSID/password/code locally:

```json
{"ssid":"YOUR_2.4_GHZ_WIFI","password":"YOUR_WIFI_PASSWORD","gateway":"https://pomopomo-device-gateway.pomopomo-karti.workers.dev","pairingCode":"COPY_THE_32_CHARACTER_CODE"}
```

Use JSON escaping for quotes/backslashes in passwords. No credentials need to be put into the sketch or chat. This setup uses 2.4 GHz Wi-Fi, not captive portals or enterprise login. Settings and the device token are stored in ESP32 NVS; normal uploads preserve them. Physical flash access is outside the protection provided by TLS/device revocation.

5. The board restarts, obtains network time for TLS certificate validation, pairs, then fetches your existing account's tasks. A screen stuck on secure clock needs working DNS/NTP; do not disable certificate validation. Public CA roots are bundled from Google PKI and Let's Encrypt; refresh them if upstream certificates change.
6. To change Wi-Fi, use the phone portal above. To factory-reset or re-pair via USB, send `{"reset":true}` in Serial Monitor, then provide new setup JSON after restart. Reset clears local credentials and pending commands, not cloud history. Revoke the old device entry in the PWA.

Controls:

| Gesture | Action |
|---|---|
| BOOT short press | Browse next unfinished task |
| PWR short press while browsing | Select highlighted task |
| PWR short press on selected task | Start / pause / resume shared timer |
| BOOT hold 2–5 seconds, release while browsing | Return to timer |
| BOOT hold 2–5 seconds, release on timer | Reset current timer |
| BOOT hold 5 seconds while running | Open phone Wi-Fi setup (works offline) |
| PWR hold 2 seconds | Power off after release; USB uses deep sleep |

Selecting another task during an active/paused session is rejected until reset/completion. Buttons are disabled if state is more than 15 seconds old, disconnected, or a command is awaiting acknowledgement. A stale-revision message requires another press after reviewing the updated timer.

## Hardware acceptance checks

- On USB, verify clean 200×200 rendering and both buttons. Confirm BOOT cycles tasks and PWR selects without powering off on a short press.
- Start a session on the ESP32; confirm laptop and phone show the same running deadline within roughly five seconds. Pause from the phone, resume from ESP32, then reverse the roles.
- Close both browsers, leave the ESP32 online, finish one session, reopen the PWA and verify exactly one progress increment/history entry.
- Drop Wi-Fi around a button action and reconnect; verify the pending command is resolved once. Check stale-action messages when another device changes the timer.
- Revoke the device in the PWA. It must stop fetching/controlling tasks on its next request; old token and pairing code must fail.
- Run through a full session; inspect partial-refresh ghosting and full-refresh cadence. If artifacts remain, shorten the full-refresh interval. There are no per-second refreshes.
- Check the battery indicator on battery and on USB: the percentage should fall slowly during a session and match a multimeter reading of the cell within roughly 10%.
- On battery only, release PWR after power-on: the board must stay on. Short PWR must not cut power; a two-second hold and release must shut it down. Repeat while on USB to check sleep/wake. A battery-powered board was not available to verify this here.

## Validation and maintenance

`node --experimental-strip-types --test tests/*.test.mjs` covers existing timer/history logic, shared-state D1 races/receipts/completion and gateway isolation. `node tests/device-api.mjs` targets a local production server on 8787 only and covers actual pairing/auth/revocation APIs. No production tasks are created by those scripts.

Gateway redeploy: `npx wrangler deploy --config gateway/wrangler.jsonc`. Keep the existing secret; if Sites rotates it, update it via `wrangler secret put SITES_SERVICE_TOKEN --config gateway/wrangler.jsonc` using a secure local prompt. Never put it into firmware, `.env` committed files, or browser code. A gateway 502 reporting Sites access unavailable indicates service access should be checked.

Cloudflare agent setup installed 22 Cloudflare skills in `~/.agents/skills` (including Codex copies) and configured/authenticated the `cloudflare` MCP server in `~/.codex/config.toml`. Restart the agent to load newly registered MCP tools. The optional `cf` CLI was not installed; this project uses Wrangler. The installer's warnings concerned PromptScript global installation, not the successful Codex installation.

Sources:
- [Waveshare board](https://docs.waveshare.com/ESP32-S3-ePaper-1.54)
- [Waveshare Arduino setup](https://docs.waveshare.com/ESP32-S3-ePaper-1.54/Arduino)
- [Waveshare drivers](https://github.com/waveshareteam/ESP32-S3-ePaper-1.54/tree/aaf395c1bbd86f7c5b7a2f9f0401241ff5c44956/02_Example/Arduino)
- [Cloudflare D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare agent setup instructions](https://developers.cloudflare.com/agent-setup/prompt.md)

## PWR short-press fix

The button hold check now requires a debounced LOW level before using the current press timestamp. Previously, a fresh raw edge could use the previous timestamp and incorrectly emit a power-off event on an ordinary tap. `node tests/firmware/buttons.test.mjs` compiles the actual button task in a timed GPIO harness and covers one tap, an ignored startup hold, and one deliberate power-off hold. A short PWR tap is handled on release; wait for network acknowledgement before pressing again.

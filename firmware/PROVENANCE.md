# Firmware source provenance

The owner approved using the open local Waveshare `09_LVGL_V8_Test` example to create MyEpaperApp. The original remains at `/Users/kartibomb/Downloads/ESP32-S3-ePaper-1.54-main/02_Example/Arduino/09_LVGL_V8_Test`.

Copied unchanged: `src/power/*`, `user_config.h`, `src/display/epaper_driver_bsp.h`.
Copied and modified: `src/display/epaper_driver_bsp.cpp` adds Arduino timing access and a 15-second BUSY timeout/restart. `lv_conf.h` comes from the vendor LVGL8 configuration with the 28px font enabled.
New: MyEpaperApp.ino integration, build script and setup guide. The main sketch preserves the example's LVGL RGB565-to-monochrome framebuffer conversion, SPI/display driver and power driver.

Button/power/partial-refresh behavior was cross-checked against Waveshare's public source at commit `aaf395c1bbd86f7c5b7a2f9f0401241ff5c44956`. Vendor copyright notices in supplied source are retained. Original repository: https://github.com/waveshareteam/ESP32-S3-ePaper-1.54 .

`trust_roots.h` contains public trust certificates downloaded from https://pki.goog/roots.pem and https://letsencrypt.org/certs/isrgrootx1.pem, not private keys. There are no Wi-Fi passwords, pairing codes, device tokens, or Sites service credentials in this source tree.

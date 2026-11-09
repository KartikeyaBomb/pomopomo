#!/usr/bin/env bash
set -euo pipefail
firmware_dir="$(cd "$(dirname "$0")" && pwd)"
if command -v arduino-cli >/dev/null; then cli_path="$(command -v arduino-cli)"; else cli_path='/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli'; fi
if [ ! -x "$cli_path" ]; then echo 'Install Arduino IDE or arduino-cli first.'; exit 1; fi
build_root="$firmware_dir/build"
mkdir -p "$build_root/libraries"
arduino_data="${ARDUINO_DATA_DIR:-$HOME/Library/Arduino15}"
printf 'directories:\n  user: %s\n  data: %s\n' "$build_root" "$arduino_data" > "$build_root/cli.yaml"
"$cli_path" --config-file "$build_root/cli.yaml" lib install 'lvgl@8.3.11' 'ArduinoJson@7.4.2'
cp "$firmware_dir/lv_conf.h" "$build_root/libraries/lv_conf.h"
"$cli_path" --config-file "$build_root/cli.yaml" compile --fqbn 'esp32:esp32:esp32s3:FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi,CDCOnBoot=cdc,USBMode=hwcdc,FlashMode=qio' --build-path "$build_root/output" "$firmware_dir/MyEpaperApp"
echo 'Compiled. See docs/EPAPER.md for upload and pairing.'

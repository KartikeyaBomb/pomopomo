#pragma once

// ESP32-S3-ePaper-1.54 V2 measures the battery on GPIO4 (ADC1 channel 3) through a 1:2 divider.
constexpr float BATTERY_DIVIDER = 2.0f;
// Below this there is no battery (USB only / floating input); above the max the reading is invalid.
constexpr float BATTERY_MIN_VALID_VOLTS = 2.5f;
constexpr float BATTERY_MAX_VALID_VOLTS = 4.6f;

// Single-cell LiPo discharge curve (resting voltage → percent), descending.
struct BatteryPoint { float volts; int percent; };
constexpr BatteryPoint BATTERY_CURVE[] = {
  {4.20f, 100}, {4.06f, 90}, {3.98f, 80}, {3.92f, 70}, {3.87f, 60}, {3.82f, 50},
  {3.79f, 40}, {3.77f, 30}, {3.74f, 20}, {3.68f, 10}, {3.45f, 5}, {3.30f, 0},
};

// Returns -1 when no battery reading is available, otherwise 0-100 rounded to the nearest 5
// so small ADC noise does not trigger e-paper refreshes.
inline int batteryDisplayPercent(float volts) {
  if (volts < BATTERY_MIN_VALID_VOLTS || volts > BATTERY_MAX_VALID_VOLTS) return -1;
  constexpr int last = sizeof(BATTERY_CURVE) / sizeof(BATTERY_CURVE[0]) - 1;
  if (volts >= BATTERY_CURVE[0].volts) return 100;
  if (volts <= BATTERY_CURVE[last].volts) return 0;
  float percent = 0;
  for (int i = 0; i < last; i++) {
    const BatteryPoint &high = BATTERY_CURVE[i], &low = BATTERY_CURVE[i + 1];
    if (volts <= high.volts && volts >= low.volts) {
      percent = low.percent + (volts - low.volts) / (high.volts - low.volts) * (high.percent - low.percent);
      break;
    }
  }
  return (int)((percent + 2.5f) / 5.0f) * 5;
}

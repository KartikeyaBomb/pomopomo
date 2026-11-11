#include <cassert>
#include "../../firmware/MyEpaperApp/battery_level.h"
int main() {
  assert(batteryDisplayPercent(4.20f) == 100);
  assert(batteryDisplayPercent(4.35f) == 100);
  assert(batteryDisplayPercent(3.82f) == 50);
  assert(batteryDisplayPercent(3.30f) == 0);
  assert(batteryDisplayPercent(3.00f) == 0);
  // Midway between 3.98 V (80%) and 4.06 V (90%) rounds to the nearest 5.
  assert(batteryDisplayPercent(4.02f) == 85);
  // Missing or implausible readings hide the indicator.
  assert(batteryDisplayPercent(0.0f) == -1);
  assert(batteryDisplayPercent(2.49f) == -1);
  assert(batteryDisplayPercent(4.61f) == -1);
  // Never increases as voltage falls.
  int previous = 100;
  for (float v = 4.2f; v >= 3.0f; v -= 0.01f) {
    int p = batteryDisplayPercent(v);
    assert(p >= 0 && p <= previous && p % 5 == 0);
    previous = p;
  }
}

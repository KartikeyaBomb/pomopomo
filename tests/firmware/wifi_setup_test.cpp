#include <cassert>
#include "../../firmware/MyEpaperApp/wifi_setup.h"
int main() {
  // Existing pairing needs no new code when Wi-Fi changes.
  assert(validateWifiSetup("Travel WiFi", "testpass123", "", true).empty());
  assert(!validateWifiSetup("Travel WiFi", "testpass123", "", false).empty());
  assert(validateWifiSetup("New device", "testpass123", String(32, 'a'), false).empty());
  assert(!validateWifiSetup("New device", "testpass123", String(32, 'z'), false).empty());
  assert(!validateWifiSetup("", "testpass123", "", true).empty());
  assert(validateWifiSetup(String(32, 'x'), "", "", true).empty());
  assert(!validateWifiSetup(String(33, 'x'), "", "", true).empty());
  assert(validateWifiSetup("Open network", "", "", true).empty());
  assert(!validateWifiSetup("WiFi", "short", "", true).empty());
  assert(validateWifiSetup("WiFi", String(63, 'x'), "", true).empty());
  assert(validateWifiSetup("WiFi", String(64, 'a'), "", true).empty());
  assert(!validateWifiSetup("WiFi", String(64, 'z'), "", true).empty());
  assert(!validateWifiSetup("WiFi", String(65, 'a'), "", true).empty());
}

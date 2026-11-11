#pragma once
#include <Arduino.h>


// Validate the same byte limits accepted by the ESP32 Wi-Fi station.
inline String validateWifiSetup(const String &ssid, const String &password, const String &pair, bool hasAccount) {
  if (ssid.length() == 0 || ssid.length() > 32) return "Enter a network name (1–32 bytes).";
  if (password.length() && (password.length() < 8 || password.length() > 64)) return "Wi-Fi passwords must be 8–63 characters, or a 64-digit hex key.";
  if (password.length() == 64) for (size_t i = 0; i < password.length(); i++) if (!isxdigit((unsigned char)password[i])) return "A 64-character Wi-Fi key must contain only hex digits.";
  if (!pair.isEmpty() || !hasAccount) {
    if (pair.length() != 32) return "Enter the 32-character pairing code from Pomopomo.";
    for (size_t i = 0; i < pair.length(); i++) if (!isxdigit((unsigned char)pair[i])) return "Pairing code must contain only hex digits.";
  }
  return "";
}

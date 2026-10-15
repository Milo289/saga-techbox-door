// ESP32 (Arduino): een knop meldt "press"; de ingebouwde led toont de deurstatus.
// Zet WIFI_*, SERVER en KEY in en upload met de Arduino IDE (bord: "ESP32 Dev Module").
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "jouw-wifi";
const char* WIFI_PASS = "wachtwoord";
const char* SERVER = "http://192.168.1.10:8080";   // het adres van de deurserver
const char* KEY = "door_...";                       // API-sleutel met het recht "devices"
const char* NAME = "deurknop";
const int BUTTON = 0, LED = 2;

String call(const String& method, const String& path, const String& body = "") {
  HTTPClient http;
  http.begin(String(SERVER) + path);
  http.addHeader("Authorization", String("Bearer ") + KEY);
  http.addHeader("Content-Type", "application/json");
  int code = method == "POST" ? http.POST(body) : http.GET();
  String out = code > 0 ? http.getString() : "";
  http.end();
  return out;
}

void setup() {
  pinMode(BUTTON, INPUT_PULLUP); pinMode(LED, OUTPUT);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
}

unsigned long lastPoll = 0;
void loop() {
  if (digitalRead(BUTTON) == LOW) {
    call("POST", "/api/device/report", String("{\"device\":\"") + NAME + "\",\"event\":\"press\"}");
    delay(800);
  }
  if (millis() - lastPoll > 10000) {                 // om de 10 seconden de status ophalen
    lastPoll = millis();
    String s = call("GET", String("/api/device/poll?device=") + NAME);
    digitalWrite(LED, s.indexOf("\"mode\":\"open\"") >= 0 ? HIGH : LOW);   // led aan = open
  }
}

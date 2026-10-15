# Raspberry Pi Pico W (MicroPython): een knop op GP15 meldt "press"; de led toont de deurstatus.
import network, time, urequests, ujson
from machine import Pin

WIFI_SSID, WIFI_PASS = "jouw-wifi", "wachtwoord"
SERVER = "http://192.168.1.10:8080"      # het adres van de deurserver
KEY = "door_..."                          # API-sleutel met het recht "devices"
NAME = "deurknop"

wlan = network.WLAN(network.STA_IF); wlan.active(True); wlan.connect(WIFI_SSID, WIFI_PASS)
while not wlan.isconnected(): time.sleep(0.3)

button = Pin(15, Pin.IN, Pin.PULL_UP); led = Pin("LED", Pin.OUT)
H = {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

def call(method, path, body=None):
    try:
        r = urequests.request(method, SERVER + path, data=ujson.dumps(body) if body else None, headers=H)
        out = r.json(); r.close(); return out
    except Exception:
        return {}

last = 0
while True:
    if button.value() == 0:
        call("POST", "/api/device/report", {"device": NAME, "event": "press"}); time.sleep(0.8)
    if time.time() - last > 10:
        last = time.time()
        led.value(1 if call("GET", "/api/device/poll?device=" + NAME).get("mode") == "open" else 0)
    time.sleep(0.05)

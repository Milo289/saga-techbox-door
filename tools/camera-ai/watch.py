#!/usr/bin/env python3
"""Camera-AI voor de deur (voorbeeld, niet getest op echte camera's).

Haalt om de paar seconden een stilstaand beeld van de camera, herkent gezichten van mensen die jij hebt aangeleverd
(map `gezichten/Naam.jpg`) en meldt dat aan de deurserver. Er wordt niets opgeslagen of verstuurd behalve naam en zekerheid.

Installeren:  pip install face_recognition requests pillow
Gebruiken:    SERVER=http://localhost:8080 KEY=door_... SNAPSHOT=http://camera/snapshot.jpg python3 watch.py
"""
import io, os, time, glob
import requests, face_recognition

SERVER, KEY, SNAPSHOT = os.environ["SERVER"], os.environ["KEY"], os.environ["SNAPSHOT"]
CAMERA = os.environ.get("CAMERA", "voordeur")
EVERY, COOLDOWN, MAX_DIST = 3, 60, 0.5          # seconden tussen beelden, minimale tijd tussen twee meldingen per persoon

known, names = [], []
for path in glob.glob(os.path.join(os.path.dirname(__file__), "gezichten", "*.jpg")):
    enc = face_recognition.face_encodings(face_recognition.load_image_file(path))
    if enc:
        known.append(enc[0]); names.append(os.path.splitext(os.path.basename(path))[0])
print(f"{len(known)} gezichten geladen")

last_sent = {}
def report(name, conf):
    requests.post(f"{SERVER}/api/camera/event", json={"camera": CAMERA, "kind": "face", "name": name, "confidence": conf},
                  headers={"Authorization": f"Bearer {KEY}"}, timeout=8)

while True:
    try:
        img = face_recognition.load_image_file(io.BytesIO(requests.get(SNAPSHOT, timeout=8).content))
        for enc in face_recognition.face_encodings(img):
            dist = face_recognition.face_distance(known, enc) if known else []
            i = int(dist.argmin()) if len(dist) else -1
            name = names[i] if i >= 0 and dist[i] <= MAX_DIST else ""
            conf = round(float(1 - dist[i]), 2) if i >= 0 else 0
            key = name or "onbekend"
            if time.time() - last_sent.get(key, 0) > COOLDOWN:
                last_sent[key] = time.time(); report(name, conf)
    except Exception as e:
        print("fout:", e)
    time.sleep(EVERY)

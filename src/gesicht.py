#!/usr/bin/env python3
"""Findet das Gesicht in einigen Bildern eines Videos (lokal, OpenCV).

Aufruf: gesicht.py VIDEO [BILDER] [--alle]
Ausgabe (JSON): {"bilder": n, "gesichter": [{"t": s, "x": .., "y": .., "w": .., "h": ..}, ...]}
x/y/w/h sind Anteile der Bildbreite bzw. -höhe (0–1), standardmäßig nur das größte Gesicht.
--alle liefert alle Treffer, untersucht auch Anfang/Ende und verwendet 720 statt 360 Pixel Suchbreite.
Installation: python3 -m venv .venv && .venv/bin/pip install "opencv-python-headless>=4.10,<5"
"""
import json
import sys

import cv2


def main():
    video = sys.argv[1]
    anzahl = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    alle = "--alle" in sys.argv[3:]
    kaskade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    cap = cv2.VideoCapture(video)  # dreht Handyvideos selbst richtig herum
    gesamt = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    gesichter = []
    bilder = 0
    for i in range(anzahl):
        # Gleichmäßig verteilt, Anfang und Ende (oft noch Wackeln) ausgelassen
        nummer = round((gesamt - 1) * i / max(1, anzahl - 1)) if alle else int(gesamt * (0.05 + 0.9 * (i + 0.5) / anzahl))
        cap.set(cv2.CAP_PROP_POS_FRAMES, nummer)
        ok, bild = cap.read()
        if not ok:
            continue
        bilder += 1
        hoehe, breite = bild.shape[:2]
        suchbreite = 720 if alle else 360
        faktor = suchbreite / breite
        klein = cv2.cvtColor(cv2.resize(bild, (suchbreite, round(hoehe * faktor))), cv2.COLOR_BGR2GRAY)
        klein = cv2.equalizeHist(klein)
        treffer = kaskade.detectMultiScale(klein, scaleFactor=1.1, minNeighbors=6, minSize=(40, 40))
        if len(treffer) == 0:
            continue
        kh, kb = klein.shape[:2]
        for x, y, w, h in (treffer if alle else [max(treffer, key=lambda r: r[2] * r[3])]):
            gesichter.append({
                "t": round(nummer / fps, 4),
                "x": round(x / kb, 4), "y": round(y / kh, 4), "w": round(w / kb, 4), "h": round(h / kh, 4),
            })
    cap.release()
    print(json.dumps({"bilder": bilder, "gesichter": gesichter, "alleGesichter": alle}))


if __name__ == "__main__":
    main()

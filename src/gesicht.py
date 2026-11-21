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
from pathlib import Path

import cv2


def main():
    video = sys.argv[1]
    anzahl = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    alle = "--alle" in sys.argv[3:]
    # Ausschließlich die Ausschnittprüfung erhält die neue Erkennung. Die
    # vorhandene Untertitel-Suche behält ihre bisherigen Ergebnisse.
    netz = None
    if alle:
        modell = Path(__file__).resolve().parent.parent / "assets/models/face_detection_yunet_2023mar.onnx"
        if modell.is_file() and hasattr(cv2, "FaceDetectorYN"):
            try:
                netz = cv2.FaceDetectorYN.create(str(modell), "", (720, 405), 0.8, 0.3, 5000)
            except cv2.error as e:
                print(f"YuNet nicht verfügbar, verwende Haar: {e}", file=sys.stderr)
    kaskade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    cap = cv2.VideoCapture(video)  # dreht Handyvideos selbst richtig herum
    gesamt = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    gesichter = []
    bilder = 0
    zeiten = []
    gesehen = set()
    for i in range(anzahl):
        # Gleichmäßig verteilt, Anfang und Ende (oft noch Wackeln) ausgelassen
        nummer = round((gesamt - 1) * i / max(1, anzahl - 1)) if alle else int(gesamt * (0.05 + 0.9 * (i + 0.5) / anzahl))
        if alle and nummer in gesehen:
            continue
        gesehen.add(nummer)
        cap.set(cv2.CAP_PROP_POS_FRAMES, nummer)
        ok, bild = cap.read()
        if not ok:
            continue
        bilder += 1
        zeit = round(nummer / fps, 4)
        zeiten.append(zeit)
        hoehe, breite = bild.shape[:2]
        suchbreite = 720 if alle else 360
        faktor = suchbreite / breite
        farbe = cv2.resize(bild, (suchbreite, round(hoehe * faktor)))
        kh, kb = farbe.shape[:2]
        if netz is not None:
            netz.setInputSize((kb, kh))
            _, result = netz.detect(farbe)
            treffer = [] if result is None else result[:, :4]
        else:
            klein = cv2.equalizeHist(cv2.cvtColor(farbe, cv2.COLOR_BGR2GRAY))
            treffer = kaskade.detectMultiScale(klein, scaleFactor=1.1, minNeighbors=6, minSize=(40, 40))
        if len(treffer) == 0:
            continue
        for x, y, w, h in (treffer if alle else [max(treffer, key=lambda r: r[2] * r[3])]):
            rechts, unten = min(kb, float(x + w)), min(kh, float(y + h))
            x, y = max(0, float(x)), max(0, float(y))
            w, h = rechts - x, unten - y
            if w <= 0 or h <= 0:
                continue
            gesichter.append({
                "t": zeit,
                "x": round(x / kb, 4), "y": round(y / kh, 4), "w": round(w / kb, 4), "h": round(h / kh, 4),
            })
    cap.release()
    print(json.dumps({"bilder": bilder, "gesichter": gesichter, "alleGesichter": alle,
                      "version": 2, "zeiten": zeiten, "methode": "yunet" if netz is not None else "haar"}))


if __name__ == "__main__":
    main()

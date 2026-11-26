#!/usr/bin/env python3
"""Findet das Gesicht in einigen Bildern eines Videos (lokal, OpenCV).

Aufruf: gesicht.py VIDEO [BILDER] [--alle] [--dicht]
Ausgabe (JSON): {"bilder": n, "gesichter": [{"t": s, "x": .., "y": .., "w": .., "h": ..}, ...]}
x/y/w/h sind Anteile der Bildbreite bzw. -höhe (0–1), standardmäßig nur das größte Gesicht.
--alle liefert alle Treffer, untersucht auch Anfang/Ende und verwendet 720 statt 360 Pixel Suchbreite.
--dicht prüft mindestens zwei Bilder pro Sekunde mit echten FFmpeg-Zeitstempeln.
Installation: python3 -m venv .venv && .venv/bin/pip install "opencv-python-headless>=4.10,<5"
"""
import json
import sys
from pathlib import Path
import subprocess
import re
import threading
from queue import Queue
from collections import deque

import cv2
import numpy as np


def probebilder(video, anzahl, alle, dicht):
    cap = cv2.VideoCapture(video)
    gesamt = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    if dicht:
        ok, erstes = cap.read()
        cap.release()
        if not ok:
            return
        h, w = erstes.shape[:2]
        ziel_h = max(2, round(h * 720 / w / 2) * 2)
        intervall = min(0.5, max(0.02, (gesamt - 1) / fps / 23))
        # Ein Durchlauf auf der bereits gerenderten H.264-Fassung ist wesentlich
        # günstiger als hunderte einzelne Suchläufe in einer HEVC-Originaldatei.
        zeiten = Queue()
        fehler = deque(maxlen=30)
        p = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "info", "-threads", "2", "-i", video,
                              "-an", "-vf", f"select='isnan(prev_selected_t)+gte(t-prev_selected_t,{intervall})',scale=720:{ziel_h},showinfo",
                              "-vsync", "0", "-pix_fmt", "bgr24", "-f", "rawvideo", "pipe:1"],
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        def meldungen():
            for zeile in iter(p.stderr.readline, b""):
                text = zeile.decode(errors="replace")
                fehler.append(text)
                match = re.search(r"\bn:\s*\d+.*\bpts_time:([\d.eE+-]+)", text)
                if match:
                    zeiten.put(float(match.group(1)))

        leser = threading.Thread(target=meldungen, daemon=True)
        leser.start()
        try:
            while True:
                daten = p.stdout.read(720 * ziel_h * 3)
                if not daten:
                    break
                if len(daten) != 720 * ziel_h * 3:
                    raise RuntimeError("Unvollständiges Probebild von FFmpeg")
                # Echte Zeitstempel statt der zeitlich versetzten Ausgabe von fps=2.
                yield zeiten.get(timeout=10), np.frombuffer(daten, dtype=np.uint8).reshape(ziel_h, 720, 3)
            if p.wait() != 0:
                raise RuntimeError("".join(fehler)[-1000:])
        finally:
            p.stdout.close()
            if p.poll() is None:
                p.kill()
                p.wait()
            leser.join(timeout=2)
            p.stderr.close()
        return
    gesehen = set()
    try:
        for i in range(anzahl):
            nummer = round((gesamt - 1) * i / max(1, anzahl - 1)) if alle else int(gesamt * (0.05 + 0.9 * (i + 0.5) / anzahl))
            if alle and nummer in gesehen:
                continue
            gesehen.add(nummer)
            cap.set(cv2.CAP_PROP_POS_FRAMES, nummer)
            ok, bild = cap.read()
            if ok:
                yield round(nummer / fps, 4), bild
    finally:
        cap.release()


def main():
    video = sys.argv[1]
    anzahl = int(sys.argv[2]) if len(sys.argv) > 2 else 12
    alle = "--alle" in sys.argv[3:]
    dicht = alle and "--dicht" in sys.argv[3:]
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
    gesichter = []
    bilder = 0
    zeiten = []
    for zeit, bild in probebilder(video, anzahl, alle, dicht):
        bilder += 1
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
    print(json.dumps({"bilder": bilder, "gesichter": gesichter, "alleGesichter": alle,
                      "version": 3, "dicht": dicht, "zeiten": zeiten, "methode": "yunet" if netz is not None else "haar"}))


if __name__ == "__main__":
    main()

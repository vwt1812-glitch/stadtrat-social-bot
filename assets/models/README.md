# Lokales Gesichtserkennungsmodell

`face_detection_yunet_2023mar.onnx` stammt aus dem offiziellen OpenCV Zoo:

- Quelle: https://github.com/opencv/opencv_zoo/tree/48b10fa505aeb51fbd127fc60a5c660040e823b7/models/face_detection_yunet
- SHA-256: `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`
- Größe: 232589 Byte
- Lizenz: MIT, siehe `YUNET-LICENSE.txt`

Das Modell wird ausschließlich lokal von OpenCV für die Ausschnittprüfung verwendet.
Es gibt keine Übertragung von Videobildern und keinen Modelldownload zur Laufzeit.
Fehlt die Unterstützung in OpenCV, verwendet die Ausschnittprüfung die bisherige
Haar-Erkennung. Die separate Gesichtssuche für Untertitel bleibt unverändert.

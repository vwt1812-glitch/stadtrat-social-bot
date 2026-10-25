# Lokale KI: wiederholbarer Qualitätstest (Raspberry Pi)

Dieser Prüfstand ist **nicht** mit dem Telegram-Bot oder Postiz verbunden. Er ruft nur einen lokalen llama.cpp-Server auf. Er veröffentlicht nichts und verwendet keine Cloud-API.

## 1. Lokalen Server starten

Zuerst den interaktiven llama-cli mit `/exit` beenden. Dann auf dem Raspberry Pi:

```bash
cd ~/llama.cpp
./build/bin/llama-server \
  -hf lmstudio-community/Qwen3-1.7B-GGUF:Q4_K_M \
  --host 127.0.0.1 --port 8088 -t 2 -c 1024 -np 1
```

Das Modell ist bereits heruntergeladen. Port 8088 ist **nur lokal** erreichbar; nicht ins Internet freigeben.

## 2. Tests durchführen

In einem **zweiten** SSH-Terminal:

```bash
cd ~/stadtrat-social-bot
node scripts/lokale-ki-vergleich.mjs
```

Das Skript schickt vier unterschiedliche Texte mit jeweils zwei Aufgaben an das Modell:
- **Fakten:** Aussagen aus dem Original in Statusgruppen erfassen
- **Redaktion:** maximal 350 Zeichen sprachlich überarbeiten

Die Ausgabe liegt in `lokale-ki-ergebnisse.json`, enthält für jeden Fall Quelle, erwartete Fakten, beide Modellantworten und Laufzeit. Diese Datei ist nur zur privaten Auswertung bestimmt. Bei circa 2 Tokens/Sekunde kann der gesamte Test länger dauern.

## 3. Menschlich prüfen

Pro Ergebnis in der JSON-Datei die vier Felder unter `manuellePruefung` bearbeiten:
- `alleFaktenEnthalten`: true/false
- `zusaetzlicheBehauptungen`: true/false
- `sprachlichBrauchbar`: true/false
- `notiz`: Begründung

Die maschinellen `kontrolle`-Felder erkennen nur Zeichenlänge und einzelne Statuswörter, **keine inhaltlichen Fehler**. Besonders auf erfundene Fraktionsbezeichnungen, falsche Beschlussstände und die Verwechslung von Antrag und Umsetzung achten. Keine automatische Freigabe oder Veröffentlichung.

## 4. Anderes Modell vergleichen

Erst den laufenden Server mit Strg+C beenden, dann alternativ starten, zum Beispiel:

```bash
cd ~/llama.cpp
./build/bin/llama-server \
  -hf lmstudio-community/gemma-3-4b-it-GGUF:Q4_K_M \
  --host 127.0.0.1 --port 8088 -t 2 -c 1024 -np 1
```

Danach mit eigenem Ausgabepfad starten:

```bash
cd ~/stadtrat-social-bot
LOKALE_KI_MODELL=gemma-3-4b node scripts/lokale-ki-vergleich.mjs gemma-ergebnisse.json
```

**Ressourcen:** Qwen3 1.7B zuerst testen; 4B kann auf dem Pi 4 stark verlangsamen. Währenddessen `free -h` und `vmstat 1 5` beobachten. Den Server mit Strg+C stoppen, wenn andere Dienste leiden.

Die Fälle sind fiktive, rein textbasierte Testfälle (bis auf den vom Benutzer vorgegebenen Livestream-Testtext). Sie ersetzen keine Prüfung realer politischer Tatsachen.

# Stadtrat Social-Media-Bot

Telegram-Bot für den Raspberry Pi: Video, Fotos oder Text reinschicken → Vorschau mit Logo, Untertiteln und
Caption-Vorschlag zurück → anpassen → mit **Ja** sofort oder zu einer bestimmten Zeit über [Postiz](https://postiz.com) posten.
Alles läuft lokal. Nur wenn ein `ANTHROPIC_API_KEY` eingetragen ist, gehen Transkript, Fotos bzw. Text für den
Caption-Vorschlag an Claude.

## Ablauf in Telegram

Was du schickst, bestimmt die Art des Beitrags:

| Eingabe | Was der Bot macht |
|---|---|
| **Video** – am besten **als Datei** (📎 → Datei), sonst komprimiert Telegram es | Sprache erkennen (whisper.cpp), Logo und Untertitel einbrennen, Caption aus dem Gesagten vorschlagen |
| **Foto** oder **Album** (bis 10 Fotos = Karussell) | Logo draufsetzen, auf max. 2048 px verkleinern. Text in der Bildunterschrift wird die Caption; ohne Text schlägt Claude eine vor (sieht sich dafür die Fotos an), ohne Claude gibt es nur die Hashtags |
| **Text** | wird unverändert zum Textbeitrag; mit „Neu formulieren“ macht Claude daraus einen fertigen Beitrag |

Danach kommt die Vorschau, darunter die Caption mit Knöpfen:

| Knopf | Was passiert |
|---|---|
| ✅ Jetzt posten | fragt nach („Wirklich jetzt auf … posten?“) und postet nach **Ja** |
| 🕐 Planen | Heute/Morgen-Vorschläge, nächster freier Postiz-Slot oder freie Eingabe wie `Fr 18 Uhr`, `24.10. 19:30`, `in 2 Stunden` |
| ✏️ Caption ändern | schickt den aktuellen Text zum Kopieren, die nächste Nachricht ist die neue Caption |
| 🔄 Neu formulieren | nur mit Claude: Wunsch eingeben (`kürzer`, `lockerer`, …) |
| 📝 Untertitel | nur Video: schickt die `.srt`; Korrekturen als `falsch => richtig` zurückschreiben oder die korrigierte Datei schicken – das Video wird neu gebaut |
| 🏷️ Logo drauf / entfernen | nur Fotos: Logo pro Beitrag an- oder abschalten (Standard: `LOGO_AUF_FOTOS`) |
| 📺 Kanäle | Postiz-Kanäle an-/abwählen |
| 🗑️ Verwerfen | Vorschlag löschen |

`abbrechen` beendet jede laufende Eingabe. Geplante Beiträge lassen sich danach im Postiz-Kalender ändern.

Bei der Kanalwahl sind nur passende Kanäle vorausgewählt: Textbeiträge gehen nicht an Instagram, TikTok, YouTube
und Pinterest (die brauchen ein Bild oder Video), Fotos nicht an YouTube. Wählt man so einen Kanal trotzdem an,
fragt der Bot vor dem Posten nach.

Fotos am besten normal schicken (nicht als Datei): Telegram dreht sie dann richtig, und die Größe reicht für Social Media.
iPhone-Fotos im HEIC-Format kann ffmpeg auf dem Pi meist nicht lesen.

## Einrichten auf dem Raspberry Pi

Getestet für Raspberry Pi OS (64 Bit). Ein Pi 5 ist empfehlenswert, ein Pi 4 geht, braucht aber spürbar länger.

### 1. Pakete und Node.js 22

```bash
sudo apt update
sudo apt install -y git cmake build-essential ffmpeg fonts-dejavu
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. whisper.cpp (Spracherkennung)

```bash
cd ~
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build -j4 --config Release
sh ./models/download-ggml-model.sh small     # oder base: schneller, ungenauer
```

`small` ist auf dem Pi 5 ein guter Kompromiss. Wenn's zu lange dauert: `base`. Probelauf:
`./build/bin/whisper-cli -m models/ggml-small.bin -l de -f samples/jfk.wav`

### 3. Bot anlegen

1. In Telegram **@BotFather** → `/newbot` → Token notieren.
2. In Postiz: **Einstellungen → Developers → Public API** → API-Key kopieren.

### 4. Bot installieren

```bash
cd ~
git clone https://github.com/vwt1812-glitch/stadtrat-social-bot.git
cd stadtrat-social-bot
npm ci
cp .env.example .env
nano .env                      # Token, Postiz-URL, API-Key, Whisper-Pfade eintragen
npm start
```

Dem Bot in Telegram schreiben – er antwortet mit deiner ID. Die in `ERLAUBTE_NUTZER` eintragen und neu starten.
Mit `/kanaele` prüfen, ob Postiz erreichbar ist.

### 5. Als Dienst starten

```bash
sudo cp social-bot.service /etc/systemd/system/   # vorher User/Pfad darin prüfen
sudo systemctl enable --now social-bot
journalctl -u social-bot -f
```

## Große Videos (über 20 MB)

Über `api.telegram.org` darf ein Bot nur Dateien bis **20 MB** herunterladen und bis 50 MB verschicken
(größere Vorschauen verkleinert der Bot automatisch). Für längere Videos einen lokalen
[Bot-API-Server](https://github.com/tdlib/telegram-bot-api) auf dem Pi betreiben – dann gehen bis 2 GB:

1. Auf [my.telegram.org](https://my.telegram.org) → *API development tools* → `api_id` und `api_hash` holen.
2. Server per Docker starten:
   ```bash
   sudo mkdir -p /var/lib/telegram-bot-api
   docker run -d --name telegram-bot-api --restart unless-stopped \
     -p 8081:8081 \
     -e TELEGRAM_API_ID=… -e TELEGRAM_API_HASH=… -e TELEGRAM_LOCAL=1 \
     -v /var/lib/telegram-bot-api:/var/lib/telegram-bot-api \
     aiogram/telegram-bot-api:latest
   sudo chmod -R a+rX /var/lib/telegram-bot-api
   ```
   Der Ordner muss auf dem Pi unter demselben Pfad liegen wie im Container – der Bot liest die Videos direkt von dort.
3. Den Bot einmal beim offiziellen Server abmelden:
   `curl https://api.telegram.org/bot<TOKEN>/logOut`
4. In `.env`: `TELEGRAM_API_URL=http://localhost:8081` und den Bot neu starten.

## Anpassen

- **Layout:** Logo (`assets/logo.png`), Position, Größe, Schrift, Farben und Untertitel-Stil (`rand` oder `box`) in `.env`.
  Untertitel werden für Hochkant- und Querformat automatisch passend groß gesetzt.
- **Glossar:** `glossar.txt` – Namen, die Whisper richtig schreiben soll, und automatische Ersetzungen.
- **Netzwerk-Einstellungen:** `kanaele.example.json` nach `kanaele.json` kopieren. Schlüssel ist der Netzwerk-Typ
  (`instagram`, `tiktok`, `youtube`, …) oder eine Kanal-ID aus `/kanaele`. Die Werte gehen als `settings` an Postiz.
- **Caption-Stil:** `CAPTION_STIL` und `CAPTION_HASHTAGS` in `.env`; der Grundtext steht in `src/caption.mjs`.

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/bot.mjs` | Telegram-Steuerung, Menüs, Warteschlange, Alben sammeln |
| `src/video.mjs` | ffprobe/ffmpeg: Video untersuchen, Ton herauslösen, Logo + Untertitel einbrennen, Fotos mit Logo |
| `src/whisper.mjs` | Spracherkennung mit whisper.cpp, Glossar |
| `src/untertitel.mjs` | SRT lesen/schreiben, Korrekturen, Umbruch, ASS-Gestaltung |
| `src/caption.mjs` | Caption-Vorschlag aus Transkript, Fotos oder Stichpunkten (Claude oder einfacher Vorschlag) |
| `src/postiz.mjs` | Postiz Public API: Kanäle, Upload, Beitrag anlegen; welche Netzwerke welche Beiträge nehmen |
| `src/zeit.mjs` | Zeitangaben wie „morgen 18 Uhr“ verstehen |
| `src/auftraege.mjs` | Stand je Video in `daten/auftraege.json`; fertige Aufträge werden nach 14 Tagen gelöscht |

Tests: `npm test`

# Stadtrat Social-Media-Bot

Telegram-Bot für den Raspberry Pi: Video, Fotos oder Text reinschicken → Vorschau mit Logo, Untertiteln und
Caption-Vorschlag zurück → anpassen → mit **Ja** sofort oder zu einer bestimmten Zeit über [Postiz](https://postiz.com) posten.
Alles läuft lokal, Postiz ist selbst gehostet. Nur wenn ein KI-Schlüssel eingetragen ist (Claude oder OpenAI),
gehen Transkript, Fotos bzw. Text für den Caption-Vorschlag an den jeweiligen Anbieter.

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
| 👤 Kunde | Postiz-Kunde wählen, z. B. „Lukas Küffner“ – danach sind dessen Kanäle vorausgewählt (Standard: `POSTIZ_KUNDE`) |
| 📺 Kanäle | Kanäle des gewählten Kunden an-/abwählen |
| 🤝 Collab | Instagram-Collab-Partner (bis zu 3), z. B. `@piraten_nuernberg` – erscheint, wenn ein Instagram-Kanal gewählt ist |
| 🔁 Repost | andere X- bzw. LinkedIn-Konten teilen den Beitrag nach dem Erscheinen, sofort oder verzögert (Postiz-„Re-poster“) |
| 🗑️ Verwerfen | Vorschlag löschen |

Kunden ordnest du in Postiz den Kanälen zu; der Bot liest sie von dort, eine eigene Liste gibt es nicht.
Reposts kann Postiz nur auf X und LinkedIn – bei Instagram, Facebook, TikTok usw. gibt es dafür keine Schnittstelle.

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
2. In deinem Postiz: **Einstellungen → Developers → Public API** → API-Key kopieren.
3. Adresse für `POSTIZ_URL`: der Wert von `NEXT_PUBLIC_BACKEND_URL` aus deiner Postiz-Konfiguration
   (`docker-compose.yml` bzw. `.env` von Postiz). Beim Standard-Setup ist das die Postiz-Adresse mit `/api`
   dahinter, z. B. `http://localhost:5000/api`, wenn Postiz auf demselben Pi läuft.

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
Dann `/status` schicken: zeigt, ob Postiz, ffmpeg, Whisper und die KI erreichbar sind. `/kanaele` listet die Kanäle
nach Kunden mit ihren IDs.

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
  Für Pinterest ist dort die Board-ID Pflicht.
- **Caption-KI:** `ANTHROPIC_API_KEY` oder `OPENAI_API_KEY` eintragen; bei beiden entscheidet `CAPTION_ANBIETER`.
  Mit `OPENAI_BASE_URL` geht auch ein OpenAI-kompatibler Dienst, etwa ein lokales Modell über Ollama.
- **Caption-Stil:** `CAPTION_STIL` und `CAPTION_HASHTAGS` in `.env`; der Grundtext steht in `src/caption.mjs`.

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/bot.mjs` | Telegram-Steuerung, Menüs, Warteschlange, Alben sammeln |
| `src/video.mjs` | ffprobe/ffmpeg: Video untersuchen, Ton herauslösen, Logo + Untertitel einbrennen, Fotos mit Logo |
| `src/whisper.mjs` | Spracherkennung mit whisper.cpp, Glossar |
| `src/untertitel.mjs` | SRT lesen/schreiben, Korrekturen, Umbruch, ASS-Gestaltung |
| `src/caption.mjs` | Caption-Vorschlag aus Transkript, Fotos oder Stichpunkten (Claude, OpenAI oder einfacher Vorschlag) |
| `src/postiz.mjs` | Postiz Public API: Kanäle, Kunden, Upload, Beitrag anlegen; Einstellungen je Netzwerk, Collab, Repost |
| `src/zeit.mjs` | Zeitangaben wie „morgen 18 Uhr“ verstehen |
| `src/auftraege.mjs` | Stand je Video in `daten/auftraege.json`; fertige Aufträge werden nach 14 Tagen gelöscht |

Tests: `npm test`

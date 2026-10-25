# Stadtrat Social-Media-Bot

Telegram-Bot für den Raspberry Pi: Video, Fotos oder Text reinschicken → Vorschau mit Logo, Untertiteln und
Caption-Vorschlag zurück → anpassen → mit **Ja** sofort oder zu einer bestimmten Zeit über [Postiz](https://postiz.com) posten.
Alles läuft lokal, Postiz ist selbst gehostet. Nur wenn ein KI-Schlüssel eingetragen ist (Claude oder OpenAI),
gehen Transkript, Fotos bzw. Text für den Caption-Vorschlag an den jeweiligen Anbieter.

## Lokal und ohne externen KI-API-Key

Der Redaktionsassistent funktioniert **ohne `ANTHROPIC_API_KEY` oder `OPENAI_API_KEY`**:
- `/idee Ein Gedanke`: bleibt lokal in `daten/ideen.json`; `/ideen` öffnet gespeicherte Ideen erneut.
- Text (oder eine Telegram-Sprachnachricht) schicken → Textvorschau → **Sharepic**, **Storygrafik** oder **Idee speichern**. Sprache wird mit dem bereits installierten whisper.cpp erkannt. Sprachnachrichten sind auf vier Minuten begrenzt.
- Ein digitales PDF mit einem Antrag schicken → **belegte Textstellen** auswählen, selbst korrigieren, als Grafik oder Post veröffentlichen. Für PDFs ist `pdftotext` aus `poppler-utils` nötig; Installations- und Update-Skript installieren das Paket. Scans ohne Textebene können nicht gelesen werden, es gibt keine OCR.
- Keine unbelegten Behauptungen zu Antragsstatus oder politischen Entscheidungen. Die vorgeschlagenen Passagen sind **keine KI-Zusammenfassungen**, sondern dokumentgetreue (teilweise mit […] gekürzte) Auszüge. Vor Veröffentlichung immer Kontext und Fakten prüfen.
- Für frei formulierte, intelligentere Texte kann die bisherige optionale Caption-KI weiter verwendet werden; sie ist für die neuen Funktionen nicht erforderlich.

## Ablauf in Telegram

### Entwürfe, Archiv und Quellen

- `/entwuerfe` zeigt alle noch offenen Entwürfe dieses Chats, mit Seiten zum Weiterblättern.
  Antippen öffnet den vollständigen gespeicherten Stand: Medien, Kunde, Kanäle, Kanaltexte und Quellenkarte.
- **🗃️ Archivieren** legt einen Entwurf dauerhaft beiseite. `/archiv` stellt ihn durch Antippen wieder her.
  Archivierte Entwürfe samt Medien werden nicht nach 14 Tagen entfernt; sie belegen weiterhin Speicherplatz.
  Zum späteren Entfernen wiederherstellen und **Verwerfen** wählen (danach gilt die normale Bereinigung).
- **↶ Text zurück** nimmt die letzte Änderung an Caption, Kanaltexten oder Quellenkarte zurück,
  bis zu zehn Versionen, auch nach einem Neustart. Grafiktext, Untertitel und gerenderte Medien sind davon
  unabhängig und werden nicht zurückgerendert. Vorhandene Grafiken weiterhin über **Grafiktext** bearbeiten.
- **📚 Quelle / Stand** hält Titel, Dokumentdatum, Aktenzeichen, Quellenlink, Verfahrensstand und dessen Beleg fest.
  Vorlage bearbeiten und als Nachricht zurückschicken; Datum als `JJJJ-MM-TT`, `-` leert ein Feld.
  Ein Stand außer `ungeprüft` braucht **Standdatum und Beleg**. Das ist eine manuelle Bestätigung,
  keine automatische Faktenprüfung. Die Quellenkarte wird nicht automatisch in Caption oder Grafik geschrieben.
- Neue Antrags-PDFs erhalten Dateiname und SHA-256 der Originaldatei. Auszüge zeigen, soweit eindeutig
  zuordenbar, die PDF-Seiten ab 1 (nicht die aufgedruckten Seitenzahlen, weiterhin maximal 15 Seiten).
  Bei älteren Entwürfen können Metadaten manuell ergänzt werden.
- **Wiedervorlage** ist vorerst eine Datumsnotiz in der Quellenkarte; es gibt keine automatische Erinnerung.

Die Entwurfsliste und das Archiv sind pro Telegram-Chat gemeinsam. Der Ideenspeicher bleibt ein einfacher
Textspeicher; für einen vollständigen Stand mit Medien und Quellen bitte das Archiv verwenden.
Die Speicherung bleibt lokal im bestehenden JSON-Format, ohne neue Dienste oder Datenbankinstallation.

Was du schickst, bestimmt die Art des Beitrags:

| Eingabe | Was der Bot macht |
|---|---|
| **Video** – am besten **als Datei** (📎 → Datei), sonst komprimiert Telegram es | Sprache erkennen (whisper.cpp), Logo und Untertitel einbrennen, Caption aus dem Gesagten vorschlagen |
| **Foto** oder **Album** (bis 10 Fotos = Karussell) | Logo draufsetzen, auf max. 2048 px verkleinern. Text in der Bildunterschrift wird die Caption; ohne Text schlägt Claude eine vor (sieht sich dafür die Fotos an), ohne Claude gibt es nur die Hashtags |
| **Text** | wird unverändert zum Textbeitrag; mit „🖼️ Sharepic“ oder „📱 Storygrafik“ entsteht eine lokale Grafik – ohne KI-Schlüssel |
| **Telegram-Sprachnachricht** | wird mit dem bestehenden lokalen whisper.cpp transkribiert → bearbeitbarer Textentwurf, Sharepic, Story oder Idee |
| **Antrags-PDF** (mit auswählbarem Text) | erste 15 Seiten mit lokalem pdftotext auslesen → Originaltitel, Beschlussvorschlag und Begründung als überprüfbare Textauszüge; keine erfundenen Zusammenfassungen |

Danach kommt die Vorschau, darunter die Caption mit Knöpfen:

| Knopf | Was passiert |
|---|---|
| ✅ Jetzt posten | fragt nach („Wirklich jetzt auf … posten?“) und postet nach **Ja** |
| 🕐 Planen | Heute/Morgen-Vorschläge, nächster freier Postiz-Slot oder freie Eingabe wie `Fr 18 Uhr`, `24.10. 19:30`, `in 2 Stunden` |
| ✏️ Caption ändern | schickt den aktuellen Text zum Kopieren, die nächste Nachricht ist die neue Caption |
| 🖼️ Sharepic / 📱 Storygrafik | bei Textentwürfen: eine fertige JPEG-Grafik in 4:5 oder 9:16 erzeugen, mit Logo und Inter; Text wird für das Motiv ggf. sichtbar gekürzt |
| 🎞️ Animation / Story-Animation | Textgrafik in eine kurze 5-Sekunden-MP4 mit sanftem Fade-in und leichtem Zoom umwandeln; ohne Cloud-KI und Ton |
| 🏷️ Textgrafik-Logo | Standardmäßig ohne Logo-Karte direkt auf dem Hintergrund; der Renderer unterstützt optional weiterhin den Kartenmodus |
| ✏️ Grafiktext | Text des Sharepics oder der Storygrafik bearbeiten und neue Vorschau bauen |
| 💾 Idee speichern | den Text lokal dauerhaft ablegen; mit `/ideen` wieder aufrufen |
| 📄 Andere Antragspassage | ausschließlich bei PDF-Entwürfen: im Dokument gefundenen Titel, Beschlussvorschlag oder Auszug auswählen |
| 🔄 Neu formulieren | nur mit Claude: Wunsch eingeben (`kürzer`, `lockerer`, …) |
| 📍 Position | nur Video: Untertitel oben, in der Mitte oder unten (Standard) – das Video wird neu gebaut. Verdecken sie unten dein Gesicht, legt der Bot sie schon selbst woanders hin |
| 🪪 Bauchbinde | nur Video: Name und Funktion am Anfang einblenden – Standard aus `BAUCHBINDE_NAME`/`_FUNKTION` oder ein anderer Name, z. B. für Gäste |
| 📝 Untertitel | nur Video: schickt alle Untertitel als nummerierte Liste. Kopieren, Fehler ändern, zurückschicken – geändert wird genau der Untertitel mit dieser Nummer, die Zeit bleibt (auch nur einzelne Zeilen wie `4 Ob das klappt?`; `4 -` löscht). `falsch => richtig` ohne Nummer ersetzt überall, alternativ eine .srt-Datei. Das Video wird danach neu gebaut |
| 🏷️ Logo drauf / entfernen | nur Fotos: Logo pro Beitrag an- oder abschalten (Standard: `LOGO_AUF_FOTOS`) |
| 👤 Kunde | Postiz-Kunde wählen, z. B. „Lukas Küffner“ – danach sind dessen Kanäle vorausgewählt (Standard: `POSTIZ_KUNDE`) |
| 📺 Kanäle | Kanäle des gewählten Kunden an-/abwählen |
| ✂️ Pro Kanal | eigener Text je Kanal (siehe unten) |
| 🤝 Collab | Instagram-Collab-Partner (bis zu 3), z. B. `@piraten_nuernberg` – erscheint, wenn ein Instagram-Kanal gewählt ist |
| 🔁 Repost | andere X- bzw. LinkedIn-Konten teilen den Beitrag nach dem Erscheinen, sofort oder verzögert (Postiz-„Re-poster“) |
| 📱 Story | Foto/Video zusätzlich als Story auf Instagram und Facebook (erstes Bild bzw. das Video); was nicht 9:16 ist, bekommt eine eigene Story-Fassung mit Vorschau |
| 📱 Nur Story | **Ausschließlich eine Story** auf Instagram/Facebook, kein Feed-Post; vorhandene Kanalauswahl wird beim Verlassen des Modus wiederhergestellt |
| ✏️ Text ins Bild | Bei Fotostorys optional einen kurzen Text schicken: wird in der 9:16-Fassung auf einer dunklen Karte eingebrannt; mit Vorschau, maximal sechs Zeilen, `-` zum Entfernen |
| 🖼️ Story-Layout | Fotostory: Logo automatisch auf freie unscharfe Flächen setzen oder eine Position auswählen; auch Position des Bildtexts ändern. Sicherheitsabstände haben immer Vorrang |
| 📲 9:16 für Insta | nur Querformat-Videos: Instagram (als Reel) und TikTok bekommen dieselbe 9:16-Fassung wie die Story, X, Facebook, LinkedIn, YouTube usw. das Querformat (Standard: `HOCHKANT_STANDARD`) |
| 🗑️ Verwerfen | Vorschlag löschen |

### Texte pro Kanal

Der Vorschlag ist der **Haupttext**; er gilt für alle Kanäle ohne eigene Fassung. Unter **✂️ Pro Kanal** steht jeder
gewählte Kanal mit seiner Zeichenzahl, z. B. `⚠️ X Lukas · 372/280`. Dort kannst du

- **🤖 Alle per KI anpassen** – eine eigene Fassung je Netzwerk, passend zu Länge und Ton (X kurz und pointiert,
  LinkedIn sachlich, Instagram persönlich …). Mehrere Konten desselben Netzwerks bekommen denselben Text.
- **✂️ Zu lange automatisch kürzen** – ohne KI: schneidet am Satzende, die Hashtag-Zeile bleibt.
- einen Kanal antippen: Text ansehen, **eigenen Text schreiben**, KI-Fassung nur für dieses Netzwerk, kürzen oder
  **zurück zum Haupttext**.

Ist ein Text zu lang, lässt der Bot nicht posten. Ändert sich der Haupttext, werden die Fassungen pro Kanal
zurückgesetzt. Limits: X 280, Bluesky 300, Mastodon/Threads 500, Instagram/TikTok 2200, LinkedIn 3000 usw. – mit
`maxZeichen` in `kanaele.json` änderbar, etwa für X Premium (`25000`) oder eine Mastodon-Instanz mit höherem Limit.
Gezählt wird genau wie in Postiz: X über twitter-text (Emojis doppelt, Links 23), Threads in Bytes (Umlaute 2,
Emojis 4), alle anderen in JavaScript-Zeichen (ein Emoji meist 2).

### Nach dem Posten

Feed und zusätzliche Story werden einzeln bestätigt und ihre Post-IDs sofort gespeichert.
Scheitert danach die Story, bietet der Bot **Fehlende Teile erneut versuchen** an und lässt den Feed aus.
Während einer begonnenen Veröffentlichung sind Änderungen an Inhalt und Kanälen gesperrt.
Bestätigte Teilbeiträge werden auch bei einem noch offenen Auftrag auf Veröffentlichung kontrolliert.

Bei einem Verbindungsabbruch, Serverfehler oder einer unvollständigen Antwort kann Postiz bereits etwas
angelegt haben. Der Bot speichert diesen Teilschritt vor der Anfrage und sperrt Wiederholungen, auch nach
einem Neustart. Unter **In Postiz prüfen** erst den Kalender kontrollieren:
- **Unklarer Teil fehlt sicher** bestätigt deine Prüfung und schaltet einen bewussten neuen Versuch frei.
- **Ist vorhanden / extern erledigt** beendet den Auftrag im Bot. Fehlende Teile dort vorher manuell
  fertigstellen; für unbekannte Post-IDs gibt es keine automatische Veröffentlichungskontrolle.

Der Schutz verhindert blindes Wiederholen; er ersetzt keine serverseitige Idempotenz bei Postiz.
Eindeutige API-Ablehnungen (z. B. Validierungsfehler oder Ratenlimit) können erneut versucht werden.

Postiz veröffentlicht im Hintergrund. Hängt dort etwas (oft der Orchestrator nach einem Neustart) oder lehnt ein
Netzwerk ab, bleibt das sonst unbemerkt. Der Bot schaut deshalb 15 Minuten nach jedem Termin in Postiz nach und
meldet sich **einmal pro Post oder Story auch bei Erfolg**, sobald Postiz den Status `PUBLISHED` bestätigt. Bei Fehlern meldet er Kanal, Termin und Grund; wird der Beitrag später nachgeholt, folgt eine Bestätigung.
Hängen alle Posts: `docker exec postiz pm2 list`, im Zweifel `docker restart postiz`.

Postiz erlaubt standardmäßig **30 API-Anfragen pro Stunde** (`API_LIMIT` in der Postiz-Konfiguration). Ein Beitrag
braucht eine Anfrage pro Datei plus eine für den Post (plus eine für die Story). Der Bot zählt mit
(`POSTIZ_MAX_ANFRAGEN`, Standard 28) und sagt vor dem Posten, ab wann es wieder geht.

### Mastodon direkt

Postiz postet auf Mastodon immer **öffentlich** und ohne Inhaltswarnung. Viele Instanzen erwarten bei politischen
Accounts aber „ungelistet“ und Inhaltswarnungen. Mit `MASTODON_URL` und `MASTODON_TOKEN` postet der Bot selbst:

1. Auf der Instanz: Einstellungen → Entwicklung → Neue Anwendung, Berechtigungen `read:accounts`, `write:media`,
   `write:statuses`. Den Zugriffstoken als `MASTODON_TOKEN` eintragen.
2. `MASTODON_SICHTBARKEIT` (`unlisted`, `public`, `private`) und `MASTODON_INHALTSWARNUNG` (z. B.
   `Kommunalpolitik`, leer = keine) nach Wunsch.

Der Kanal erscheint dann als „Mastodon @name“ beim Standard-Kunden; Mastodon-Kanäle in Postiz werden ausgeblendet,
sonst käme alles doppelt. Die Inhaltswarnung zählt zum 500-Zeichen-Limit. Mastodon nimmt bis zu 4 Bilder oder ein
Video; geplante Posts plant Mastodon selbst ein (zu finden unter „Geplante Beiträge“ in Mastodon, nicht in Postiz).

### Im Team über eine Gruppe

Statt einzelner Personen kann eine Telegram-Gruppe freigegeben werden – dann können alle darin Videos schicken und
freigeben. Bot in die Gruppe holen, bei @BotFather `/setprivacy` → Bot wählen → **Disable** (sonst sieht der Bot in
Gruppen keine Videos und Texte), in der Gruppe `/id` schicken und die (negative) Gruppen-ID in `ERLAUBTE_NUTZER`
eintragen. Fremden antwortet der Bot in Gruppen nicht.

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
3. Adresse für `POSTIZ_URL`: die Adresse deiner Postiz-Instanz, mit oder ohne `/api` – z. B.
   `http://localhost:5000`, wenn Postiz auf demselben Pi läuft. Die API liegt unter `/api/public/v1`.

### 4. Bot installieren

```bash
cd ~
git clone https://github.com/vwt1812-glitch/stadtrat-social-bot.git
cd stadtrat-social-bot
bash pi/install.sh             # Pakete, Node.js, whisper.cpp samt Modell, .env, Dienst
nano .env                      # Telegram-Token, Postiz-Adresse und API-Key eintragen
sudo systemctl start social-bot
```

`pi/install.sh` erledigt die Schritte 1 und 2 von oben gleich mit (Modell wählbar:
`WHISPER_GROESSE=base bash pi/install.sh`) und trägt die Whisper-Pfade in die `.env` ein.

Dem Bot in Telegram `/id` schreiben – er antwortet mit deiner ID. Die in `ERLAUBTE_NUTZER` eintragen und neu
starten. Dann `/status` schicken: zeigt, ob Postiz, ffmpeg, Whisper, Mastodon und die KI erreichbar sind und wie
viele Postiz-Anfragen in der letzten Stunde verbraucht sind. `/kanaele` listet die Kanäle nach Kunden mit ihren IDs.

### 5. Betrieb

| Befehl | |
|---|---|
| `journalctl -u social-bot -f` | Protokoll ansehen |
| `sudo systemctl restart social-bot` | neu starten, z. B. nach Änderungen an der `.env` |
| `bash pi/aktualisieren.sh` | neuen Code von GitHub holen und neu starten |

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

- **Layout:** Das Logo sitzt auf einer dunklen, abgerundeten Karte in Logo-Schwarz mit weichem Schatten und
  oranger Linie (`LOGO_STIL=karte`), oben links mit Abstand zu den Bedienelementen von Reels und TikTok. Die
  Bauchbinde (`BAUCHBINDE_STIL=balken`) ist ein schräger oranger Balken mit dem Namen und davor ein schwarzer mit
  der Funktion, unten links unter den Untertiteln; sie wischt nach `BAUCHBINDE_START` Sekunden mit weißer Kante
  herein und ist samt Auswischen `BAUCHBINDE_DAUER` Sekunden zu sehen. Mit `BAUCHBINDE_STIL=karte` nimmt sie
  stattdessen dieselbe Karte wie das Logo. Logo, Farben, Position und Größe in `.env`. Die offiziellen Logos
  liegen als SVG und PNG in `assets/logos/` (`quer-dunkel` für dunkle Flächen, `quer-hell` für helle), die Schrift
  Inter (SIL Open Font License) in `assets/fonts/`. Untertitel werden für Hochkant und Querformat passend gesetzt,
  Stil `rand` oder `box`, als kurze einzeilige Häppchen, möglichst nach Satzzeichen getrennt
  (`UNTERTITEL_ZEILEN=2` für bis zu zwei Zeilen).
- **Bedienelemente von TikTok und Reels:** Hochkant blenden die Apps oben Reiter und Kamera ein (gut 10 %),
  unten Name, Caption und Ton (gut 20 %) und rechts eine Knopfleiste (Like, Kommentar, Teilen). Das Logo beginnt
  daher bei 14 % der Höhe, die Bauchbinde endet bei 76 %, Untertitel stehen mit `UNTERTITEL_POSITION=0.33` darüber
  und sind höchstens 24 Zeichen breit. Querformat hat eigene Untertitel unten (`UNTERTITEL_POSITION_QUER=0.08`).
  Verdecken die Untertitel etwas, im Menü unter **📍 Position** pro Video oben, Mitte oder unten wählen.
- **Gesicht:** Bei Hochkant-Videos sucht der Bot in 12 Bildern dein Gesicht (OpenCV, lokal auf dem Pi, ein paar
  Sekunden) und legt die Untertitel dorthin, wo sie es nicht verdecken – bevorzugt unten, sonst oben, sonst in
  der Mitte. Im Menü steht dann „automatisch“; **📍 Position** überschreibt das. Füllt das Gesicht fast das ganze
  Bild oder reicht der Kopf ins Logo, gibt es einen 💡-Tipp für die nächste Aufnahme. `pi/install.sh` richtet
  dafür Python mit OpenCV in `.venv` ein; fehlt es, bleibt die Gesichtssuche einfach aus.
- **Storys:** Instagram und Facebook zeigen oben Fortschrittsbalken und Profil, unten Antworten/Interaktionen.
  Der Bot nutzt dafür konservative Sicherheitsbereiche (oben 14 %, unten 20 %); für Reels/TikTok oben 14 %,
  unten 35 % und rechts 16 %. Das sind Näherungen, die App-Oberflächen können sich ändern.
  Für Fotos und nicht-9:16-Videos baut der Bot eine 1080×1920-Fassung mit unscharfem Hintergrund.
  Fotos werden **direkt aus dem Original** bearbeitet: erst Hintergrund und scharfes Bild, dann das Logo,
  damit es nicht in den unscharfen Hintergrund eingebrannt ist. Das Logo landet bevorzugt auf einer ausreichend
  großen freien unscharfen Fläche; falls keine passt, in einer freien Ecke innerhalb der Sicherheitsbereiche.
  **🖼️ Story-Layout** erlaubt bei Fotos die Positionen automatisch, oben/unten links, mittig oder rechts und
  eine Position für Bildtext. Text wird bevorzugt auf freien Flächen platziert, ohne das Logo zu überdecken.
  In Videos können erkannte Gesichter die Logoposition beeinflussen (auch nach Umrechnung eines Querformats
  auf 9:16). Bei einem Querformatvideo stehen Untertitel nach Möglichkeit unter dem scharfen Bild,
  Bauchbinden bleiben möglichst im Bild. Die eigene Story-Fassung wird beim Posten extra hochgeladen.
- **Querformat für Instagram/TikTok:** Ein Querformat-Video erscheint in Reels und TikTok sonst klein mit Balken.
  Mit **📲 9:16 für Insta** bekommen die Netzwerke aus `HOCHKANT_NETZE` (Standard Instagram und TikTok) die
  9:16-Fassung, alle anderen weiter das Querformat. Story und Reel teilen sich die Datei – ein Upload mehr, nicht
  zwei. `HOCHKANT_STANDARD=ja` schaltet das für jedes Querformat-Video gleich ein.
- **Glossar:** `glossar.txt` – Namen, die Whisper richtig schreiben soll, und automatische Ersetzungen.
- **Netzwerk-Einstellungen:** `kanaele.example.json` nach `kanaele.json` kopieren. Schlüssel ist der Netzwerk-Typ
  (`instagram`, `tiktok`, `youtube`, …) oder eine Kanal-ID aus `/kanaele`. Die Werte gehen als `settings` an Postiz.
  Für Pinterest ist dort die Board-ID Pflicht. `maxZeichen` setzt das Zeichenlimit für den Kanal (geht nicht an Postiz).
- **Caption-KI:** `ANTHROPIC_API_KEY` oder `OPENAI_API_KEY` eintragen; bei beiden entscheidet `CAPTION_ANBIETER`.
  Mit `OPENAI_BASE_URL` geht auch ein OpenAI-kompatibler Dienst, etwa ein lokales Modell über Ollama.
- **Caption-Stil:** `CAPTION_STIL` und `CAPTION_HASHTAGS` in `.env`; der Grundtext steht in `src/caption.mjs`.

## Aufbau

| Datei | Inhalt |
|---|---|
| `src/bot.mjs` | Telegram-Steuerung, Menüs, Warteschlange, Alben sammeln |
| `src/video.mjs` | ffprobe/ffmpeg: Video untersuchen, Ton herauslösen, Logo-Karte, Bauchbinde und Untertitel einbrennen, Fotos mit Logo |
| `src/whisper.mjs` | Spracherkennung mit whisper.cpp, Glossar |
| `src/untertitel.mjs` | SRT lesen/schreiben, Korrekturen, Umbruch, ASS-Gestaltung |
| `src/caption.mjs` | Caption-Vorschlag aus Transkript, Fotos oder Stichpunkten (Claude, OpenAI oder einfacher Vorschlag) |
| `src/postiz.mjs` | Postiz Public API: Kanäle, Kunden, Upload, Beitrag und Story anlegen; Einstellungen je Netzwerk, Collab, Repost, Zeichenzählung, Anfragenlimit |
| `src/kontrolle.mjs` | prüft nach dem Termin, ob Postiz veröffentlicht hat |
| `src/mastodon.mjs` | Mastodon direkt (ungelistet, Inhaltswarnung) |
| `pi/` | Installation, Update und Dienst für den Raspberry Pi |
| `src/zeit.mjs` | Zeitangaben wie „morgen 18 Uhr“ verstehen |
| `src/auftraege.mjs` | Stand je Video in `daten/auftraege.json`; fertige Aufträge werden nach 14 Tagen gelöscht |
| `src/quellen.mjs` | Quellenkarte, manuell belegter Verfahrensstand und Datumseingaben |

Tests: `npm test`

Kontrolle nach dem Posten, Mastodon direkt, Zählweise, Kanalauswahl per Name, Anfragenlimit und die
Pi-Skripte stammen aus [eu-piraten-abstimmungen](https://github.com/vwt1812-glitch/eu-piraten-abstimmungen).

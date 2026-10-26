# Videocover: Größen, Übergabe und Grenzen

Stand der Recherche: 26.10.2026. Dokumentation und aktueller Postiz-Quellcode wurden geprüft,
keine echten Accounts oder die installierte Postiz-Instanz. Die Größen unten sind Ausgabeprofile
des Bots; Empfehlungen sind keine vorgeschriebenen Mindestgrößen.

| Ziel | Bot-Ausgabe | Automatische Übergabe |
|---|---|---|
| Instagram Reel | JPEG 1080×1920, 9:16, max. 2 MiB | `image[0].thumbnail` als öffentlich abrufbare Bildadresse; Postiz setzt `cover_url` |
| Raster-Vorschau | JPEG 1080×1440, 3:4, max. 2 MiB | Nur Vorschau/Export, niemals automatisch als Plattformcover übertragen |
| Feed-Vorschau | JPEG 1080×1350, 4:5, max. 2 MiB | Nur Vorschau/Export, niemals automatisch als Plattformcover übertragen |
| YouTube Video | JPEG 3840×2160, 16:9, max. 2 MiB | `settings.thumbnail` und Videomedium; verifizierter Kanal mit Thumbnail-Freischaltung nötig |
| YouTube Short | JPEG 2160×3840, 9:16, max. 2 MiB | Vorerst nur Datei-Export für Studio am Computer; API-Übernahme nicht mit einem echten Short bestätigt |
| Mastodon über Postiz | JPEG im Video-Seitenverhältnis, längste Seite 1920 px, max. 2 MiB | Nur mit angepasstem Postiz-Provider; Standard-Provider ignoriert das Cover |
| TikTok regulär | Framezeit in Millisekunden | Nur öffentlicher Direct Post; kein separates Bildcover und kein Inbox-Upload |
| TikTok Business-Anschluss | JPEG 1080×1920, max. 2 MiB | Separater Business-Provider mit `custom_thumbnail_url`, nicht allein durch ein TikTok-Businesskonto freigeschaltet |
| Facebook, X, Bluesky | JPEG im Video-Seitenverhältnis, längste Seite 1920 px, max. 2 MiB | Nur Export; keine unbestätigten Coverfelder an diese Provider schicken |

JPEGs werden auf die exakten Ausgabemaße gebracht, ohne das Motiv zu verzerren oder abzuschneiden:
abweichende Seitenverhältnisse erhalten dunkle Ränder. Schrift, Farben, Logo und die Textanordnung
werden aus dem bestehenden Grafik-/Storyrenderer wiederverwendet; Querformat hat eine eigene Geometrie.
Originalvideo, Caption und Untertitel werden nicht durch Covertext verändert.

**YouTube:** Die aktuelle Hilfe empfiehlt 3840×2160 für Videos und 2160×3840 für Shorts. Mindestbreite
bei Videos beziehungsweise Mindesthöhe bei Shorts: 640 px. Die Uploadgrenzen unterscheiden sich
zwischen Oberfläche und API; `thumbnails.set` akzeptiert laut aktueller API-Dokumentation bis 50 MB.
Die eigene 2-MiB-Grenze ist bewusst konservativer. Shorts-Cover sind laut Hilfe in Studio am Computer
verfügbar; die Anzeige kann je Oberfläche variieren. Der Bot behauptet dafür keine bestätigte API-Übernahme.

**Instagram:** Die API unterstützt Reelcover per Bildadresse oder Framezeit. Die 1080×1920-Ausgabe
ist unser 9:16-Arbeitsprofil, keine vorgeschriebene Mindestauflösung. Die oft zitierte Angabe
420×654 px konnte beim erneuten Abruf nicht direkt bestätigt werden und ist keine Grundlage für
unser API-Ausgabeprofil. Die Meta-Seiten waren beim erneuten Abruf am 26.10.2026 mit HTTP 429 gesperrt; die dortigen
Detailangaben konnten deshalb nicht erneut direkt bestätigt werden.
Die 2-MiB-Grenze ist ein eigener Arbeitswert, kein behauptetes API-Maximum.

**TikTok:** Die reguläre Direct-Post-API wählt das Cover per `video_cover_timestamp_ms` aus dem
Video. Sie schreibt dafür keine separate JPEG-Pixelgröße vor. Die Videoübertragung erlaubt laut
Media Transfer Guide 360 bis 4096 px je Achse; das sind Videogrenzen, keine Coverempfehlung.
1080×1920 bleibt das eigene 9:16-Arbeitsprofil für Bildexport/Business-Anschluss. Die reguläre
TikTok-Veröffentlichung übernimmt daraus weiterhin kein separates gestaltetes Bildcover.

### Reine Textcover auf dem Handy

Hochkant-Cover verwenden eine eigene Standbildvorlage, nicht mehr die Storygrafik. Die Titelgröße
liegt bei 118–186 px auf dem 1080-px-Arbeitsmotiv statt bisher höchstens 102 px. Ist der Titel zu lang,
wird eine Kürzung verlangt statt ihn für das Handy unlesbar klein zu setzen. Die kleinteilige Kopfzeile
entfällt, Erklärungstext hat höchstens drei Zeilen. Text und Logo liegen zusammen innerhalb von
y=460 bis y=1460: Damit bleiben sie auch in einem mittigen quadratischen Ausschnitt (y=420 bis 1500)
erhalten. Das ist unsere defensive Gestaltung, keine Zusage über jede Plattformansicht oder einen
manuell verschobenen Zuschnitt. Bei 3:4 und 4:5 bleibt dieser Bereich ebenfalls sichtbar.
Die Ausgabe bleibt 1080×1920 px; YouTube Shorts erhält denselben Aufbau mit 2160×3840 px.
Mehr Pixel ändern die Schriftgröße in einer kleinen Handy-Kachel nicht. Entscheidend sind große
Schrift und kurze Aussagen. Quercover und reguläre Storygrafiken behalten ihre bisherigen Vorlagen.

**Mastodon:** Es gibt keine universelle vorgeschriebene Thumbnail-Pixelgröße. Instanzgrenzen und Verarbeitung
bleiben maßgeblich; das API-Feld ist `thumbnail` als Multipart-Datei. Der untersuchte Postiz-Provider lädt
nur Video und Alttext hoch. Einfach `thumbnail` an die Public API zu hängen aktiviert diese Fähigkeit nicht.

**Facebook:** Das Meta-SDK kennt `thumb` für `POST /{page}/videos`; Postiz sendet dort bisher kein Cover.
Das ist keine bestätigte Unterstützung für alle Facebook-Reels. Daher bleibt es hier beim Export.
**Bluesky:** `thumbnail` steht im Ausgabeobjekt `view`, nicht im Videoobjekt zum Veröffentlichen.
**X:** Eine verlässliche Coversteuerung ist im geprüften Postiz-Anschluss nicht vorhanden. Media Studio
kann, je nach Kontozugang, den manuellen Abschluss übernehmen. Ein Titelbild am Videoanfang erzwingt
bei diesen Plattformen keine bestimmte automatisch ausgewählte Vorschau.

## Bedienung

### Zusätzliches Quercover und Fotovorlage

Nach der ersten Coverauswahl erzeugt **Querdatei zusätzlich erstellen** unabhängig von der Orientierung des
Videos eine weitere Datei in **1920×1080 px (16:9)**. Sie wird exportiert; die automatische
Plattformzuordnung bleibt bestehen (z. B. Hochkant für Instagram, eigenes YouTube-Profil für YouTube).
Ein Quercover macht das veröffentlichte Video nicht automatisch zum Querformat. Gleich große
Ausgaben von „original“ und „hochkant“ werden in Telegram-Vorschau und Download nur einmal gezeigt;
intern bleiben beide Profilnamen für die Plattformzuordnung erhalten.

Bei Bild oder Videoframe mit Covertext nutzt **Foto mit Text** zwei eigene Anordnungen:

- **Hochkant:** Das Foto füllt die gesamte Fläche scharf aus. Ein passendes 9:16-Motiv wird nicht
  zwischen Logo und Text zusammengeschrumpft. Abweichende Seitenverhältnisse werden proportional
  zugeschnitten, nicht gestreckt oder mit unscharfen Rändern ergänzt. Logo und Textbalken bleiben
  zwischen y=305 und y=1615 innerhalb der mittigen 4:5- und 3:4-Ausschnitte. Die vorhandene lokale
  OpenCV-Suche wird einmal pro ausgewähltem Bild verwendet, soweit installiert. Sie hilft beim
  Bildausschnitt und bei der Platzierung des Balkens außerhalb des erkannten Gesichts. Ohne Treffer
  wird mittig zugeschnitten und der Balken unten platziert. **Textposition im Hochkantbild** bietet
  zusätzlich Automatisch/Oben/Unten. Die Automatik ist eine Hilfe und kann Gesichter übersehen;
  bei Bedarf die Position oder den Videoframe ändern. Das Logo kann dabei ebenfalls ausweichen.
- **Quer:** Links ist eine eigene Fotofläche, rechts stehen Logo, Überschrift und optionaler
  Erklärungstext auf dunklem Grund. Schrift und Logo liegen vollständig außerhalb der Fotofläche.
  Das Foto wird auf diese Fläche zugeschnitten; erkannte Gesichter bestimmen bevorzugt den Fokus.
  Die Textmenge bleibt begrenzt, damit auch auf kleinen Vorschauen etwas erkennbar ist.

Das betrifft nur die Fotocover, nicht das eigentliche Video. Der Bot liefert weiterhin eine mittige
**raster-vorschau** in 1080×1440 (3:4) und eine **feed-vorschau** in 1080×1350 (4:5).
Diese Vorschauen sind Gestaltungstests und Exporte; der Upload bleibt 1080×1920. Sie sind keine
Zusage über jede Appansicht oder manuell verschobene Zuschnitte. An quadratischen Zuschnitten
kann weiterhin Inhalt verloren gehen.
**Zur Textgrafik wechseln** schaltet zur bisherigen Textgrafik zurück; die Gegenrichtung heißt
**Zu Foto mit Text wechseln**. Diese Auswahl erscheint nach dem Ergänzen von Bildtext.
Die reine Textgrafik bleibt ebenfalls verfügbar. Schon im Eingangsbild eingebrannte Logos und Texte
werden nicht entfernt; für diese Vorlage möglichst einen unverzierten Frame oder ein Originalfoto
verwenden. Die Frame-Auswahl greift im Bot auf das hochgeladene Originalvideo zurück, damit vom Bot
hinzugefügte Logos, Untertitel und Bauchbinden nicht doppelt ins Cover eingebrannt werden.

### Hochkantvideo als Querformat

Bei Hochkantvideos führt **Videoformat ändern → Feed auf Querformat umstellen** zur Querfassung.
Die Feed-Fassung wird aus dem
unveränderten Original auf **1920×1080 px** mit vollständigem scharfem Bild in der Mitte und
unscharfen Seitenflächen neu gerendert. Ton bleibt erhalten; Untertitel, Logo und Bauchbinde werden
für die Ausgabe neu gesetzt. Gleichzeitig wird die 9:16-Zuordnung für die konfigurierten
Hochkant-Netzwerke aktiviert (standardmäßig Instagram/TikTok). Dieser Schalter kann weiterhin
separat abgewählt werden. Zusätzliche Storys verwenden ebenfalls die 9:16-Fassung.
Bereits als 9:16 angelieferte Videos behalten in der zusätzlichen Hochkantfassung ihr normales
Layout: dieselbe Logo-Variante, Logogröße, Untertitelposition und Bauchbinde wie vor dem Umschalten.
Sie durchlaufen nicht das umgestaltende Storylayout. Nur die Querfassung erhält ein eigenes Layout:
Das Logo wird auf die verfügbare unscharfe Seitenfläche begrenzt. Eine automatisch für das
Hochkantvideo gewählte obere Untertitelposition wird nicht auf Querformat übertragen; dort gilt
die normale untere Position. Manuell gewählte Positionen bleiben wirksam. Bei manuellen oberen
Untertiteln sitzt das Querlogo unten auf der Seitenfläche. Die Hochkant-Einstellungen des Auftrags
werden dabei nicht verändert.

**Videoformat ändern → Feed im Originalformat** stellt das ursprüngliche Feedformat und die vorherige
Hochkant-Auswahl wieder her. Nach Formatänderungen vorhandene Cover neu erzeugen und die Vorschau
prüfen. Eine fehlgeschlagene Formatberechnung blockiert die Veröffentlichung bis zum erfolgreichen
erneuten Rendern. Der zusätzliche Renderdurchlauf läuft wie bisher in der seriellen Warteschlange
des Pi; es ist keine generative KI beteiligt.

Bei einem Feedvideo **Video-Titelbild erstellen/bearbeiten** öffnen. Zeit als Sekunden oder `MM:SS` wählen, eigenen kurzen Text
für eine Grafik schicken oder ein JPG/PNG hochladen. Ein Bild während des Titelbild-Dialogs wird
nicht als neuer Fotobeitrag angelegt. **Text im Titelbild ändern** ergänzt auch auf einem Bild/Videoframe eine Überschrift.
Die Vorschauen werden für die gewählten Kanäle erzeugt. **Titelbilder herunterladen** liefert JPEGs als Dateien.

Bei ausgewähltem YouTube-Kanal wechseln die Tasten **YouTube: zu Shorts-Export wechseln** und
**YouTube: zu normalem Video wechseln** das Ausgabeprofil. Im Shorts-Modus bleibt es beim Export.
Nach Kanalwechsel oder neuem Videorendern **Titelbilder neu berechnen** wählen. Die Bestätigung blockiert veraltete
oder fehlende Cover; bestätigte Feed-Teilveröffentlichungen werden bei einem Story-Wiederholungsversuch
nicht mit einem neuen Cover erneut angelegt. Cover zählen als eigene Postiz-Uploads im Stundenbudget.
Mehrere Instagram-Konten teilen denselben Coverupload.

## Optionaler Mastodon-Patch für Postiz

Mastodon läuft standardmäßig über Postiz (`MASTODON_ANBINDUNG=postiz`), auch wenn alte Direkt-Tokens
noch in der Umgebung stehen. Wer den alten Direktanschluss ausdrücklich weiterverwenden möchte,
setzt `MASTODON_ANBINDUNG=direkt`. Für den Direktanschluss wird in dieser Erweiterung kein Cover versprochen.

Der mitgelieferte Patchhelfer passt **eine lokale Postiz-Quellkopie** an. Er ändert nicht das laufende
Docker-Image und führt keinen Build, Neustart oder Deployment aus. Er wurde auf den Upload-Code aus
Postiz-Stand `a5affe62c74e39c1e7ac960d50d8418b807d532c` abgestimmt; abweichende Anker werden abgelehnt.

```bash
# Im Bot-Verzeichnis, zunächst nur prüfen:
node scripts/postiz-mastodon-thumbnail.mjs /pfad/zu/postiz-app --check
# Erst im gewünschten lokalen Postiz-Checkout anwenden:
node scripts/postiz-mastodon-thumbnail.mjs /pfad/zu/postiz-app --apply
```

Es werden `mastodon.provider.ts` und der neue Helfer `mastodon.thumbnail.ts` vorbereitet. Die
Originaldatei bleibt als `mastodon.provider.ts.vor-thumbnail` erhalten. Der neue Helfer lädt ausschließlich
JPEGs bis 2 MiB, mit dem SSRF-sicheren Dispatcher des Providers und begrenzter Downloadzeit. Erst nach
eigenem Postiz-Build, Tests und Deployment im Bot `POSTIZ_MASTODON_THUMBNAILS=ja` setzen und den Bot
neu starten. Dann reicht der Bot sein natives Cover weiter und der Provider hängt es als `thumbnail`
an den Mastodon-Upload. Tests des Helfers ersetzen keinen vollständigen Postiz-Build oder Live-Test
auf der konkreten Instanz. Das Flag ohne angepassten Provider würde weiterhin ignorierte Cover bedeuten.

## Quellen

- YouTube-Hilfe: https://support.google.com/youtube/answer/72431
- YouTube-API: https://developers.google.com/youtube/data/reference/rest/v3/thumbnails/set
- Postiz YouTube: https://docs.postiz.com/public-api/providers/youtube
- Meta-Beispiel, Reelcover: https://github.com/fbsamples/reels_publishing_apis/blob/main/insta_reels_publishing_api_sample/README.md
- Instagram Consumer-Hilfe: https://help.instagram.com/1038071743007909
- TikTok Direct Post: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- TikTok Videogrenzen: https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide
- Meta Media-Referenz: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/
- Postiz Medienfelder: https://docs.postiz.com/public-api/posts/create#video-cover-frame-thumbnailtimestamp
- Mastodon Upload: https://docs.joinmastodon.org/methods/media/
- Mastodon Instanzgrenzen: https://docs.joinmastodon.org/entities/Instance/
- Bluesky Videoschema: https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/embed/video.json
- Meta Page-SDK: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py
- X Media Studio: https://help.x.com/en/using-x/media-studio-faqs
- Postiz-Provider: https://github.com/gitroomhq/postiz-app/tree/main/libraries/nestjs-libraries/src/integrations/social

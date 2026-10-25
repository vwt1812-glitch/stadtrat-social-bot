# Videocover: Größen, Übergabe und Grenzen

Stand der Recherche: 25.10.2026. Dokumentation und aktueller Postiz-Quellcode wurden geprüft,
keine echten Accounts oder die installierte Postiz-Instanz. Die Größen unten sind Ausgabeprofile
des Bots; Empfehlungen sind keine vorgeschriebenen Mindestgrößen.

| Ziel | Bot-Ausgabe | Automatische Übergabe |
|---|---|---|
| Instagram Reel | JPEG 1080×1920, 9:16, max. 2 MiB | `image[0].thumbnail` als öffentlich abrufbare Bildadresse; Postiz setzt `cover_url` |
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
ist unser 9:16-Arbeitsprofil. Wichtige Texte bleiben im zentralen Bereich des Storylayouts, weil Raster
und Feed anders zuschneiden können. Die 2-MiB-Grenze ist ein eigener Arbeitswert, kein behauptetes API-Maximum.

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

Bei einem Feedvideo **Titelbild** öffnen. Zeit als Sekunden oder `MM:SS` wählen, eigenen kurzen Text
für eine Grafik schicken oder ein JPG/PNG hochladen. Ein Bild während des Titelbild-Dialogs wird
nicht als neuer Fotobeitrag angelegt. **Covertext** ergänzt auch auf einem Bild/Videoframe eine Überschrift.
Die Vorschauen werden für die gewählten Kanäle erzeugt. **Cover herunterladen** liefert JPEGs als Dateien.

**YouTube: normales Video / Shorts** bestimmt das Ausgabeprofil. Im Shorts-Modus bleibt es beim Export.
Nach Kanalwechsel oder neuem Videorendern **Neu erzeugen** wählen. Die Bestätigung blockiert veraltete
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
- Postiz Medienfelder: https://docs.postiz.com/public-api/posts/create#video-cover-frame-thumbnailtimestamp
- Mastodon Upload: https://docs.joinmastodon.org/methods/media/
- Mastodon Instanzgrenzen: https://docs.joinmastodon.org/entities/Instance/
- Bluesky Videoschema: https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/embed/video.json
- Meta Page-SDK: https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py
- X Media Studio: https://help.x.com/en/using-x/media-studio-faqs
- Postiz-Provider: https://github.com/gitroomhq/postiz-app/tree/main/libraries/nestjs-libraries/src/integrations/social

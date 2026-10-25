# Zweite lokale KI-Testrunde

Diese Runde verwendet sechs **synthetische, unordentlich formulierte Sprach-Notizen** statt sauberer Ausgangstexte. Je Fall werden Faktenextraktion **ohne Pflichtkategorien** und redaktionelle Glättung getrennt geprüft (insgesamt zwölf Antworten). Keine echten Sprachnachrichten und keine Transkription: Die Texte simulieren deren Inhalt.

## Start

1. PR mergen und den Bot mit `sudo bash pi/aktualisieren.sh` aktualisieren.
2. Den lokalen Qwen-`llama-server` auf Port 8099 laufen lassen (nur localhost).
3. In einer zweiten SSH-Sitzung:

```bash
cd ~/stadtrat-social-bot
LOKALE_KI_URL=http://127.0.0.1:8099 node scripts/lokale-ki-vergleich.mjs --runde2
```

Ergebnis: `~/stadtrat-social-bot/lokale-ki-ergebnisse-runde2.json`; die Datei aus Runde 1 bleibt erhalten. Für Gemma bzw. zweite Messung anderen Zielpfad als zusätzliches Argument angeben.

## Auswertung

Für jeden Eintrag getrennt überprüfen: (1) alle ausdrücklich genannten Fakten und Unsicherheiten bewahrt? (2) neue oder veränderte Fakten? (3) verständlicher als die Rohnotiz? (4) Geschwindigkeit akzeptabel? Die Felder `manuellePruefung` sind bewusst leer. Das Skript bewertet keine faktische Wahrheit automatisch. Testfälle sind fiktiv und nicht als echte Meldungen über Ratsentscheidungen zu lesen.

Diese Runde verändert weder Telegram-Bot noch Postiz und veröffentlicht nichts. Die erste Runde bleibt mit dem bisherigen Befehl verfügbar.

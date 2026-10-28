# Zeichenzählung für X

Die Zeichenzählung verwendet `@ambassify/twitter-text` 4.0.0, eine Variante von
`twitter-text` 3.1.0 mit aktualisierten Polyfills (`core-js-pure` 3 statt `core-js` 2).
Das Originalpaket zieht weiterhin die nicht mehr unterstützte Version 2 nach.
Ein direktes Upgrade dieser Unterabhängigkeit auf Version 3 ist nicht kompatibel:
Das Original importiert Modulpfade, die es dort nicht mehr gibt.

Die Variante behält die `parseTweet`-API und den Zählalgorithmus bei. Die Version
ist in `package.json` festgelegt; die tatsächlich installierten Unterabhängigkeiten
stehen in `package-lock.json`. `test/postiz.test.mjs` prüft Referenzwerte des zuvor
verwendeten Originals für Links, Unicode, Emojis und die 280-Zeichen-Grenze.

Quellen:

- https://github.com/ambassify/twitter-text
- https://github.com/twitter/twitter-text/issues/342

Bei Updates mit `npm ci`, `npm ls core-js core-js-pure` und `npm test` prüfen,
dass keine Version 2 mehr installiert wird und die Zeichenzählung erhalten bleibt.

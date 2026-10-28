import { test } from "node:test";
import assert from "node:assert/strict";
import { lageWaehlen, gesichtSuchen, untertitelBereich } from "../src/gesicht.mjs";

const MASSE = { breite: 1080, hoehe: 1920 };
const LAYOUT = { position: 0.35, zeilen: 1, logo: "assets/logos/quer-hell.png" };
// Gesichter, wie gesicht.py sie liefert (Anteile der Bildgröße), 12 Probebilder
const funde = (y, h, anzahl = 12) => ({
  bilder: 12,
  gesichter: Array.from({ length: anzahl }, (_, i) => ({ t: i, x: 0.3, y: y + (i % 3) * 0.01, w: 0.4, h })),
});

test("Untertitel-Bereich: einzeilig unten über Name und Caption der Apps", () => {
  const b = untertitelBereich("unten", { masse: MASSE, layout: LAYOUT });
  assert.equal(b.unten, 0.65);
  assert.ok(b.oben > 0.6 && b.oben < 0.62);
  assert.equal(untertitelBereich("oben", { masse: MASSE, layout: LAYOUT }).unten, 1 - 0.62);
});

test("Gesicht oben im Bild (wie beim Cutter): Untertitel bleiben unten", () => {
  assert.deepEqual(lageWaehlen(funde(0.24, 0.2), { masse: MASSE, layout: LAYOUT }), { lage: "unten", frei: true, hinweise: [] });
});

test("Selfie mit Gesicht tief im Bild: Untertitel kommen nach oben", () => {
  // gemessen in einem Selfie-Video: Gesicht von 42 % bis 71 % der Höhe
  const wahl = lageWaehlen(funde(0.42, 0.27), { masse: MASSE, layout: LAYOUT });
  assert.equal(wahl.lage, "oben");
  assert.equal(wahl.frei, true);
});

test("Gesicht füllt das Bild: geringste Überdeckung und ein Tipp", () => {
  const wahl = lageWaehlen(funde(0.2, 0.6), { masse: MASSE, layout: LAYOUT });
  assert.equal(wahl.frei, false);
  assert.match(wahl.hinweise.join(" "), /Schritt zurück/);
});

test("Kopf im Logo: Tipp fürs nächste Mal", () => {
  const wahl = lageWaehlen(funde(0.12, 0.2), { masse: MASSE, layout: LAYOUT });
  assert.match(wahl.hinweise.join(" "), /bis ins Logo/);
  assert.deepEqual(lageWaehlen(funde(0.12, 0.2), { masse: MASSE, layout: { ...LAYOUT, logo: null } }).hinweise, []);
});

test("Nichts ändern ohne verlässlichen Fund oder im Querformat", () => {
  const standard = { lage: "unten", frei: true, hinweise: [] };
  assert.deepEqual(lageWaehlen({ bilder: 12, gesichter: [] }, { masse: MASSE, layout: LAYOUT }), standard);
  assert.deepEqual(lageWaehlen(funde(0.42, 0.27, 3), { masse: MASSE, layout: LAYOUT }), standard); // nur 3 von 12
  assert.deepEqual(lageWaehlen(funde(0.42, 0.27), { masse: { breite: 1920, hoehe: 1080 }, layout: LAYOUT }), standard);
  assert.deepEqual(lageWaehlen(null, { masse: MASSE, layout: LAYOUT }), standard);
});

test("Ohne OpenCV bleibt die Gesichtssuche einfach aus", async () => {
  assert.equal(await gesichtSuchen("egal.mp4", { python: "/gibt/es/nicht/python" }), null);
  assert.equal(await gesichtSuchen("egal.mp4", { python: "" }), null);
});

test("Ohne Logo wird der freie obere Bereich gegen Gesichter geprüft", () => {
  const gross = funde(0.28, 0.44);
  const ohneLogo = { ...LAYOUT, logo: null };
  assert.equal(lageWaehlen(gross, { masse: MASSE, layout: ohneLogo }).lage, "logobereich");
  assert.equal(lageWaehlen(gross, { masse: MASSE, layout: ohneLogo }).frei, true);
  assert.notEqual(lageWaehlen(gross, { masse: MASSE, layout: LAYOUT }).lage, "logobereich");
  assert.equal(lageWaehlen(funde(0.12, 0.2), { masse: MASSE, layout: ohneLogo }).lage, "unten");
  const voll = lageWaehlen(funde(0.08, 0.85), { masse: MASSE, layout: ohneLogo });
  assert.equal(voll.frei, false);
});

test("Freier Logobereich lässt die obere Bedienleiste bei einer und zwei Zeilen frei", () => {
  for (const masse of [MASSE, { breite: 1080, hoehe: 1200 }]) {
    for (const zeilen of [1, 2]) {
      const b = untertitelBereich("logobereich", { masse, layout: { ...LAYOUT, zeilen, logo: null } });
      assert.ok(b.oben >= 0.1499);
      assert.ok(b.unten < 0.35);
    }
  }
});

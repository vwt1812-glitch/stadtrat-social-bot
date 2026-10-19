// Rendert Logo-Karte und Bauchbinde wirklich mit ffmpeg (übersprungen, wenn ffmpeg fehlt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { karteFilter, logoGrafik, bauchbindeGrafik, untersuche } from "../src/video.mjs";

const ffmpegDa = (() => {
  try {
    execFileSync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

const LAYOUT = {
  logo: "assets/logos/quer-dunkel.png", logoPosition: "oben-links", logoBreite: 0.48, logoStil: "karte",
  karteFarbe: "#1D1D1B", akzentFarbe: "#F18616", schriftOrdner: "assets/fonts", position: 0.18,
};

test("Karte: Fläche plus Rand für den Schatten", () => {
  const k = karteFilter({ w: 600, h: 200, r: 30, farbe: "#1D1D1B", schatten: 16, label: "k" });
  assert.equal(k.breite, 664);
  assert.equal(k.hoehe, 264);
  assert.deepEqual([k.x, k.y], [32, 24]);
  assert.match(k.graph, /^color=c=0x1D1D1B:s=664x264/);
});

test("Logo-Karte oben links, sichtbar 5 % vom Rand", { skip: !ffmpegDa }, async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "grafik-"));
  const masse = { breite: 1080, hoehe: 1920 };
  const logo = await logoGrafik({ layout: LAYOUT, masse, ordner });
  const bild = await untersuche(logo.datei);
  // Logo 518 px + 2 × 38 px Innenabstand + 2 × 32 px Schattenrand
  assert.equal(bild.breite, 518 + 76 + 64);
  assert.equal(logo.x + 32, 54);
  assert.equal(logo.y + 24, Math.round(1920 * 0.073));
  const rechts = await logoGrafik({ layout: { ...LAYOUT, logoPosition: "oben-rechts" }, masse, ordner });
  assert.equal(rechts.x + 32 + 518 + 76, 1080 - 54);
});

test("Bauchbinde passt sich der Textlänge an und liegt über den Untertiteln", { skip: !ffmpegDa }, async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "binde-"));
  const masse = { breite: 1080, hoehe: 1920 };
  const kurz = await bauchbindeGrafik({ name: "Lukas", funktion: "", layout: LAYOUT, masse, ordner });
  const kurzBreite = (await untersuche(kurz.datei)).breite;
  const lang = await bauchbindeGrafik({ name: "Lukas Küffner", funktion: "Stadtrat in Nürnberg: Radverkehr & Haushalt", layout: LAYOUT, masse, ordner });
  const langBild = await untersuche(lang.datei);
  assert.ok(langBild.breite > kurzBreite + 200);
  assert.ok(langBild.breite <= 1080 - 2 * 54 + 64);
  // Sichtbare Karte (168 px hoch, 24 px unter der Bildkante) endet 30 px über dem Untertitelblock
  const untertitelOben = 1920 * (1 - 0.18) - 2.6 * Math.round(1080 * 0.062);
  assert.equal(langBild.hoehe, 168 + 64);
  assert.equal(lang.y + 24 + 168, Math.round(untertitelOben - 30));
});

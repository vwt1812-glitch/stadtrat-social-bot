// Rendert Logo-Karte und Bauchbinde wirklich mit ffmpeg (übersprungen, wenn ffmpeg fehlt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { karteFilter, logoGrafik, bauchbindeGrafik, wischFilter, untersuche, istStoryFormat, storyFoto, rendern, logoFuerStory, storySchleier, STORY_MASSE } from "../src/video.mjs";

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
  // Hochkant-Video: unter Reitern, Kamera und Suche von TikTok/Reels (obere 14 %), Fotos höher
  assert.equal(logo.y + 24, Math.round(1920 * 0.14));
  const foto = await logoGrafik({ layout: LAYOUT, masse, ordner, video: false });
  assert.equal(foto.y + 24, Math.round(1920 * 0.073));
  const rechts = await logoGrafik({ layout: { ...LAYOUT, logoPosition: "oben-rechts" }, masse, ordner });
  assert.equal(rechts.x + 32 + 518 + 76, 1080 - 54);
});

test("Balken-Bauchbinde unten links unter den Untertiteln, Breite nach Text", { skip: !ffmpegDa }, async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "balken-"));
  const masse = { breite: 1080, hoehe: 1920 };
  const layout = { ...LAYOUT, position: 0.35 };
  const kurz = await bauchbindeGrafik({ name: "Lukas", funktion: "", layout, masse, ordner });
  assert.equal(kurz.art, "balken");
  assert.equal(kurz.dateien.schwarz, null);
  assert.equal(kurz.hoehe, 102);
  const lang = await bauchbindeGrafik({ name: "Lukas Küffner", funktion: "Stadtrat in Nürnberg", layout, masse, ordner });
  assert.ok(lang.breite > kurz.breite + 200);
  for (const datei of Object.values(lang.dateien)) {
    const bild = await untersuche(datei);
    assert.deepEqual([bild.breite, bild.hoehe], [lang.breite, lang.hoehe]);
  }
  // Orange 102 px, schwarz 42 px, 20 px überlappend; Unterkante bei 76 % der Höhe – darunter
  // blenden TikTok/Reels Name und Caption ein –, 10 % vom linken Rand
  assert.equal(lang.hoehe, 124);
  assert.equal(lang.y + lang.hoehe, Math.round(1920 * 0.76));
  assert.equal(lang.x, 108);
  // Untertitel weiter unten: Bauchbinde rutscht darüber
  const drueber = await bauchbindeGrafik({ name: "Lukas Küffner", funktion: "Stadtrat", layout: LAYOUT, masse, ordner });
  assert.ok(drueber.y + drueber.hoehe < 1920 * (1 - 0.18));
});

test("Wischfilter läuft ein und wieder aus", () => {
  const f = wischFilter({ breite: 500, hoehe: 124, steigung: 0.15, gesamt: 4, dauer: 0.9, streifen: 60 });
  assert.match(f, /^geq=r='if\(/);
  assert.match(f, /clip\(\(T-0\)\/0\.9,0,1\)/);
  assert.match(f, /clip\(\(4-T\)\/0\.9,0,1\)/);
  assert.doesNotMatch(wischFilter({ breite: 500, hoehe: 124, steigung: 0.15, gesamt: 4, dauer: 0.9 }), /255/);
});

test("Karten-Bauchbinde passt sich der Textlänge an und liegt über den Untertiteln", { skip: !ffmpegDa }, async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "binde-"));
  const masse = { breite: 1080, hoehe: 1920 };
  const LAYOUT_KARTE = { ...LAYOUT, bauchbindeStil: "karte" };
  const kurz = await bauchbindeGrafik({ name: "Lukas", funktion: "", layout: LAYOUT_KARTE, masse, ordner });
  const kurzBreite = (await untersuche(kurz.datei)).breite;
  const lang = await bauchbindeGrafik({ name: "Lukas Küffner", funktion: "Stadtrat in Nürnberg: Radverkehr & Haushalt", layout: LAYOUT_KARTE, masse, ordner });
  const langBild = await untersuche(lang.datei);
  assert.ok(langBild.breite > kurzBreite + 200);
  assert.ok(langBild.breite <= 1080 - 2 * 54 + 64);
  // Sichtbare Karte (168 px hoch, 24 px unter der Bildkante) endet 30 px über dem Untertitelblock
  const untertitelOben = 1920 * (1 - 0.18) - 2.6 * Math.round(1080 * 0.062);
  assert.equal(langBild.hoehe, 168 + 64);
  assert.equal(lang.y + 24 + 168, Math.round(untertitelOben - 30));
});

test("Story-Format: 9:16 mit etwas Spielraum", () => {
  assert.ok(istStoryFormat({ breite: 1080, hoehe: 1920 }));
  assert.ok(istStoryFormat({ breite: 720, hoehe: 1280 }));
  assert.ok(istStoryFormat({ breite: 1080, hoehe: 1916 }));
  assert.ok(!istStoryFormat({ breite: 1080, hoehe: 1350 })); // 4:5
  assert.ok(!istStoryFormat({ breite: 1920, hoehe: 1080 }));
  assert.ok(!istStoryFormat({ breite: 1080, hoehe: 1080 }));
});

test("Story-Fassung: Querformat-Foto und -Video werden 1080×1920", { skip: !ffmpegDa }, async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "story-"));
  const foto = path.join(ordner, "quer.jpg");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1600x900:d=1", "-frames:v", "1", foto]);
  const storyBild = path.join(ordner, "story.jpg");
  await storyFoto({ eingabe: foto, ausgabe: storyBild });
  const bild = await untersuche(storyBild);
  assert.deepEqual([bild.breite, bild.hoehe], [1080, 1920]);

  const video = path.join(ordner, "quer.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=1.5", "-pix_fmt", "yuv420p", video]);
  const storyVideo = path.join(ordner, "story.mp4");
  const masse = { breite: 1080, hoehe: 1920, dauer: 1.5 };
  await rendern({ eingabe: video, ausgabe: storyVideo, ass: null, masse, layout: LAYOUT, story: true,
    video: { encoder: "libx264", preset: "ultrafast", crf: "30" } });
  const fertig = await untersuche(storyVideo);
  assert.deepEqual([fertig.breite, fertig.hoehe], [1080, 1920]);
});

test("Story-Logo: helle Schrift auf dem Verlauf, mit Karte unverändert", async () => {
  const layout = { ...LAYOUT, logo: "assets/logos/quer-hell.png", logoStil: "frei" };
  assert.equal(await logoFuerStory(layout), "assets/logos/quer-dunkel.png");
  assert.equal(await logoFuerStory({ ...layout, logoStil: "karte" }), "assets/logos/quer-hell.png");
  assert.equal(await logoFuerStory({ ...layout, logo: "assets/logos/signet.png" }), "assets/logos/signet.png");
});

test("Story-Verlauf: oben halb deckend, ab 40 % durchsichtig", { skip: !ffmpegDa }, async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "schleier-"));
  const ziel = path.join(ordner, "s.png");
  await storySchleier(STORY_MASSE, ziel);
  const alpha = (y) => execFileSync("ffmpeg", ["-v", "error", "-i", ziel, "-vf", `crop=1:1:500:${y},format=rgba`, "-f", "rawvideo", "-"])[3];
  assert.equal(alpha(100), 128);
  assert.equal(alpha(Math.round(1920 * 0.2)), 128);
  assert.equal(alpha(Math.round(1920 * 0.45)), 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ausfuehren, rendern, untersuche, querLayout, logoGrafik } from "../src/video.mjs";
import { fotoCover, fotoCoverBereiche } from "../src/cover-foto.mjs";
import { thumbnailsErstellen } from "../src/thumbnail.mjs";

test("Querlayout reserviert die Seitenfläche und übernimmt keine automatische Hochkant-Position", () => {
  const original = { breite: 1080, hoehe: 1920 }, masse = { breite: 1920, hoehe: 1080 };
  const layout = { logo: "quer-hell.png", logoStil: "frei", logoBreite: 0.9,
    logoPosition: "oben-links", lage: "oben", smartLogo: true, gesichter: [{ x: 0.3, y: 0.5, w: 0.2, h: 0.2 }] };
  const vorher = structuredClone(layout);
  const quer = querLayout(layout, original, masse, { lageAutomatisch: true });
  assert.equal(quer.lage, null);
  assert.equal(quer.logo, layout.logo);
  assert.ok(quer.logoBreite * 1080 + 108 <= 656);
  assert.equal(quer.smartLogo, false);
  assert.deepEqual(layout, vorher);
  const manuell = querLayout(layout, original, masse);
  assert.equal(manuell.lage, "oben");
  assert.equal(manuell.logoPosition, "unten-links");
});

test("Foto, Logo und Titel bleiben ohne Überdeckung in 4:5 und 3:4 sichtbar", () => {
  for (const balkenHoehe of [194, 324, 480]) {
    const b = fotoCoverBereiche({ balkenHoehe, logoHoehe: 140 });
    assert.ok(b.logoY + 140 <= b.fotoY);
    assert.ok(b.fotoY + b.fotoHoehe <= b.balkenY);
    for (const [oben, unten] of [[285, 1635], [240, 1680]]) {
      assert.ok(b.logoY >= oben + 20);
      assert.ok(b.balkenY + balkenHoehe <= unten - 20);
    }
    assert.ok(b.fotoHoehe >= 560);
  }
  assert.throws(() => fotoCoverBereiche({ balkenHoehe: 900, logoHoehe: 140 }), /kürzen/);
});

for (const modus of ["wechsel", "fehler"]) test(`Telegram: Hochkant → Querformat (${modus})`, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "video-quer-flow-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, ["--experimental-test-module-mocks",
    fileURLToPath(new URL("./fixtures/video-quer-flow.mjs", import.meta.url)), dir, modus],
  { timeout: 22000, stdio: "pipe" });
});

const ffmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("Hochkant bleibt vollständig auf der Querfläche; Ton und separate Coverformate bleiben erhalten", { skip: !ffmpeg }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "video-quer-render-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const original = path.join(dir, "original.mp4"), out = path.join(dir, "quer.mp4");
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i",
    "color=c=blue:s=180x320:r=5:d=1,drawbox=x=0:y=0:w=iw:h=24:color=red:t=fill,drawbox=x=0:y=296:w=iw:h=24:color=green:t=fill",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", original]);
  const vorher = await fs.readFile(original);
  for (const logoStil of ["frei", "karte"]) {
    for (const logoPosition of ["oben-links", "oben-rechts"]) {
      const layout = querLayout({ logo: path.resolve("assets/logos/quer-hell.png"), logoBreite: 0.9,
        logoStil, logoPosition, karteFarbe: "#1D1D1B" }, { breite: 180, hoehe: 320 }, { breite: 640, hoehe: 360 });
      const logo = await logoGrafik({ layout, masse: { breite: 640, hoehe: 360 }, ordner: dir });
      if (logoPosition.endsWith("links")) assert.ok(logo.sichtbar.x + logo.sichtbar.w <= 219);
      else assert.ok(logo.sichtbar.x >= 421);
    }
  }
  await rendern({ eingabe: original, ausgabe: out, masse: { breite: 640, hoehe: 360, dauer: 1 }, layout: {},
    video: { encoder: "libx264", preset: "ultrafast", crf: "18" }, quer: true });
  const m = await untersuche(out);
  assert.deepEqual([m.breite, m.hoehe, m.hatTon], [640, 360, true]);
  // Oberer roter und unterer grüner Rand müssen im scharfen Vordergrund erhalten bleiben.
  for (const [y, kanal] of [[5, 0], [350, 1]]) {
    const rgb = await ausfuehren("ffmpeg", ["-v", "error", "-i", out, "-vf", `crop=2:2:320:${y},scale=1:1`,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { binaer: true });
    assert.ok(rgb[kanal] > rgb[2] + 40, [...rgb].join(","));
  }
  const cover = await thumbnailsErstellen({ ordner: dir, video: out, quelle: original, layout: { schriftOrdner: path.resolve("assets/fonts") },
    optionen: { modus: "frame", frameMs: 0, quer: true }, kanaele: [{ identifier: "instagram" }] });
  assert.deepEqual(Object.keys(cover.dateien).sort(), ["feed-vorschau", "hochkant", "original", "quer", "raster-vorschau"]);
  for (const [key, hoehe] of [["feed-vorschau", 1350], ["raster-vorschau", 1440]]) {
    const v = await untersuche(cover.dateien[key]);
    assert.deepEqual([v.breite, v.hoehe], [1080, hoehe]);
  }
  const q = await untersuche(cover.dateien.quer), h = await untersuche(cover.dateien.hochkant);
  assert.deepEqual([q.breite, q.hoehe, h.breite, h.hoehe], [1920, 1080, 1080, 1920]);
  const frame = await untersuche(path.join(path.dirname(cover.dateien.original), "frame.jpg"));
  assert.deepEqual([frame.breite, frame.hoehe], [180, 320]); // Frame aus unverziertem Original, nicht aus 16:9-Fassung.
  for (const quer of [false, true]) {
    const datei = path.join(dir, quer ? "foto-quer.jpg" : "foto-hoch.jpg");
    await fotoCover({ ausgabe: datei, bild: cover.dateien.hochkant, inhalt: { titel: "Mehr Transparenz", beschreibung: "Für Nürnberg" },
      layout: { schriftOrdner: path.resolve("assets/fonts"), logo: path.resolve("assets/logos/quer-hell.png") }, quer });
    const f = await untersuche(datei);
    assert.deepEqual([f.breite, f.hoehe], [1080, quer ? 608 : 1920]);
  }
  assert.deepEqual(await fs.readFile(original), vorher);
});

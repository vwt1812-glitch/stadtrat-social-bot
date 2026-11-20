import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hochkantAusschnitt } from "../src/hochkant-ausschnitt.mjs";
import { ausfuehren, rendern, storyLayout, untersuche } from "../src/video.mjs";

const original = { breite: 1920, hoehe: 1080 };
const funde = (x = 0.65) => ({ bilder: 24, alleGesichter: true,
  gesichter: Array.from({ length: 24 }, (_, t) => ({ t, x: x + (t % 3) * 0.005, y: 0.25, w: 0.09, h: 0.17 })) });

test("Fester 9:16-Ausschnitt folgt einer seitlich stehenden Person mit Kopfrand und Schultern", () => {
  const f = funde();
  const a = hochkantAusschnitt(original, f);
  assert.ok(a.x > original.breite / 2);
  assert.equal(a.breite / a.hoehe, 9 / 16);
  for (const n of Object.values(a)) assert.equal(n % 2, 0);
  for (const g of f.gesichter) {
    assert.ok(a.x <= (g.x - g.w * 0.6) * original.breite);
    assert.ok(a.x + a.breite >= (g.x + g.w * 1.6) * original.breite);
  }
  const layout = storyLayout({ gesichter: f.gesichter, positionFest: 0.6 }, original, { breite: 1080, hoehe: 1920 }, a);
  assert.equal(layout.bild, null);
  assert.equal(layout.positionFest, undefined);
  assert.ok(layout.gesichter.every((g) => g.x > 0 && g.x + g.w < 1));
  assert.equal(layout.gesichter[0].t, 0);
});

for (const [name, anpassen] of [
  ["keine Funde", () => null],
  ["alte Erkennung nur des größten Gesichts", (f) => ({ ...f, alleGesichter: false })],
  ["zu wenige Probebilder", (f) => ({ ...f, bilder: 2 })],
  ["seltene Erkennung", (f) => ({ ...f, gesichter: f.gesichter.slice(0, 21) })],
  ["mehrere Treffer ersetzen keine zeitliche Abdeckung", (f) => ({ ...f, gesichter: f.gesichter.map((g) => ({ ...g, t: 0 })) })],
  ["zwei weit getrennte Personen", (f) => ({ ...f, gesichter: [...f.gesichter, { ...f.gesichter[0], x: 0.1, w: 0.06 }] })],
  ["starke Bewegung", (f) => ({ ...f, gesichter: f.gesichter.map((g) => ({ ...g, x: g.t % 2 ? 0.1 : 0.7 })) })],
  ["Kopf reicht an oberen Rand", (f) => ({ ...f, gesichter: f.gesichter.map((g) => ({ ...g, y: 0.01 })) })],
  ["ungültige Koordinaten", (f) => ({ ...f, gesichter: [{ ...f.gesichter[0], x: NaN }, ...f.gesichter.slice(1)] })],
]) test(`Vollständiges Bild bei: ${name}`, () => assert.equal(hochkantAusschnitt(original, anpassen(funde())), null));

test("Natives Hochkant und quadratische Aufnahmen bleiben unbeschnitten", () => {
  assert.equal(hochkantAusschnitt({ breite: 1080, hoehe: 1920 }, funde()), null);
  assert.equal(hochkantAusschnitt({ breite: 1080, hoehe: 1080 }, funde()), null);
});

const ffmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("Echtes Video: Ausschnitt füllt das Bild, Fallback erhält Seiten, Ton und Original bleiben erhalten", { skip: !ffmpeg }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-crop-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const eingabe = path.join(dir, "original.mp4");
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i",
    "color=c=blue:s=640x360:r=5:d=1,drawbox=x=300:y=0:w=280:h=360:color=red:t=fill",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", eingabe]);
  const vorher = await fs.readFile(eingabe);
  const quelle = await untersuche(eingabe);
  for (const schneiden of [true, false]) {
    const a = schneiden ? hochkantAusschnitt(quelle, funde()) : null;
    const masse = { breite: 180, hoehe: 320, dauer: 1 };
    const ausgabe = path.join(dir, `${schneiden}.mp4`);
    await rendern({ eingabe, ausgabe, masse, story: true,
      layout: storyLayout({ gesichter: funde().gesichter }, quelle, masse, a),
      video: { encoder: "libx264", preset: "ultrafast", crf: "18" } });
    const m = await untersuche(ausgabe);
    assert.deepEqual([m.breite, m.hoehe, m.hatTon], [180, 320, true]);
    assert.ok(Math.abs(m.dauer - 1) < 0.2);
    const rgb = await ausfuehren("ffmpeg", ["-v", "error", "-i", ausgabe, "-vf", "crop=2:2:4:160,scale=1:1",
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { binaer: true });
    assert.ok(schneiden ? rgb[0] > rgb[2] + 80 : rgb[2] > rgb[0] + 80, `${schneiden}: ${[...rgb]}`);
  }
  assert.deepEqual(await fs.readFile(eingabe), vorher);
});

test("Telegram: automatische Auswahl, vollständiges Bild und erneute Auswahl verwenden dieselbe Prüfung", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-crop-flow-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, ["--experimental-test-module-mocks",
    fileURLToPath(new URL("./fixtures/hochkant-ausschnitt-flow.mjs", import.meta.url)), dir],
    { timeout: 22000, stdio: "pipe" });
});

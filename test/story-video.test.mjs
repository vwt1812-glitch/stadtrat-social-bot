import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ausfuehren, untersuche } from "../src/video.mjs";
import { storyAnzahl, storyClipsVorbereiten, storyClipsHochladen } from "../src/story-video.mjs";

test("Story-Grenzen: bis 60 Sekunden unverändert, darüber vollständige Aufteilung", () => {
  assert.deepEqual([59, 60, 60.1, 118, 125].map(storyAnzahl), [1, 1, 2, 2, 3]);
});

test("FFmpeg: 125 Sekunden mit Ton werden vollständig zu 59/59/7 Sekunden; Cache wird erneuert", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "story-clips-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const eingabe = path.join(dir, "video.mp4");
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=64x96:r=15:d=125",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=125", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", eingabe]);
  let gespeichert;
  const speichern = async (c) => { gespeichert = structuredClone(c); };
  const cache = await storyClipsVorbereiten(eingabe, null, speichern);
  assert.equal(gespeichert.dateien.length, 3);
  const clips = await Promise.all(cache.dateien.map(untersuche));
  assert.ok(clips.every((c) => c.dauer <= 60 && c.hatTon && c.breite === 64 && c.hoehe === 96));
  assert.ok(Math.abs(clips.reduce((sum, c) => sum + c.dauer, 0) - 125) < 0.2);
  assert.ok(Math.abs(clips[2].dauer - 7) < 0.1);
  assert.equal(await storyClipsVorbereiten(eingabe, cache, speichern), cache);
  await fs.utimes(eingabe, new Date(), new Date(Date.now() + 2000));
  const neu = await storyClipsVorbereiten(eingabe, cache, speichern);
  assert.notEqual(neu.quelle, cache.quelle);
  assert.deepEqual(neu.hochgeladen, []);
});

test("Videos bis einschließlich 60 Sekunden werden nicht neu codiert (auch ohne Ton)", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "story-kurz-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const eingabe = path.join(dir, "video.mp4");
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=s=64x96:r=30:d=60",
    "-c:v", "libx264", "-preset", "ultrafast", eingabe]);
  assert.equal(await storyClipsVorbereiten(eingabe, null, () => assert.fail("Kein Cache nötig")), null);
});

test("Upload-Abbruch: bestätigte Clips bleiben gespeichert, Fortsetzen lädt nur fehlende Clips", async () => {
  let stand = { dateien: ["eins", "zwei", "drei"], hochgeladen: [] };
  const speichern = async (neu) => { stand = structuredClone(neu); };
  await assert.rejects(storyClipsHochladen(stand, async (datei) => {
    if (datei === "zwei") throw new Error("Abbruch");
    return { id: datei, path: `${datei}.mp4` };
  }, speichern), /Abbruch/);
  assert.equal(stand.hochgeladen.length, 1);
  const aufrufe = [];
  const uploads = await storyClipsHochladen(stand, async (datei) => {
    aufrufe.push(datei);
    return { id: datei, path: `${datei}.mp4` };
  }, speichern);
  assert.deepEqual(aufrufe, ["zwei", "drei"]);
  assert.equal(uploads.length, 3);
});

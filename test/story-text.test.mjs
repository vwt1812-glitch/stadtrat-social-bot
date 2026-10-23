import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { storyTextZeilen, storyFotoText } from "../src/story-text.mjs";
import { untersuche } from "../src/video.mjs";

test("Story-Text wird sinnvoll auf maximal sechs Zeilen umgebrochen", () => {
  const zeilen = storyTextZeilen("Mehr Transparenz im Nürnberger Stadtrat!\nLivestreams jetzt.");
  assert.ok(zeilen.length >= 2 && zeilen.length <= 6);
  assert.ok(zeilen.every((z) => [...z].length <= 24));
  assert.deepEqual(storyTextZeilen(""), []);
  assert.ok(storyTextZeilen("Ä".repeat(28)).length > 1);
});

test("Zu langer Story-Text wird verständlich zurückgewiesen", () => {
  assert.throws(() => storyTextZeilen("A".repeat(181)), /maximal 180/);
  assert.throws(() => storyTextZeilen("Langer Satz ".repeat(13)), /maximal 6/);
});

const ffmpegDa = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch { return false; }
})();

test("Story-Foto erhält eingebrannten Text in 1080×1920", { skip: !ffmpegDa }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-text-"));
  const eingabe = path.join(dir, "vorher.jpg");
  const ausgabe = path.join(dir, "nachher.jpg");
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=1080x1920",
    "-frames:v", "1", eingabe,
  ]);
  await storyFotoText({
    eingabe, ausgabe, text: "Transparenz für Nürnberg!\n100 % Offenheit",
    layout: { schriftOrdner: path.resolve("assets/fonts") },
  });
  const d = await untersuche(ausgabe);
  assert.deepEqual([d.breite, d.hoehe], [1080, 1920]);
  assert.ok(fs.statSync(ausgabe).size > 3000);
});

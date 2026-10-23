import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { storyTextZeilen, storyFotoText } from "../src/story-text.mjs";
import { untersuche } from "../src/video.mjs";
import { storyTextPlatzierung, sichereZone } from "../src/story-layout.mjs";

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

test("Story-Bildtext meidet Gesichter, darf aber im Blur innerhalb der Safe Area stehen", () => {
  const masse = { breite: 1080, hoehe: 1920 };
  const bild = { links: 0, rechts: 1080, oben: 440, unten: 1360, breite: 1080, hoehe: 920 };
  const gesichter = [{ x: 0.32, y: 0.48, w: 0.32, h: 0.20 }];
  const h = 180;
  const ohne = storyTextPlatzierung({ masse, hoehe: h, bild });
  const mit = storyTextPlatzierung({ masse, hoehe: h, bild, gesichter });
  const safe = sichereZone(masse, "story");
  assert.equal(ohne, 540); // Wie bisher: wenn der Blur unten nicht in die Safe Area passt.
  assert.ok(mit >= safe.oben && mit + h <= safe.unten);
  assert.ok(mit + h < 0.415 * masse.hoehe || mit > 0.745 * masse.hoehe,
    "Text darf den geschützten Kopfbereich nicht überdecken");
  const schmal = { ...bild, oben: 530, unten: 1120, hoehe: 590 };
  const blurUnten = storyTextPlatzierung({ masse, hoehe: h, bild: schmal, gesichter });
  assert.ok(blurUnten >= schmal.unten + 24, "Blur-Bereich unten soll erlaubt bleiben");
});

test("Ohne erkannte Gesichter bleibt die bestehende Story-Position unverändert", () => {
  const x = { masse: { breite: 1080, hoehe: 1920 }, hoehe: 180,
    bild: { oben: 450, unten: 1150 } };
  assert.equal(storyTextPlatzierung(x), storyTextPlatzierung({ ...x, gesichter: [] }));
});

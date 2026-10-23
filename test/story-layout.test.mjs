import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sichereZone, bildRechteck, gesichterUebertragen, logoPlatzierung, storyTextPlatzierung,
} from "../src/story-layout.mjs";

const MASSE = { breite: 1080, hoehe: 1920 };

test("Story und Reel haben unterschiedliche, konservative UI-Safe-Areas", () => {
  const story = sichereZone(MASSE, "story");
  const reel = sichereZone(MASSE, "reel");
  assert.equal(story.oben, 269);
  assert.equal(story.unten, 1536);
  assert.equal(reel.unten, 1248);
  assert.ok(reel.rechts < story.rechts); // rechte Like/Kommentar-Leiste
});

test("Exakte scharfe Bildfläche bei Querformat und Foto mit begrenzter Höhe", () => {
  assert.deepEqual(bildRechteck({ breite: 1920, hoehe: 1080 }, MASSE), {
    links: 0, rechts: 1080, oben: 656, unten: 1264, breite: 1080, hoehe: 608,
  });
  const foto = bildRechteck({ breite: 900, hoehe: 1600 }, MASSE, 1920 * 0.8);
  assert.equal(foto.hoehe, 1536);
  assert.ok(foto.oben > 0 && foto.unten < 1920);
});

test("Gesichtskoordinaten des Originalvideos auf zentriertes 9:16 übertragen", () => {
  const bild = bildRechteck({ breite: 1920, hoehe: 1080 }, MASSE);
  const [gesicht] = gesichterUebertragen([{ x: 0.25, y: 0.25, w: 0.2, h: 0.3 }], bild, MASSE);
  assert.ok(gesicht.y > 0.41 && gesicht.y < 0.43);
  assert.ok(gesicht.h < 0.11);
  assert.equal(gesicht.x, 0.25);
});

test("Logo liegt bevorzugt auf der oberen unscharfen Fläche und vollständig in der Safe Area", () => {
  const bild = bildRechteck({ breite: 1920, hoehe: 1080 }, MASSE);
  const position = logoPlatzierung({ masse: MASSE, breite: 650, hoehe: 180, bild });
  assert.equal(position.typ, "blur-oben");
  assert.equal(position.y + 180, bild.oben - 48);
  assert.ok(position.y >= sichereZone(MASSE).oben);
});

test("Bei Gesicht im Logo wird eine andere Ecke gewählt", () => {
  const position = logoPlatzierung({
    masse: MASSE, breite: 300, hoehe: 170, modus: "reel",
    gesichter: [{ x: 0.04, y: 0.12, w: 0.4, h: 0.3 }],
  });
  assert.equal(position.typ, "oben-rechts");
});

test("Manuelle Position respektiert weiterhin Safe Areas", () => {
  const p = logoPlatzierung({
    masse: MASSE, breite: 400, hoehe: 180, wunsch: "unten-links",
  });
  const zone = sichereZone(MASSE);
  assert.equal(p.typ, "unten-links");
  assert.ok(p.y + 180 <= zone.unten);
  assert.equal(p.x, zone.links);
});

test("Bildtext nutzt untere Blur-Fläche und überschreibt kein darüber liegendes Logo", () => {
  const bild = bildRechteck({ breite: 1920, hoehe: 1080 }, MASSE);
  const oben = storyTextPlatzierung({
    masse: MASSE, hoehe: 210, bild, logo: { x: 200, y: 400, w: 600, h: 140 },
  });
  assert.ok(oben > bild.unten);
  assert.ok(oben + 210 <= sichereZone(MASSE).unten);
});

test("Story-Bildtext weicht erkanntem Gesicht aus und darf Blur unten nutzen", () => {
  const bild = { oben: 443, unten: 1091 };
  const gesichter = [{ x: 0.34, y: 0.46, w: 0.31, h: 0.18 }];
  const y = storyTextPlatzierung({
    masse: MASSE, hoehe: 170, bild, gesichter,
    logo: { x: 40, y: 275, w: 900, h: 130 },
  });
  const safe = sichereZone(MASSE);
  assert.ok(y >= safe.oben && y + 170 <= safe.unten);
  assert.ok(y >= bild.unten, "Der freie Blur-Bereich unter dem Foto sollte erlaubt sein");
});
test("Ohne Gesicht bleibt die bisherige Story-Textposition unverändert", () => {
  const optionen = { masse: MASSE, hoehe: 200, bild: { oben: 650, unten: 1180 } };
  assert.equal(storyTextPlatzierung(optionen),
    storyTextPlatzierung({ ...optionen, gesichter: [] }));
});
test("Gesicht auf gesamter Breite erzwingt eine andere Safe-Area-Textposition", () => {
  const y = storyTextPlatzierung({
    masse: MASSE, hoehe: 160,
    gesichter: [{ x: 0.03, y: 0.43, w: 0.94, h: 0.27 }],
  });
  assert.ok(y + 160 <= sichereZone(MASSE).unten);
  assert.ok(y + 160 <= (0.43 - 0.035) * MASSE.hoehe || y >= (0.43 + 0.27 + 0.035) * MASSE.hoehe);
});

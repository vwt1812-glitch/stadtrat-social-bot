import { test } from "node:test";
import assert from "node:assert/strict";
import { einfacherVorschlag, captionVorschlag, kuerzen } from "../src/caption.mjs";

const o = { anbieter: null, modell: "x", stil: "", hashtags: "#Nürnberg" };

test("eigener Text hat Vorrang", () => {
  assert.deepEqual(einfacherVorschlag({ notizen: " Mein Text ", transkript: "Egal." }, "#N"), { text: "Mein Text", quelle: "eigene" });
});

test("Auszug aus dem Transkript", () => {
  const lang = "Erster Satz. ".repeat(40);
  const v = einfacherVorschlag({ transkript: lang }, "#N");
  assert.equal(v.quelle, "transkript");
  assert.ok(v.text.length < 300);
  assert.ok(v.text.endsWith("#N"));
});

test("ohne Material nur Hashtags, ohne Schlüssel kein API-Aufruf", async () => {
  assert.deepEqual(await captionVorschlag({ art: "foto", bilder: [] }, o), { text: "#Nürnberg", quelle: "hashtags" });
  assert.deepEqual(await captionVorschlag({ art: "text", notizen: "Hallo" }, o), { text: "Hallo", quelle: "eigene" });
});

test("Kürzen aufs Zeichenlimit", () => {
  const text = "Heute war ich am Plärrer und habe mir den neuen Radweg angeschaut. Er ist breit und sicher.\n\nWas meint ihr?\n\n#Nürnberg #Radverkehr";
  assert.equal(kuerzen(text, 500), text);
  const kurz = kuerzen(text, 100);
  assert.ok(Array.from(kurz).length <= 100);
  assert.equal(kurz, "Heute war ich am Plärrer und habe mir den neuen Radweg angeschaut.\n\n#Nürnberg #Radverkehr");
  const sehrKurz = kuerzen(text, 40);
  assert.ok(Array.from(sehrKurz).length <= 40, sehrKurz);
  assert.match(sehrKurz, /…/);
  const doppelt = (t) => Array.from(t).length * 2;
  assert.ok(doppelt(kuerzen(text, 100, doppelt)) <= 100);
});

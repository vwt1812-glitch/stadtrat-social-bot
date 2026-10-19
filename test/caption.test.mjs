import { test } from "node:test";
import assert from "node:assert/strict";
import { einfacherVorschlag, captionVorschlag } from "../src/caption.mjs";

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

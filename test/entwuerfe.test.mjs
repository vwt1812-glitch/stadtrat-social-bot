import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Auftraege } from "../src/auftraege.mjs";

function speicher(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entwuerfe-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Auftraege(dir);
}

test("Archiv erhält Medien und Einstellungen über Neustart und Bereinigung", (t) => {
  const s = speicher(t);
  const a = s.neu(1);
  const medium = path.join(a.ordner, "original.jpg");
  fs.writeFileSync(medium, "original");
  s.aendern(a.id, { status: "vorschau", caption: "Bearbeitet", medien: [medium], kunde: "k1", kanaele: ["ig"],
    erstellt: "2020-01-01", wartetAuf: "caption", quellenkarte: { sha256: "hash" } });
  s.archivieren(a.id);
  assert.equal(s.wartend(1), undefined);
  s.aufraeumen();
  const neu = new Auftraege(s.dir);
  assert.equal(neu.liste(1).length, 0);
  assert.equal(neu.liste(2, true).length, 0);
  assert.equal(neu.liste(1, true).length, 1);
  neu.archivieren(a.id, false);
  assert.deepEqual(neu.get(a.id).medien, [medium]);
  assert.deepEqual(neu.get(a.id).kanaele, ["ig"]);
  assert.equal(neu.get(a.id).kunde, "k1");
  assert.equal(fs.readFileSync(medium, "utf8"), "original");
  assert.equal(neu.get(a.id).quellenkarte.sha256, "hash");
});

test("Text zurück stellt Caption, Kanaltexte und Quellenkarte gemeinsam wieder her", (t) => {
  const s = speicher(t), a = s.neu(1);
  s.aendern(a.id, { status: "vorschau", caption: "Alt", captions: { x: "Kurz" }, quellenkarte: { stand: "ungeprüft" } });
  s.aendern(a.id, { caption: "Neu", captions: {}, quellenkarte: { stand: "beschlossen" } });
  s.aendern(a.id, { menueNachricht: 42 });
  const neu = new Auftraege(s.dir);
  const b = neu.rueckgaengig(a.id);
  assert.equal(b.caption, "Alt");
  assert.deepEqual(b.captions, { x: "Kurz" });
  assert.equal(b.quellenkarte.stand, "ungeprüft");
  assert.equal(b.menueNachricht, 42);
  assert.equal(neu.rueckgaengig(a.id), null);
});

test("Versionsspeicher ist begrenzt und begonnene Veröffentlichungen bleiben gesperrt", (t) => {
  const s = speicher(t), a = s.neu(1);
  s.aendern(a.id, { status: "vorschau", caption: "0" });
  for (let i = 1; i <= 15; i++) s.aendern(a.id, { caption: String(i) });
  assert.equal(a.versionen.length, 10);
  s.aendern(a.id, { postizUnklar: "post" });
  assert.throws(() => s.archivieren(a.id), /nicht archiviert/);
  assert.throws(() => s.rueckgaengig(a.id), /nicht zurückgesetzt/);
});

test("Wechsel zwischen Entwürfen beendet alte Texteingaben nur im selben Chat", (t) => {
  const s = speicher(t), a = s.neu(1), b = s.neu(1), fremd = s.neu(2);
  for (const job of [a, b, fremd]) s.aendern(job.id, { status: "vorschau", caption: "Text" });
  s.aendern(a.id, { wartetAuf: "caption" });
  s.aendern(fremd.id, { wartetAuf: "quelle" });
  s.aendern(b.id, { wartetAuf: "quelle" });
  assert.equal(s.wartend(1).id, b.id);
  assert.equal(a.wartetAuf, null);
  s.oeffnen(a.id);
  assert.equal(s.wartend(1), undefined);
  assert.equal(s.wartend(2).id, fremd.id);
});

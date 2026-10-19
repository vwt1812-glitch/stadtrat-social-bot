// Nach vwt1812-glitch/eu-piraten-abstimmungen (test/kontrolle.test.mjs), angepasst an die Aufträge des Bots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { erwartetePosts, faelligeKontrollen, abfragezeitraum, auswerten } from "../src/kontrolle.mjs";

const JETZT = new Date("2026-10-19T09:00:00Z");
const vor = (min) => new Date(JETZT.getTime() - min * 60000).toISOString();
const auftraege = [
  { id: "a1", chatId: 42, status: "geplant", plan: { zeit: vor(60) }, postiz: { post: [{ postId: "a" }, { postId: "b" }], story: [{ postId: "s" }] } },
  { id: "a2", chatId: 42, status: "geplant", plan: { zeit: vor(5) }, postiz: { post: [{ postId: "c" }] } }, // noch in der Karenz
  { id: "a3", chatId: 42, status: "vorschau", plan: { zeit: vor(60) } }, // nie gepostet
  { id: "a4", chatId: 7, status: "gepostet", plan: { zeit: vor(5 * 24 * 60) }, postiz: { post: [{ postId: "e" }] } }, // zu alt
];
const post = (id, state, extra = {}) => ({
  id, state, publishDate: vor(60), content: "<p>Neuer Radweg am Plärrer</p>",
  integration: { providerIdentifier: "x", name: "X Lukas" }, ...extra,
});

test("Kontrolle: nur gepostete Beiträge nach Ablauf der Karenz und nicht älter als 3 Tage", () => {
  const erwartet = erwartetePosts(auftraege);
  assert.deepEqual([...erwartet.keys()].sort(), ["a", "b", "c", "e", "s"]);
  const faellig = faelligeKontrollen(erwartet, { erledigt: { s: true } }, JETZT);
  assert.deepEqual(faellig.map(([id]) => id).sort(), ["a", "b"]);
  const z = abfragezeitraum(faellig, JETZT);
  assert.ok(z.von < new Date(vor(60)) && z.bis > JETZT);
});

test("Kontrolle: hängende Posts einmal melden, Fehler mit Grund, Nachgeholtes bestätigen", () => {
  const kontrolle = { erledigt: {}, gemeldet: {} };
  const faellig = faelligeKontrollen(erwartetePosts(auftraege), kontrolle, JETZT);

  let meldungen = auswerten([post("a", "QUEUE"), post("b", "ERROR", { error: "Invalid token", integration: { providerIdentifier: "bluesky", name: "Bluesky Lukas" } })], faellig, kontrolle, JETZT);
  const [text] = meldungen.get(42);
  assert.match(text, /2 Posts nicht veröffentlicht/);
  assert.match(text, /X Lukas \(x\), geplant .*wartet seit 60 Minuten/);
  assert.match(text, /Bluesky Lukas \(bluesky\).*Fehler – Invalid token/);
  assert.match(text, /neu verbunden/);

  // Beim nächsten Durchlauf nicht noch einmal melden
  assert.equal(auswerten([post("a", "QUEUE"), post("b", "ERROR")], faellig, kontrolle, JETZT).size, 0);

  // Nachgeholt → Bestätigung, danach erledigt
  meldungen = auswerten([post("a", "PUBLISHED"), post("b", "ERROR")], faellig, kontrolle, JETZT);
  assert.match(meldungen.get(42)[0], /✅ Inzwischen veröffentlicht:\n• X Lukas/);
  assert.equal(kontrolle.erledigt.a, true);
});

test("Kontrolle: nur hängende Posts → Hinweis auf den Orchestrator; Gelöschtes still erledigt", () => {
  const kontrolle = {};
  const faellig = faelligeKontrollen(erwartetePosts(auftraege), kontrolle, JETZT);
  const [text] = auswerten([post("a", "QUEUE")], faellig, kontrolle, JETZT).get(42);
  assert.match(text, /einen Post nicht veröffentlicht/);
  assert.match(text, /Orchestrator.*\n.*docker restart postiz/);
  assert.equal(kontrolle.erledigt.b, true);

  // In Postiz auf später verschoben: noch nicht überfällig
  const k2 = {};
  assert.equal(auswerten([post("a", "QUEUE", { publishDate: new Date(JETZT.getTime() + 3600e3).toISOString() }), post("b", "PUBLISHED")], faellig, k2, JETZT).size, 0);
  assert.equal(k2.erledigt.a, undefined);
});

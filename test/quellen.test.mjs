import { test } from "node:test";
import assert from "node:assert/strict";
import { quellenBearbeiten, quellenVorlage, quellenZeilen } from "../src/quellen.mjs";
import { antragVorschlaege } from "../src/redaktion.mjs";

test("Quellenbearbeitung erhält die Dokumentidentität und verändert keine unbelegten Stände", () => {
  const vorher = { sha256: "abc", dateiname: "antrag.pdf", stand: "ungeprüft" };
  const q = quellenBearbeiten("Titel: Neuer Titel\nLink: https://example.org/ris\nDatum: 2026-10-25", vorher);
  assert.equal(q.sha256, "abc");
  assert.equal(q.stand, "ungeprüft");
  assert.equal(vorher.titel, undefined);
  assert.equal(quellenBearbeiten(quellenVorlage(q), q).url, q.url);
  assert.match(quellenZeilen(q, { seiten: [2, 3] }).join("\n"), /2, 3/);
});

test("Bestätigter Verfahrensstand braucht ein gültiges Datum und einen Beleg", () => {
  assert.throws(() => quellenBearbeiten("Stand: beschlossen"), /Standdatum und Beleg/);
  assert.throws(() => quellenBearbeiten("Datum: 2026-02-30"), /JJJJ-MM-TT/);
  assert.throws(() => quellenBearbeiten("Datum: 2026-99-99"), /JJJJ-MM-TT/);
  assert.throws(() => quellenBearbeiten("Stand: wahrscheinlich beschlossen"), /Stand:/);
  assert.throws(() => quellenBearbeiten("Link: javascript:alert(1)"), /HTTP/);
  assert.throws(() => quellenBearbeiten("Titel: A\nTitel: B"), /eindeutigen/);
  const q = quellenBearbeiten("Stand: beschlossen\nStanddatum: 2026-10-25\nBeleg: Niederschrift TOP 4, Seite 2");
  assert.equal(q.stand, "beschlossen");
  assert.throws(() => quellenBearbeiten("Beleg: -", q), /Standdatum und Beleg/);
});

test("PDF-Auszüge behalten den Seitenbezug auch über Seitenwechsel hinweg", () => {
  const pdf = "\nAntrag\nMehr Transparenz für öffentliche Sitzungen\n\f\nBeschlussvorschlag:\nDie Verwaltung soll die technischen Voraussetzungen\f\nfür einen Livestream prüfen und dem Stadtrat berichten.\nBegründung:\nDie Öffentlichkeit soll einfacher an der Arbeit des Stadtrats teilhaben können.";
  const v = antragVorschlaege(pdf);
  assert.deepEqual(v[0].seiten, [1]);
  assert.deepEqual(v.find((p) => p.art === "beschluss").seiten, [2, 3]);
  assert.deepEqual(v.find((p) => p.art === "begruendung").seiten, [3]);
});

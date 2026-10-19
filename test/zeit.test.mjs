import { test } from "node:test";
import assert from "node:assert/strict";
import { parseZeit } from "../src/zeit.mjs";

// Montag, 19.10.2026, 10:00 Uhr
const jetzt = new Date(2026, 9, 19, 10, 0);
const d = (tag, h, min = 0, monat = 9, jahr = 2026) => new Date(jahr, monat, tag, h, min);

test("feste Wörter und relative Angaben", () => {
  assert.deepEqual(parseZeit("jetzt", jetzt), jetzt);
  assert.deepEqual(parseZeit("heute 18 Uhr", jetzt), d(19, 18));
  assert.deepEqual(parseZeit("morgen 9:30", jetzt), d(20, 9, 30));
  assert.deepEqual(parseZeit("Übermorgen um 7", jetzt), d(21, 7));
  assert.deepEqual(parseZeit("in 2 Stunden", jetzt), d(19, 12));
  assert.deepEqual(parseZeit("in 30 min", jetzt), d(19, 10, 30));
});

test("Wochentage", () => {
  assert.deepEqual(parseZeit("Fr 12:00", jetzt), d(23, 12));
  assert.deepEqual(parseZeit("freitag 18.30 uhr", jetzt), d(23, 18, 30));
  assert.deepEqual(parseZeit("Mo 18:00", jetzt), d(19, 18)); // heute, noch nicht vorbei
  assert.deepEqual(parseZeit("Mo. 8:00", jetzt), d(26, 8)); // heute schon vorbei
  assert.deepEqual(parseZeit("nächsten Montag 18:00", jetzt), d(26, 18));
});

test("Datum", () => {
  assert.deepEqual(parseZeit("24.10. 18:00", jetzt), d(24, 18));
  assert.deepEqual(parseZeit("24.10.2026 18.30 Uhr", jetzt), d(24, 18, 30));
  assert.deepEqual(parseZeit("3.1. 9 Uhr", jetzt), d(3, 9, 0, 0, 2027));
  assert.deepEqual(parseZeit("25.10.", jetzt), d(25, 12));
});

test("nur Uhrzeit", () => {
  assert.deepEqual(parseZeit("18:00", jetzt), d(19, 18));
  assert.deepEqual(parseZeit("9:00", jetzt), d(20, 9));
});

test("Unsinn und Vergangenheit", () => {
  assert.equal(parseZeit("irgendwann", jetzt), null);
  assert.equal(parseZeit("heute 8 Uhr", jetzt), null);
  assert.equal(parseZeit("1.1.2020 10:00", jetzt), null);
  assert.equal(parseZeit("31.02. 10:00", jetzt), null);
  assert.equal(parseZeit("25:00", jetzt), null);
});

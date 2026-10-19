import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSrt, formatSrt, parseKorrekturen, wendeKorrekturenAn, umbrechen, aufteilen, zerlegen, zuAss, untertitelPosition, assFarbe, parseBauchbinde } from "../src/untertitel.mjs";

const SRT = `1
00:00:00,000 --> 00:00:02,500
 Hallo, ich bin Lukas Kuffner

2
00:00:02,500 --> 00:00:05,040
und heute geht es um den Haushalt.
`;

test("SRT lesen und schreiben", () => {
  const cues = parseSrt(SRT);
  assert.deepEqual(cues[0], { start: 0, end: 2500, text: "Hallo, ich bin Lukas Kuffner" });
  assert.equal(cues[1].end, 5040);
  assert.deepEqual(parseSrt(formatSrt(cues)), cues);
});

test("Korrekturen gelten für ganze Wörter", () => {
  const k = parseKorrekturen("Kuffner => Küffner\nhaushalt -> Haushalt 2027\nunsinn");
  assert.deepEqual(k, [["Kuffner", "Küffner"], ["haushalt", "Haushalt 2027"]]);
  const cues = wendeKorrekturenAn(parseSrt(SRT), k);
  assert.equal(cues[0].text, "Hallo, ich bin Lukas Küffner");
  assert.equal(cues[1].text, "und heute geht es um den Haushalt 2027.");
  assert.equal(wendeKorrekturenAn([{ start: 0, end: 1, text: "Haushaltsrede" }], k)[0].text, "Haushaltsrede");
});

test("Umbruch in zwei ausgewogene Zeilen", () => {
  assert.deepEqual(umbrechen("kurz", 20), ["kurz"]);
  assert.deepEqual(umbrechen("und heute geht es um den Haushalt", 20), ["und heute geht es", "um den Haushalt"]);
});

test("lange Untertitel werden aufgeteilt", () => {
  const lang = { start: 0, end: 4000, text: "eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf" };
  const teile = aufteilen([lang], 10);
  assert.ok(teile.length > 1);
  assert.equal(teile[0].start, 0);
  assert.equal(teile.at(-1).end, 4000);
  assert.ok(teile.every((t) => t.text.length <= 20));
  assert.equal(teile.map((t) => t.text).join(" "), lang.text);
});

test("einzeilige Häppchen, bevorzugt nach Satzzeichen getrennt", () => {
  assert.deepEqual(zerlegen("Hi, Lukas hier, ich teste jetzt mal", 24), ["Hi, Lukas hier,", "ich teste jetzt mal"]);
  assert.deepEqual(zerlegen("und ihr könnt mitbestimmen,", 24), ["und ihr könnt", "mitbestimmen,"]);
  assert.deepEqual(zerlegen("Donaudampfschifffahrtsgesellschaftskapitän", 24), ["Donaudampfschifffahrtsgesellschaftskapitän"]);
  const ass = zuAss([{ start: 0, end: 3000, text: "Hi, Lukas hier, ich teste jetzt mal" }],
    { breite: 1080, hoehe: 1920, schrift: "Inter", farbe: "#FFFFFF", rand: "#000000", stil: "rand", position: 0.35, zeilen: 1 });
  assert.match(ass, /,,Hi, Lukas hier,\n/);
  assert.match(ass, /,,ich teste jetzt mal\n/);
  assert.doesNotMatch(ass, /\\N/);
});

test("Untertitel-Position nach Format und gewählter Lage", () => {
  const hoch = { breite: 1080, hoehe: 1920, position: 0.33, positionQuer: 0.08 };
  const quer = { ...hoch, breite: 1920, hoehe: 1080 };
  assert.equal(untertitelPosition(hoch), 0.33);
  assert.equal(untertitelPosition(quer), 0.08);
  assert.equal(untertitelPosition({ ...hoch, lage: "oben" }), 0.62);
  assert.equal(untertitelPosition({ ...quer, lage: "mitte" }), 0.42);
  assert.equal(untertitelPosition({ ...hoch, lage: "unbekannt" }), 0.33);
  const ass = zuAss([{ start: 0, end: 1000, text: "Hallo" }], { ...quer, schrift: "Inter", farbe: "#FFFFFF", rand: "#000000", stil: "rand" });
  assert.match(ass, /,2,115,115,86,1$/m); // MarginV = 8 % von 1080
});

test("ASS-Datei", () => {
  assert.equal(assFarbe("#F18A1B"), "&H001B8AF1");
  const ass = zuAss(parseSrt(SRT), { breite: 1080, hoehe: 1920, schrift: "DejaVu Sans", farbe: "#FFFFFF", rand: "#000000", stil: "rand", position: 0.18 });
  assert.match(ass, /PlayResX: 1080\nPlayResY: 1920/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:02\.50,Untertitel,,0,0,0,,Hallo, ich bin\\NLukas Kuffner/);
});

test("Bauchbinde-Eingabe", () => {
  assert.deepEqual(parseBauchbinde("Maria Muster | Vorsitzende Radentscheid"), { name: "Maria Muster", funktion: "Vorsitzende Radentscheid" });
  assert.deepEqual(parseBauchbinde("Maria Muster\nVorsitzende"), { name: "Maria Muster", funktion: "Vorsitzende" });
  assert.deepEqual(parseBauchbinde("Nur Name"), { name: "Nur Name", funktion: "" });
  assert.equal(parseBauchbinde("  | "), null);
});

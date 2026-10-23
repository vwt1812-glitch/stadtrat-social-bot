import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { antragVorschlaege, grafikInhalt, IdeenSpeicher } from "../src/redaktion.mjs";
import { textZeilen, textGrafik } from "../src/grafik-text.mjs";
import { execFileSync } from "node:child_process";
import { untersuche } from "../src/video.mjs";

const antrag = `Antrag
Mehr Transparenz in Stadtratssitzungen

Beschlussvorschlag:
Der Stadtrat möge beschließen, künftig einen öffentlichen Livestream der Sitzungen zu prüfen.

Begründung:
Die Öffentlichkeit soll kommunalpolitische Vorgänge leichter verfolgen können.
Unterschrift
`;

test("Antragsextraktion nutzt ausschließlich Stellen aus dem Ausgangstext", () => {
  const varianten = antragVorschlaege(antrag);
  assert.ok(varianten.length >= 2);
  assert.match(varianten[0].text, /Mehr Transparenz/);
  const beschluss = varianten.find((v) => v.art === "beschluss");
  assert.match(beschluss.text, /Der Stadtrat möge beschließen/);
  assert.doesNotMatch(beschluss.text, /Begründung/);
  assert.ok(varianten.some((v) => v.art === "begruendung"));
  for (const v of varianten) assert.ok(!/wurde beschlossen|ist beschlossen/.test(v.text));
});

test("Scans ohne Text werden nicht als Antrag zusammengefasst", () => {
  assert.throws(() => antragVorschlaege("x"), /zu wenig lesbarer Text/);
});

test("Grafik kennzeichnet gekürzte Texte ohne unsichtbares Weglassen", () => {
  const g = grafikInhalt("Mehr Transparenz!\nDas ist eine im Wortlaut sehr wichtige zusätzliche Erläuterung.", { ausAntrag: true });
  assert.equal(g.titel, "Mehr Transparenz!");
  assert.match(g.etikett, /STADTRATSANTRAG/);
  assert.match(g.beschreibung, /wichtige/);
  assert.ok(textZeilen("Eine politische Botschaft", 20, 4).length > 1);
});

test("Ideenspeicher bleibt über Neustarts erhalten und isoliert Chats", () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "ideen-test-"));
  const s = new IdeenSpeicher(ordner);
  const a = s.speichern(123, "Idee zur Transparenz");
  s.speichern(456, "Anderer Chat");
  assert.equal(new IdeenSpeicher(ordner).liste(123).length, 1);
  assert.equal(s.holen(456, a.id), null);
  assert.equal(s.holen(123, a.id).text, "Idee zur Transparenz");
});

const ffmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("Sharepic und 9:16-Story rendern lokal samt Logo", { skip: !ffmpeg }, async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "redaktion-grafik-"));
  const layout = {
    logo: path.resolve("assets/logos/quer-dunkel.png"),
    logoBreite: 0.44, logoStil: "karte", logoPosition: "oben-links",
    karteFarbe: "#1D1D1B", akzentFarbe: "#F18616", schriftOrdner: path.resolve("assets/fonts"),
  };
  const inhalt = grafikInhalt("Transparenz für Nürnberg\nWir wollen nachvollziehbare Entscheidungen.");
  for (const [format, breite, hoehe] of [["post", 1080, 1350], ["story", 1080, 1920]]) {
    const datei = path.join(ordner, format + ".jpg");
    await textGrafik({ ausgabe: datei, inhalt, layout, format });
    const d = await untersuche(datei);
    assert.deepEqual([d.breite, d.hoehe], [breite, hoehe]);
    assert.ok(fs.statSync(datei).size > 10000);
  }
});

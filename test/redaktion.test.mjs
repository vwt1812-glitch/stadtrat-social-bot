import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { antragVorschlaege, grafikInhalt, IdeenSpeicher } from "../src/redaktion.mjs";
import { textZeilen, textGrafik, textAnimation, logoFuerGrafik, grafikGeometrie, ausgewogeneZeilen } from "../src/grafik-text.mjs";
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

test("Grafik wählt die lesbare Variante des vorhandenen PIRATEN-&-Humanisten-Logos", () => {
  assert.equal(path.basename(logoFuerGrafik("assets/logos/quer-hell.png", "dunkel")), "quer-dunkel.png");
  assert.equal(path.basename(logoFuerGrafik("assets/logos/quer-dunkel.png", "hell")), "quer-hell.png");
  assert.equal(path.basename(logoFuerGrafik("assets/logos/quer-dunkel.png", "orange")), "quer-hell.png");
  assert.equal(logoFuerGrafik("/mein/eigenes-logo.png", "dunkel"), "/mein/eigenes-logo.png");
});

test("Kurze Aussagen werden mittig und ausgewogen angeordnet", () => {
  const plan = grafikGeometrie({ format: "post", titelHoehe: 254, textHoehe: 0, logoHoehe: 154 });
  assert.ok(plan.titelY > 450 && plan.titelY < 690, String(plan.titelY));
  assert.ok(plan.titelY + 254 < plan.logoY - 95);
  const story = grafikGeometrie({ format: "story", titelHoehe: 254, textHoehe: 0, logoHoehe: 154 });
  assert.ok(story.titelY > 680 && story.titelY < 1060);
  assert.ok(story.logoUnten <= 1920 * 0.8);
  const zeilen = ausgewogeneZeilen("CSU macht dumme Dinge!", 16);
  assert.deepEqual(zeilen.flatMap((z) => z.split(" ")), ["CSU", "macht", "dumme", "Dinge!"]);
});

test("Regression für das gemeldete Sharepic: große Aussage mittig, Logo mit weißer Schrift", { skip: !ffmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redaktion-kontrast-"));
  const datei = path.join(dir, "csu.jpg");
  await textGrafik({
    ausgabe: datei, inhalt: grafikInhalt("CSU macht dumme Dinge!"),
    // Absichtlich die im Fehlerbild unlesbare schwarze Variante konfigurieren.
    layout: {
      logo: path.resolve("assets/logos/quer-hell.png"), logoBreite: 0.48,
      logoStil: "karte", logoPosition: "oben-links",
      karteFarbe: "#1D1D1B", akzentFarbe: "#F18616",
      schriftOrdner: path.resolve("assets/fonts"),
    },
  });
  const d = await untersuche(datei);
  assert.deepEqual([d.breite, d.hoehe], [1080, 1350]);
  // Im unteren linken Logobereich müssen weiße Schriftpixel erkennbar sein.
  // Die orange Fläche allein darf diesen Test nicht erfüllen.
  const crop = execFileSync("ffmpeg", [
    "-v", "error", "-i", datei, "-vf", "crop=580:175:105:1070",
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { maxBuffer: 2 * 1024 * 1024 });
  let hell = 0;
  for (let i = 0; i < crop.length; i += 3) {
    if (crop[i] > 180 && crop[i + 1] > 180 && crop[i + 2] > 180) hell++;
  }
  assert.ok(hell > 900, `Im Logo fehlen weiße Textpixel (gefunden: ${hell})`);
});

test("Animierte Story und Feed-Grafik lassen sich als MP4 rendern", { skip: !ffmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redaktion-animation-"));
  const layout = {
    logo: path.resolve("assets/logos/quer-dunkel.png"), logoBreite: 0.40,
    karteFarbe: "#1D1D1B", akzentFarbe: "#F18616",
    schriftOrdner: path.resolve("assets/fonts"),
  };
  for (const [format, h] of [["post", 1350], ["story", 1920]]) {
    const output = path.join(dir, format + ".mp4");
    await textAnimation({
      ausgabe: output, inhalt: grafikInhalt("CSU macht dumme Dinge!"), layout, format, dauer: 2,
    });
    const meta = await untersuche(output);
    assert.equal(meta.breite, 1080);
    assert.equal(meta.hoehe, h);
    assert.ok(meta.dauer >= 1.9 && meta.dauer <= 2.1);
    assert.ok(fs.statSync(output).size > 2000);
  }
});

test("Animation zeigt nach und nach Überschrift und Logo, statt nur das gesamte Bild zu zoomen", { skip: !ffmpeg }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stufen-animation-"));
  const out = path.join(dir, "stufen.mp4");
  const layout = {
    logo: path.resolve("assets/logos/quer-dunkel.png"),
    logoBreite: 0.40, karteFarbe: "#1D1D1B", akzentFarbe: "#F18616",
    schriftOrdner: path.resolve("assets/fonts"),
  };
  await textAnimation({ ausgabe: out, inhalt: grafikInhalt("CSU macht dumme Dinge!"), layout, format: "story", dauer: 5 });
  const probe = (sekunde, filter) => execFileSync("ffmpeg", [
    "-v", "error", "-ss", String(sekunde), "-i", out, "-vf", filter,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  const nichtSchwarz = (buffer) => {
    let count = 0;
    for (let i = 0; i < buffer.length; i += 3) {
      if (buffer[i] > 145 && buffer[i + 1] > 145 && buffer[i + 2] > 145) count++;
    }
    return count;
  };
  const titelCrop = "crop=880:270:100:650";
  const logoCrop = "crop=530:150:100:1330";
  assert.ok(nichtSchwarz(probe(0.15, titelCrop)) < 100);
  assert.ok(nichtSchwarz(probe(1.6, titelCrop)) > 1000);
  assert.ok(nichtSchwarz(probe(1.6, logoCrop)) < 100);
  assert.ok(nichtSchwarz(probe(4.0, logoCrop)) > 1000);
});

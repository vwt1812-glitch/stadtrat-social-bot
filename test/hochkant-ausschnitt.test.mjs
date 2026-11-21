import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ausschnittAktiv, ausschnittAktivFilter, ausschnittHinweis, ausschnittKommandos, ausschnittX, gesichterImAusschnitt, hochkantAusschnitt } from "../src/hochkant-ausschnitt.mjs";
import { ausfuehren, rendern, storyLayout, untersuche } from "../src/video.mjs";
import { untertitelPosition,untertitelRahmen } from "../src/untertitel.mjs";
import { sichererHochkantAusschnitt } from "../src/plattform-video.mjs";

const original = { breite: 1920, hoehe: 1080 };
const funde = (x = 0.65) => ({ bilder: 24, alleGesichter: true,
  gesichter: Array.from({ length: 24 }, (_, t) => ({ t, x: x + (t % 3) * 0.005, y: 0.25, w: 0.09, h: 0.17 })) });

test("Fester 9:16-Ausschnitt folgt einer seitlich stehenden Person mit Kopfrand", () => {
  const f = funde();
  const a = hochkantAusschnitt(original, f);
  assert.ok(a.x > original.breite / 2);
  assert.ok(Math.abs(a.breite / a.hoehe - 9 / 16) < 0.002);
  assert.equal(a.y, 0);
  assert.equal(a.hoehe, original.hoehe);
  for (const n of Object.values(a)) assert.equal(n % 2, 0);
  for (const g of f.gesichter) {
    assert.ok(a.x <= (g.x - g.w * 0.18) * original.breite);
    assert.ok(a.x + a.breite >= (g.x + g.w * 1.18) * original.breite);
  }
  const layout = storyLayout({ gesichter: f.gesichter, positionFest: 0.6 }, original, { breite: 1080, hoehe: 1920 }, a);
  assert.equal(layout.bild, null);
  assert.ok(layout.positionFest>=0.35);
  assert.ok(layout.gesichter.every((g) => g.x > 0 && g.x + g.w < 1));
  assert.equal(layout.gesichter[0].t, 0);
});

for (const [name, anpassen] of [
  ["keine Funde", () => null],
  ["alte Erkennung nur des größten Gesichts", (f) => ({ ...f, alleGesichter: false })],
  ["zu wenige Probebilder", (f) => ({ ...f, bilder: 2 })],
  ["seltene Erkennung", (f) => ({ ...f, gesichter: f.gesichter.slice(0, 21) })],
  ["mehrere Treffer ersetzen keine zeitliche Abdeckung", (f) => ({ ...f, gesichter: f.gesichter.map((g) => ({ ...g, t: 0 })) })],
  ["zwei weit getrennte Personen", (f) => ({ ...f, gesichter: [...f.gesichter, { ...f.gesichter[0], x: 0.1, w: 0.06 }] })],
  ["starke Bewegung", (f) => ({ ...f, gesichter: f.gesichter.map((g) => ({ ...g, x: g.t % 2 ? 0.1 : 0.7 })) })],
  ["Gesicht reicht außerhalb des Originalbilds", (f) => ({ ...f, gesichter: f.gesichter.map((g) => ({ ...g, y: 0.9 })) })],
  ["ungültige Koordinaten", (f) => ({ ...f, gesichter: [{ ...f.gesichter[0], x: NaN }, ...f.gesichter.slice(1)] })],
]) test(`Vollständiges Bild bei: ${name}`, () => assert.equal(hochkantAusschnitt(original, anpassen(funde())), null));

test("Natives Hochkant und quadratische Aufnahmen bleiben unbeschnitten", () => {
  assert.equal(hochkantAusschnitt({ breite: 1080, hoehe: 1920 }, funde()), null);
  assert.equal(hochkantAusschnitt({ breite: 1080, hoehe: 1080 }, funde()), null);
});

const redner = JSON.parse(await fs.readFile(new URL("./fixtures/hochkant-rednerpult.json", import.meta.url)));
const rednerMasse = { ...original, dauer: 12 };
test("Synthetisches Rednerpultvideo: Kopfneigung und Seitwärtsbewegung erlauben ruhige Nachführung", () => {
  const a = hochkantAusschnitt(rednerMasse, redner);
  assert.ok(a?.punkte?.length);
  assert.equal(a.ab, 0.5); // Ohne Gesichtserkennung bleibt der Anfang vollständig.
  assert.equal(a.bis, 11.5);
  assert.match(ausschnittHinweis(redner,a), /ab 0:01; davor vollständiges Bild/);
  assert.match(ausschnittHinweis(null,null), /nicht verfügbar/);
  assert.match(ausschnittHinweis({ bilder: 24, gesichter: redner.gesichter.slice(0,9) },null), /9 von 24/);
  for (const g of redner.gesichter) {
    const x = ausschnittX(a, g.t);
    assert.ok(x <= (g.x - g.w * 0.18) * original.breite);
    assert.ok(x + a.breite >= (g.x + g.w * 1.18) * original.breite);
  }
  const kommandos = ausschnittKommandos(a).split("\n").map((zeile) => {
    const [, t, expr] = zeile.match(/^([\d.]+) crop@hochkant x '(.+)';$/);
    return { t: Number(t), expr };
  });
  const clip = (n, min, max) => Math.max(min, Math.min(max, n));
  for (const t of [0, 0.5, 2, 5, 10, 11.5, 12, 20]) {
    const aktiv = kommandos.filter((k) => k.t <= t).at(-1) ?? kommandos[0];
    const evalFilter = new Function("t", "clip", "pow", `return ${aktiv.expr};`);
    assert.ok(Math.abs(evalFilter(t, clip, Math.pow) - ausschnittX(a,t)) < 0.001);
  }
});

test("Neue Analyse verwirft Zeitlücken und unzuverlässige Zeitangaben", () => {
  const f = structuredClone(redner);
  const loch = [5, 5.5, 6, 6.5, 7];
  f.gesichter = f.gesichter.filter((g) => !loch.includes(g.t));
  // Selbst eine insgesamt ausreichende Trefferquote macht eine lange Lücke nicht sicher.
  f.bilder = 19;
  f.zeiten = f.zeiten.filter((t) => !loch.includes(t));
  assert.equal(hochkantAusschnitt(rednerMasse, f), null);
  assert.equal(hochkantAusschnitt(rednerMasse, { ...redner, zeiten: [0] }), null);
});

test("Neue Analyse führt einen abrupten Bildsprung nicht als Kamerafahrt aus", () => {
  const f = funde();
  f.version = 3;
  f.dicht = true;
  f.zeiten = f.gesichter.map((g) => g.t / 10);
  f.gesichter = f.gesichter.map((g,i) => ({ ...g, t: f.zeiten[i], x: i < 12 ? 0.15 : 0.7 }));
  assert.equal(hochkantAusschnitt({ ...original, dauer: 2.4 }, f), null);
});

test("Wenige weit verteilte Bilder erlauben keine Kamerafahrt zwischen unbekannten Bewegungen", () => {
  const f = structuredClone(redner);
  f.dicht = false;
  f.zeiten = f.zeiten.map((t) => t * 30);
  f.gesichter = f.gesichter.map((g) => ({ ...g, t: g.t * 30 }));
  assert.equal(hochkantAusschnitt({ ...original, dauer: 360 }, f), null);
});

const ruhigeAufnahme = () => {
  const zeiten = Array.from({ length: 81 }, (_, i) => i / 2);
  return { bilder: zeiten.length, version: 3, dicht: true, alleGesichter: true, zeiten,
    gesichter: zeiten.map((t) => ({ t, x: 0.3, y: 0.25, w: 0.1, h: 0.2 })) };
};
const langeMasse = { ...original, dauer: 40.1 };

test("Kleine Kopfbewegungen bei ausreichend Platz lösen keine Kamerafahrt aus", () => {
  const f=ruhigeAufnahme();
  f.gesichter=f.gesichter.filter(g=>g.t>0).map((g,i)=>({...g,x:g.t<=2?0.75:0.3+0.035*Math.sin(i*1.7)}));
  const a=hochkantAusschnitt(langeMasse,f);
  assert.ok(a);
  const x=Array.from({length:300},(_,i)=>ausschnittX(a,5+i/10));
  assert.ok(Math.max(...x)-Math.min(...x)<0.001);
});

test("Langsame Kamerafahrt behält ihre Geschwindigkeit über Messpunkte hinweg und schwingt nicht über", () => {
  const f=ruhigeAufnahme();
  f.gesichter=f.gesichter.map(g=>({...g,x:0.15+0.5*g.t/40+0.005*Math.sin(g.t*4)}));
  const a=hochkantAusschnitt(langeMasse,f);
  assert.ok(a?.punkte?.length);
  assert.ok(a.punkte.some(p=>Math.abs(p.v)>0.1));
  for(let i=1;i<a.punkte.length-1;i++) {
    const p=a.punkte[i],eps=0.0001;
    const links=(ausschnittX(a,p.t)-ausschnittX(a,p.t-eps))/eps;
    const rechts=(ausschnittX(a,p.t+eps)-ausschnittX(a,p.t))/eps;
    assert.ok(Math.abs(links-rechts)<0.05);
    const nach=a.punkte[i+1];
    for(const u of [0.25,0.5,0.75]) {
      const x=ausschnittX(a,p.t+u*(nach.t-p.t));
      assert.ok(x>=Math.min(p.x,nach.x)-0.001&&x<=Math.max(p.x,nach.x)+0.001);
    }
  }
  for(const g of f.gesichter) {
    const x=ausschnittX(a,g.t);
    assert.ok(x<=(g.x-g.w*0.18)*original.breite+0.001);
    assert.ok(x+a.breite>=(g.x+g.w*1.18)*original.breite-0.001);
  }
});

test("Plattform-Freizonen haben Vorrang vor tiefer Lage; manuelle obere Lage bleibt wählbar", () => {
  const a=hochkantAusschnitt(original,funde());
  const masse={breite:1080,hoehe:1920};
  const layout=storyLayout({position:0.35},original,masse,a);
  assert.ok(untertitelPosition({...masse,...layout})>=0.35);
  assert.equal(untertitelPosition({...masse,...layout,lage:"oben"}),0.62);
  assert.equal(untertitelPosition({...masse,position:0.35}),0.35);
});

test("Gesenkter Kopf behält bildfüllenden Ausschnitt und bekommt Text außerhalb des Mundes",()=>{
  const masse={breite:1080,hoehe:1920};
  const f=funde();f.gesichter=f.gesichter.map(g=>({...g,x:0.3,y:0.42,w:0.2,h:0.4}));
  const basis={position:0.35,zeilen:1,gesichter:f.gesichter};
  const a=sichererHochkantAusschnitt(original,f,masse,basis);
  const layout=storyLayout(basis,original,masse,a);
  const p=untertitelPosition({...masse,...layout});
  assert.ok(p>=0.35);
  const r=untertitelRahmen({...masse,...layout});
  const unten=(1-p)*1920,oben=unten-r.textHoehe;
  assert.equal(a.darstellung,undefined);
  assert.ok(layout.gesichter.every(g=>unten<=(g.y+0.55*g.h)*1920||oben>=(g.y+1.05*g.h)*1920));
});

test("Kamera am Anfang ausrichten: kurzer Schwenk verwirft nur den Anfang", () => {
  const f = ruhigeAufnahme();
  f.gesichter = f.gesichter.filter(g => g.t > 0).map(g => ({ ...g, x: g.t <= 2 ? 0.75 : 0.3 }));
  const a = hochkantAusschnitt(langeMasse,f);
  assert.ok(a);
  assert.equal(a.ab,2.5);
  assert.equal(ausschnittAktiv(a,1),false);
  assert.equal(ausschnittAktiv(a,30),true);
});

test("Langer Anfang ohne Person blockiert den gut erkannten Rest nicht", () => {
  const f = ruhigeAufnahme();
  f.gesichter = f.gesichter.filter(g => g.t >= 12);
  const a = hochkantAusschnitt(langeMasse,f);
  assert.ok(a);
  assert.equal(a.ab,12);
  assert.equal(ausschnittAktiv(a,6),false);
  assert.equal(ausschnittAktiv(a,30),true);
});

test("Kamera wird anfangs zu hoch oder tief gehalten: erst nach dem Ausrichten zuschneiden", () => {
  const f=ruhigeAufnahme();
  f.gesichter=f.gesichter.map(g=>({...g,y:g.t<=4?0.01:g.y}));
  const a=hochkantAusschnitt(langeMasse,f);
  assert.ok(a);
  assert.equal(a.ab,4.5);
  assert.equal(ausschnittAktiv(a,2),false);
  assert.equal(ausschnittAktiv(a,20),true);
});

for (const art of ["Wackler", "Erkennungslücke", "zwei entfernte Personen"]) test(`${art} mitten im Video: nur die Problemstelle bleibt vollständig`, () => {
  const f = ruhigeAufnahme();
  if(art === "Wackler") f.gesichter = f.gesichter.map(g => ({ ...g, x: g.t === 20 ? 0.8 : g.x }));
  if(art === "Erkennungslücke") f.gesichter = f.gesichter.filter(g => g.t !== 20 && g.t !== 20.5);
  if(art === "zwei entfernte Personen") f.gesichter.push({ t:20, x:0.8, y:0.25, w:0.09, h:0.2 });
  const a = hochkantAusschnitt(langeMasse,f);
  assert.ok(a);
  assert.equal(a.bereiche.length,2);
  assert.equal(ausschnittAktiv(a,10),true);
  assert.equal(ausschnittAktiv(a,20),false);
  assert.equal(ausschnittAktiv(a,30),true);
  assert.match(ausschnittAktivFilter(a), /\+between/);
  assert.match(ausschnittHinweis(f,a), /zwischendurch vollständiges Bild/);
  const g=f.gesichter.find(g=>g.t===20) ?? { t:20,x:0.3,y:0.25,w:0.1,h:0.2 };
  const [neu]=gesichterImAusschnitt([g],original,a);
  assert.equal(neu.x,g.x);
  assert.ok(neu.h<g.h);
});

test("Anhaltendes starkes Wackeln ohne ruhige Abschnitte bleibt vollständig", () => {
  const f=ruhigeAufnahme();
  f.gesichter=f.gesichter.map((g,i)=>({ ...g,x:i%2?0.15:0.75 }));
  assert.equal(hochkantAusschnitt(langeMasse,f),null);
});

const ffmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("Echtes bewegtes Motiv bleibt auch zwischen den Messpunkten vollständig im Ausschnitt", { skip: !ffmpeg }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crop-bewegung-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const eingabe = path.join(dir, "bewegung.mp4"), ausgabe = path.join(dir, "fertig.mp4");
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=10:d=6.1",
    "-f", "lavfi", "-i", "color=c=red:s=40x40:r=10:d=6.1", "-filter_complex",
    "[0:v][1:v]overlay=x='80+60*sin(t*2*PI/6)':y=70", "-c:v", "libx264", "-pix_fmt", "yuv420p", eingabe]);
  const zeiten = Array.from({ length: 13 }, (_, i) => i / 2);
  const f = { bilder: 13, version: 3, dicht: true, alleGesichter: true, zeiten,
    gesichter: zeiten.map((t) => ({ t, x: (80+60*Math.sin(t*2*Math.PI/6))/320, y: 70/180, w: 40/320, h: 40/180 })) };
  const quelle = { breite: 320, hoehe: 180, dauer: 6.1 };
  const a = hochkantAusschnitt(quelle, f);
  assert.ok(a?.punkte);
  await rendern({ eingabe, ausgabe, story: true, masse: { breite: 180, hoehe: 320, dauer: 6.1 },
    layout: storyLayout({}, quelle, { breite: 180, hoehe: 320 }, a), video: { encoder: "libx264", preset: "ultrafast", crf: "18" } });
  const raw = await ausfuehren("ffmpeg", ["-v", "error", "-i", ausgabe, "-vf", "scale=90:160", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { binaer: true });
  const frame = 90*160*3;
  for (let n=0; n<60; n++) {
    let links=90, rechts=-1;
    for (let y=0;y<160;y++) for(let x=0;x<90;x++) {
      const p=n*frame+(y*90+x)*3;
      if(raw[p]>raw[p+2]+80) { links=Math.min(links,x); rechts=Math.max(rechts,x); }
    }
    assert.ok(links>1 && rechts<88 && rechts-links>=33, `Bild ${n}: Motiv von ${links} bis ${rechts}`);
  }
});

test("Echtes Video: Ausschnitt füllt das Bild, Fallback erhält Seiten, Ton und Original bleiben erhalten", { skip: !ffmpeg }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-crop-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const eingabe = path.join(dir, "original.mp4");
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i",
    "color=c=blue:s=640x360:r=5:d=1,drawbox=x=300:y=0:w=280:h=360:color=red:t=fill",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", eingabe]);
  const vorher = await fs.readFile(eingabe);
  const quelle = await untersuche(eingabe);
  for (const schneiden of [true, false, "bewegung", "pausen"]) {
    const a = schneiden ? sichererHochkantAusschnitt(quelle, funde()) : null;
    if (schneiden === "bewegung") Object.assign(a, { ab: 0.25, bis: 0.8,
      punkte: [{ t: 0.25, x: 320 }, { t: 0.8, x: 370 }] });
    if (schneiden === "pausen") Object.assign(a, { ab:0, bis:1,
      bereiche:[{ab:0,bis:0.2},{ab:0.6,bis:1}], punkte:[{t:0,x:320},{t:1,x:370}] });
    const masse = { breite: 180, hoehe: 320, dauer: 1 };
    const ausgabe = path.join(dir, `${schneiden}.mp4`);
    await rendern({ eingabe, ausgabe, masse, story: true,
      layout: storyLayout({ gesichter: funde().gesichter }, quelle, masse, a),
      video: { encoder: "libx264", preset: "ultrafast", crf: "18" } });
    const m = await untersuche(ausgabe);
    assert.deepEqual([m.breite, m.hoehe, m.hatTon], [180, 320, true]);
    assert.ok(Math.abs(m.dauer - 1) < 0.2);
    for (const t of (schneiden === "bewegung" ? [0, 0.6] : schneiden === "pausen" ? [0,0.4,0.6] : [0])) {
      for (const y of [6,160,310]) {
      const rgb = await ausfuehren("ffmpeg", ["-v", "error", "-ss", String(t), "-i", ausgabe, "-vf", `crop=2:2:4:${y},scale=1:1`,
        "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { binaer: true });
      const rot = schneiden && ausschnittAktiv(a,t);
      assert.ok(rot ? rgb[0] > rgb[2] + 80 : rgb[2] > rgb[0] + 80, `${schneiden}, ${t}, y=${y}: ${[...rgb]}`);
      }
    }
  }
  assert.deepEqual(await fs.readFile(eingabe), vorher);
});

test("Telegram: automatische Auswahl, vollständiges Bild und erneute Auswahl verwenden dieselbe Prüfung", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "smart-crop-flow-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, ["--experimental-test-module-mocks",
    fileURLToPath(new URL("./fixtures/hochkant-ausschnitt-flow.mjs", import.meta.url)), dir],
    { timeout: 22000, stdio: "pipe" });
});

test("Telegram: unterbrochene Neuberechnung wird nach Neustart mit demselben Entwurf fortgesetzt", async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"crop-fortsetzen-"));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  execFileSync(process.execPath,["--experimental-test-module-mocks",fileURLToPath(new URL("./fixtures/hochkant-ausschnitt-flow.mjs",import.meta.url)),dir,"fortsetzen"],
    {timeout:22000,stdio:"pipe"});
});

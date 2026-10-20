// Alles, was ffmpeg/ffprobe macht: Video untersuchen, Ton für Whisper
// herauslösen, Logo + Untertitel einbrennen.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { untertitelGroesse, untertitelPosition } from "./untertitel.mjs";

export function ausfuehren(befehl, args, { cwd, binaer = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(befehl, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-8000)));
    p.on("error", (e) => reject(new Error(`${befehl} nicht gefunden oder nicht startbar: ${e.message}`)));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`${befehl} ist fehlgeschlagen (Code ${code}):\n${err.trim().split("\n").slice(-6).join("\n")}`));
      const daten = Buffer.concat(out);
      resolve(binaer ? daten : daten.toString());
    });
  });
}

/** Maße so, wie das Video angezeigt wird (Drehung von Handyvideos berücksichtigt). */
export async function untersuche(datei) {
  const json = JSON.parse(
    await ausfuehren("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", datei]),
  );
  const video = json.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("Die Datei enthält keine Videospur.");
  const drehung = Math.abs(
    Number(video.tags?.rotate ?? video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0),
  );
  const gedreht = drehung === 90 || drehung === 270;
  return {
    breite: gedreht ? video.height : video.width,
    hoehe: gedreht ? video.width : video.height,
    dauer: Number(json.format.duration ?? video.duration ?? 0),
    hatTon: json.streams.some((s) => s.codec_type === "audio"),
  };
}

export async function tonFuerWhisper(video, wav) {
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
}

// ---------- Grafiken: Logo-Karte und Bauchbinde ----------
// Gestaltet für 1080 px kurze Seite, alles andere wird darauf umgerechnet.

const skala = (masse) => Math.min(masse.breite, masse.hoehe) / 1080;
const pxl = (n, s) => Math.max(1, Math.round(n * s));
const gerade = (n) => Math.round(n / 2) * 2;
const ffFarbe = (farbe) => `0x${farbe.replace("#", "")}`;

/**
 * Ränder, die die Bedienelemente von Reels/TikTok frei lassen: Hochkant-Videos oben 14 %
 * (Reiter, Kamera, Suche). Fotos haben keine solche Leiste, dort genügen 7,3 %.
 */
function raender(masse, video = true) {
  const rand = Math.round(Math.min(masse.breite, masse.hoehe) * 0.05);
  const hochkant = masse.hoehe > masse.breite;
  return { rand, oben: hochkant ? Math.round(masse.hoehe * (video ? 0.14 : 0.073)) : rand };
}

/**
 * Filtergraph für eine abgerundete Fläche mit weichem Schatten auf transparentem Grund.
 * Die Fläche liegt im Bild bei (x, y); `breite`/`hoehe` sind die Maße des ganzen Bildes.
 */
export function karteFilter({ w, h, r, farbe, deckkraft = 0.92, schatten, label }) {
  const m = schatten * 2;
  const breite = w + 2 * m;
  const hoehe = h + 2 * m;
  const a = Math.round(deckkraft * 255);
  const cx = m + w / 2;
  const cy = m + h / 2;
  const alpha = `if(between(X,${m},${m + w - 1})*between(Y,${m},${m + h - 1}),` +
    `if(gt(abs(X-${cx}),${w / 2 - r})*gt(abs(Y-${cy}),${h / 2 - r}),` +
    `if(lte(hypot(abs(X-${cx})-${w / 2 - r},abs(Y-${cy})-${h / 2 - r}),${r}),${a},0),${a}),0)`;
  const versatz = Math.round(schatten / 2);
  const graph = `color=c=${ffFarbe(farbe)}:s=${breite}x${hoehe}:d=1,format=rgba,` +
    `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}',split[${label}k1][${label}k2];` +
    `[${label}k2]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.45,boxblur=${schatten}:2[${label}sh];` +
    `[${label}sh][${label}k1]overlay=0:-${versatz}[${label}]`;
  return { graph, breite, hoehe, x: m, y: m - versatz };
}

/** Breite eines Textes in Pixeln, gerendert mit ffmpeg drawtext. */
export async function textBreite(textdatei, schrift, groesse) {
  const w = Math.round(groesse * 40);
  const h = Math.round(groesse * 1.6);
  const raw = await ausfuehren("ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${w}x${h}:d=1`,
    "-vf", `drawtext=fontfile=${schrift}:textfile=${path.basename(textdatei)}:fontsize=${groesse}:fontcolor=white:x=0:y=0`,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-",
  ], { cwd: path.dirname(textdatei), binaer: true });
  let max = 0;
  for (let y = 0; y < h; y++) for (let x = max; x < w; x++) if (raw[y * w + x] > 40) max = x + 1;
  return max;
}

/**
 * Logo als fertige Grafik: auf dunkler Karte mit Schatten und farbigem Akzent (Stil „karte“)
 * oder frei. Gibt Datei und Position im Video zurück.
 */
export async function logoGrafik({ layout, masse, ordner, video = true }) {
  try {
    await fs.access(layout.logo);
  } catch {
    throw new Error(`Logo nicht gefunden: ${layout.logo}`);
  }
  const s = skala(masse);
  const logo = await untersuche(layout.logo);
  const lw = gerade(Math.min(masse.breite, masse.hoehe) * layout.logoBreite);
  const lh = gerade(lw * logo.hoehe / logo.breite);
  const ziel = path.join(ordner, "logo-grafik.png");
  let grafik;

  if (layout.logoStil === "frei") {
    await ausfuehren("ffmpeg", ["-y", "-v", "error", "-i", layout.logo, "-vf", `scale=${lw}:${lh}`, "-frames:v", "1", ziel]);
    grafik = { breite: lw, hoehe: lh, x: 0, y: 0, w: lw, h: lh };
  } else {
    const px = pxl(38, s);
    const py = pxl(30, s);
    const w = lw + 2 * px;
    const h = lh + 2 * py;
    const r = pxl(30, s);
    const k = karteFilter({ w, h, r, farbe: layout.karteFarbe, schatten: pxl(16, s), label: "karte" });
    let graph = `${k.graph};[0]scale=${lw}:${lh}[l];[karte][l]overlay=${k.x + px}:${k.y + py}`;
    if (layout.akzentFarbe) {
      const ah = pxl(7, s);
      graph += `,drawbox=x=${k.x + r}:y=${k.y + h - ah}:w=${w - 2 * r}:h=${ah}:color=${ffFarbe(layout.akzentFarbe)}@1:t=fill`;
    }
    await ausfuehren("ffmpeg", ["-y", "-v", "error", "-i", layout.logo, "-filter_complex", graph, "-frames:v", "1", ziel]);
    grafik = { breite: k.breite, hoehe: k.hoehe, x: k.x, y: k.y, w, h };
  }

  // Position der sichtbaren Fläche im Video, dann auf die Bildecke mit Schatten umrechnen
  const { rand, oben } = raender(masse, video);
  let sichtbarX = layout.logoPosition.includes("rechts") ? masse.breite - rand - grafik.w : rand;
  let sichtbarY = layout.logoPosition.includes("unten") ? masse.hoehe - rand - grafik.h : oben;
  // Story-Fassung eines Querformats: mittig über dem Bild, wenn darüber genug Platz ist
  const ueberBild = layout.bild ? layout.bild.oben - pxl(48, s) - grafik.h : -1;
  if (ueberBild >= oben) {
    sichtbarX = Math.round((masse.breite - grafik.w) / 2);
    sichtbarY = ueberBild;
  }
  return { datei: ziel, x: sichtbarX - grafik.x, y: sichtbarY - grafik.y };
}

/**
 * Bauchbinde mit Name und Funktion, Stil nach `layout.bauchbindeStil`:
 * „balken“ (Standard) oder „karte“. Gibt Grafik(en) und Position im Video zurück.
 */
export async function bauchbindeGrafik(o) {
  return o.layout.bauchbindeStil === "karte" ? karteBauchbinde(o) : balkenBauchbinde(o);
}

/**
 * Stil „balken“: schräger oranger Balken mit dem Namen, davor ein schwarzer mit der Funktion,
 * unten links unter den Untertiteln (passen sie dort nicht hin: darüber). Zwei Grafiken gleicher
 * Größe, damit beim Einwischen der schwarze Balken etwas später kommen kann.
 */
export async function balkenBauchbinde({ name, funktion, layout, masse, ordner }) {
  const s = skala(masse);
  const fett = path.join(layout.schriftOrdner, "Inter-Bold.otf");
  const nameDatei = path.join(ordner, "bauchbinde-name.txt");
  const funktionDatei = path.join(ordner, "bauchbinde-funktion.txt");
  await fs.writeFile(nameDatei, name);
  await fs.writeFile(funktionDatei, funktion ?? "");
  const gName = pxl(58, s);
  const gFunktion = pxl(30, s);

  // Oranger Balken: Höhe ho, schräge Kanten (oben um schraeg nach rechts versetzt)
  const ho = pxl(102, s);
  const schraeg = pxl(15, s);
  const innen = pxl(27, s);
  const { rand } = raender(masse);
  const maxBreite = masse.breite - 2 * rand;
  const wo = Math.min(await textBreite(nameDatei, fett, gName) + 2 * innen + schraeg, maxBreite);
  // Schwarzer Balken: überlappt den orangen unten, leicht nach rechts versetzt
  const hb = pxl(42, s);
  const by = ho - pxl(20, s);
  const bx = pxl(35, s);
  const sb = Math.round((schraeg * hb) / ho);
  const innenB = pxl(18, s);
  const wb = funktion
    ? Math.min(Math.max(await textBreite(funktionDatei, fett, gFunktion) + 2 * innenB + sb, Math.round(wo * 0.7)), maxBreite - bx)
    : 0;
  const breite = gerade(Math.max(wo, bx + wb));
  const hoehe = gerade(funktion ? by + hb : ho);

  // Flächen 4-fach überabgetastet zeichnen, damit die schrägen Kanten glatt werden
  const k = 4;
  const flaeche = (farbe, innerhalb) =>
    `color=c=${ffFarbe(farbe)}:s=${breite * k}x${hoehe * k}:d=1,format=rgba,` +
    `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*${innerhalb}',scale=${breite}:${hoehe}:flags=area`;
  const xs = `(X/${k})`;
  const ys = `(Y/${k})`;
  const orange = `lt(${ys},${ho})*gte(${xs},${schraeg}*(1-${ys}/${ho}))*lt(${xs},${wo}-${schraeg}*${ys}/${ho})`;
  const schwarz = `gte(${ys},${by})*lt(${ys},${by + hb})*gte(${xs},${bx}+${sb}*(1-(${ys}-${by})/${hb}))*lt(${xs},${bx + wb}-${sb}*(${ys}-${by})/${hb})`;
  // y so, dass die Großbuchstaben mittig im Balken stehen (Versalhöhe von Inter ≈ 0,73 × Schriftgröße)
  const mittig = (oben, h, g) => `${Math.round(oben + h / 2 + 0.365 * g)}-ascent`;

  const dateien = { orange: path.join(ordner, "bauchbinde-orange.png"), schwarz: null };
  await ausfuehren("ffmpeg", [
    "-y", "-v", "error", "-filter_complex",
    `${flaeche(layout.akzentFarbe || "#F18616", orange)},` +
      `drawtext=fontfile=${fett}:textfile=${path.basename(nameDatei)}:fontsize=${gName}:fontcolor=white:` +
      `x=${Math.round(schraeg / 2 + innen)}:y=${mittig(0, ho, gName)}`,
    "-frames:v", "1", path.basename(dateien.orange),
  ], { cwd: ordner });
  if (funktion) {
    dateien.schwarz = path.join(ordner, "bauchbinde-schwarz.png");
    await ausfuehren("ffmpeg", [
      "-y", "-v", "error", "-filter_complex",
      `${flaeche(layout.karteFarbe || "#1D1D1B", schwarz)},` +
        `drawtext=fontfile=${fett}:textfile=${path.basename(funktionDatei)}:fontsize=${gFunktion}:fontcolor=white:` +
        `x=${Math.round(bx + sb / 2 + innenB)}:y=${mittig(by, hb, gFunktion)}`,
      "-frames:v", "1", path.basename(dateien.schwarz),
    ], { cwd: ordner });
  }

  // Unten links unter den Untertiteln, aber über Name und Caption von TikTok/Reels
  // (die belegen hochkant die unteren 22 %); passt sie dort nicht hin: über den Untertiteln
  const hochkant = masse.hoehe > masse.breite;
  const x = hochkant ? Math.round(Math.min(masse.breite, masse.hoehe) * 0.1) : rand;
  // Story-Fassung eines Querformats: unten links im Bild, beim Sprecher – die Untertitel stehen darunter
  if (imBild(layout, hoehe)) return { art: "balken", dateien, x: rand, y: Math.round(layout.bild.unten - pxl(28, s) - hoehe), breite, hoehe, steigung: schraeg / ho };
  const position = untertitelPosition({ ...masse, ...layout });
  const untertitelUnten = masse.hoehe * (1 - position);
  let unten = hochkant ? masse.hoehe * 0.76 : masse.hoehe - 1.5 * rand;
  if (unten - hoehe < untertitelUnten + pxl(30, s)) {
    unten = untertitelUnten - (layout.zeilen === 1 ? 1.5 : 2.6) * untertitelGroesse(masse) - pxl(30, s);
  }
  return { art: "balken", dateien, x, y: Math.round(unten - hoehe), breite, hoehe, steigung: schraeg / ho };
}

/**
 * Stil „karte“: dunkle Karte, farbiger Balken links, links über den Untertiteln.
 */
export async function karteBauchbinde({ name, funktion, layout, masse, ordner }) {
  const s = skala(masse);
  const fett = path.join(layout.schriftOrdner, "Inter-Bold.otf");
  const normal = path.join(layout.schriftOrdner, "Inter-Medium.otf");
  const nameDatei = path.join(ordner, "bauchbinde-name.txt");
  const funktionDatei = path.join(ordner, "bauchbinde-funktion.txt");
  await fs.writeFile(nameDatei, name);
  await fs.writeFile(funktionDatei, funktion ?? "");
  const gName = pxl(58, s);
  const gFunktion = pxl(38, s);
  const textBreiteMax = Math.max(
    await textBreite(nameDatei, fett, gName),
    funktion ? await textBreite(funktionDatei, normal, gFunktion) : 0,
  );
  const links = pxl(40, s);
  const w = Math.min(textBreiteMax + links + pxl(44, s), masse.breite - 2 * raender(masse).rand);
  const h = funktion ? pxl(168, s) : pxl(112, s);
  const k = karteFilter({ w, h, r: pxl(22, s), farbe: layout.karteFarbe, schatten: pxl(16, s), label: "binde" });
  const balken = pxl(9, s);
  const rund = pxl(26, s);
  const zeilen = [
    `drawbox=x=${k.x}:y=${k.y + rund}:w=${balken}:h=${h - 2 * rund}:color=${ffFarbe(layout.akzentFarbe || "#F18616")}@1:t=fill`,
    `drawtext=fontfile=${fett}:textfile=${path.basename(nameDatei)}:fontsize=${gName}:fontcolor=white:x=${k.x + links}:y=${k.y + pxl(28, s)}`,
  ];
  if (funktion) {
    zeilen.push(`drawtext=fontfile=${normal}:textfile=${path.basename(funktionDatei)}:fontsize=${gFunktion}:fontcolor=${ffFarbe(layout.akzentFarbe || "#F18616")}:x=${k.x + links + pxl(2, s)}:y=${k.y + pxl(102, s)}`);
  }
  const ziel = path.join(ordner, "bauchbinde.png");
  await ausfuehren("ffmpeg", [
    "-y", "-v", "error", "-filter_complex", `${k.graph};[binde]${zeilen.join(",")}`, "-frames:v", "1", path.basename(ziel),
  ], { cwd: ordner });

  // Über dem Untertitelblock (zwei Zeilen), links bündig – in der Story-Fassung unten im Bild
  const { rand } = raender(masse);
  if (imBild(layout, h)) return { art: "karte", datei: ziel, x: rand - k.x, y: Math.round(layout.bild.unten - pxl(28, s) - h) - k.y };
  const untertitelOben = masse.hoehe * (1 - untertitelPosition({ ...masse, ...layout })) - 2.6 * untertitelGroesse(masse);
  const y = Math.round(untertitelOben - pxl(30, s) - h);
  return { art: "karte", datei: ziel, x: rand - k.x, y: y - k.y };
}

/**
 * Filter, der eine Balken-Grafik einwischt und wieder auswischt: Eine Kante parallel zu den
 * schrägen Balkenkanten läuft von links nach rechts, davor ein weißer Streifen (nur „mitStreifen“).
 * Zeiten relativ zum Beginn der Grafik; `gesamt` = wie lange sie insgesamt zu sehen ist.
 */
export function wischFilter({ breite, hoehe, steigung, gesamt, verzoegerung = 0, dauer, streifen = 0 }) {
  const ein = `clip((T-${verzoegerung})/${dauer},0,1)`;
  const aus = `clip((${gesamt - verzoegerung}-T)/${dauer},0,1)`;
  const weg = breite + steigung * hoehe + streifen;
  const kante = `(${weg}*(1-pow(1-min(${ein},${aus}),3)))`;
  const u = `(X+${steigung}*Y)`;
  const offen = `lte(${u},${kante})`;
  const farbe = (c) => (streifen ? `if(gt(${u},${kante}-${streifen})*${offen},255,${c}(X,Y))` : `${c}(X,Y)`);
  return `geq=r='${farbe("r")}':g='${farbe("g")}':b='${farbe("b")}':a='if(${offen},alpha(X,Y),0)'`;
}

/**
 * @param {object} o
 * @param {string} o.eingabe Originalvideo
 * @param {string} o.ausgabe fertiges MP4
 * @param {string|null} o.ass ASS-Datei (im selben Ordner wie die Ausgabe) oder null
 * @param {{breite:number,hoehe:number,dauer:number}} o.masse
 * @param {object} o.layout siehe config.layout
 * @param {object} o.video siehe config.video
 * @param {{name:string, funktion?:string}|null} [o.bauchbinde] einblenden, wenn gesetzt
 * @param {boolean} [o.story] Eingabe erst auf eine Story-Fläche setzen; `masse` sind dann die der Story
 */
export async function rendern({ eingabe, ausgabe, ass, masse, layout, video, bauchbinde = null, story = false }) {
  const ordner = path.dirname(ausgabe);
  const args = ["-y", "-v", "error", "-i", eingabe];
  const filter = [];
  let letzte = "0:v";
  let eingang = 1;
  if (story) {
    filter.push(`[0:v]${storyFlaeche(masse)}[flaeche]`);
    letzte = "flaeche";
    if (layout.logo && layout.logoStil === "frei") {
      const schleier = path.join(ordner, "story-schleier.png");
      await storySchleier(masse, schleier, layout.bild);
      args.push("-i", schleier);
      filter.push(`[flaeche][${eingang++}:v]overlay=0:0:format=auto[verlauf]`);
      letzte = "verlauf";
    }
  }
  if (ass) {
    const fonts = layout.schriftOrdner ? `:fontsdir=${layout.schriftOrdner.replace(/[\\:']/g, "\\$&")}` : "";
    filter.push(`[${letzte}]ass=${path.basename(ass)}${fonts}[sub]`);
    letzte = "sub";
  }
  if (layout.logo) {
    const logo = await logoGrafik({ layout: story ? { ...layout, logo: await logoFuerStory(layout) } : layout, masse, ordner });
    args.push("-i", logo.datei);
    filter.push(`[${letzte}][${eingang++}:v]overlay=${logo.x}:${logo.y}:format=auto[mitlogo]`);
    letzte = "mitlogo";
  }
  if (bauchbinde?.name) {
    const binde = await bauchbindeGrafik({ ...bauchbinde, layout, masse, ordner });
    if (binde.art === "balken") {
      const start = Math.min(layout.bauchbindeStart, Math.max(0, masse.dauer - 1));
      const gesamt = Math.max(0.5, Math.min(layout.bauchbindeDauer, masse.dauer - start));
      const dauer = Math.min(0.9, gesamt / 2.5); // Einwischen; der schwarze Balken kommt etwas später
      const wisch = { breite: binde.breite, hoehe: binde.hoehe, steigung: binde.steigung, gesamt };
      const bild = (datei) => args.push("-loop", "1", "-framerate", "30", "-t", String(gesamt), "-i", datei);
      bild(binde.dateien.orange);
      filter.push(`[${eingang++}:v]format=rgba,${wischFilter({ ...wisch, dauer, streifen: Math.round(binde.breite * 0.12) })}[orange]`);
      let balken = "orange";
      if (binde.dateien.schwarz) {
        bild(binde.dateien.schwarz);
        filter.push(`[${eingang++}:v]format=rgba,${wischFilter({ ...wisch, verzoegerung: dauer * 0.3, dauer: dauer * 0.75 })}[schwarz]`);
        filter.push(`[orange][schwarz]overlay=0:0:format=auto[balken]`);
        balken = "balken";
      }
      filter.push(`[${balken}]setpts=PTS+${start}/TB[binde]`);
      filter.push(`[${letzte}][binde]overlay=${binde.x}:${binde.y}:eof_action=pass:format=auto[mitbinde]`);
      letzte = "mitbinde";
    } else {
      letzte = karteEinblenden({ binde, args, filter, letzte, eingang: eingang++, masse, layout });
    }
  }
  filter.push(`[${letzte}]format=yuv420p[v]`);

  args.push(
    "-filter_complex", filter.join(";"),
    "-map", "[v]", "-map", "0:a?",
    "-c:v", video.encoder,
  );
  if (video.encoder === "libx264") args.push("-preset", video.preset, "-crf", video.crf, "-profile:v", "high");
  else args.push("-b:v", "8M");
  args.push("-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", ausgabe);

  await ausfuehren("ffmpeg", args, { cwd: ordner });
}

/** Karten-Bauchbinde: gleitet herein und blendet aus. Gibt das neue Filter-Label zurück. */
function karteEinblenden({ binde, args, filter, letzte, eingang, masse, layout }) {
  const d = 0.35; // Ein- und Ausblenden
  const start = Math.min(layout.bauchbindeStart, Math.max(0, masse.dauer - 1));
  const ende = Math.max(start + d, Math.min(start + layout.bauchbindeDauer, masse.dauer - d - 0.05));
  const weg = Math.round(60 * skala(masse)); // so weit gleitet sie herein
  args.push("-loop", "1", "-t", String(Math.max(masse.dauer, 1)), "-i", binde.datei);
  filter.push(`[${eingang}:v]format=rgba,fade=t=in:st=${start}:d=${d}:alpha=1,fade=t=out:st=${ende}:d=${d}:alpha=1[binde]`);
  filter.push(`[${letzte}][binde]overlay=x='${binde.x}-${weg}*pow(max(0,1-(t-${start})/${d}),2)':y=${binde.y}:enable='between(t,${start},${ende + d})':eof_action=pass:format=auto[mitbinde]`);
  return "mitbinde";
}

/**
 * Foto als JPEG speichern, lange Seite höchstens 2048 px (Instagram nimmt max. 8 MB,
 * Telegram zeigt Fotos bis 10 MB), auf Wunsch mit Logo.
 */
export async function fotoRendern({ eingabe, ausgabe, layout, mitLogo }) {
  const original = await untersuche(eingabe);
  const faktor = Math.min(1, 2048 / Math.max(original.breite, original.hoehe));
  const masse = { breite: gerade(original.breite * faktor), hoehe: gerade(original.hoehe * faktor) };
  const filter = [`[0:v]scale=${masse.breite}:${masse.hoehe}[klein]`];
  let letzte = "klein";
  const args = ["-y", "-v", "error", "-i", eingabe];
  if (mitLogo && layout.logo) {
    const logo = await logoGrafik({ layout, masse, ordner: path.dirname(ausgabe), video: false });
    args.push("-i", logo.datei);
    filter.push(`[${letzte}][1:v]overlay=${logo.x}:${logo.y}:format=auto[mitlogo]`);
    letzte = "mitlogo";
  }
  filter.push(`[${letzte}]format=yuvj420p[bild]`);
  args.push("-filter_complex", filter.join(";"), "-map", "[bild]", "-frames:v", "1", "-q:v", "3", ausgabe);
  await ausfuehren("ffmpeg", args);
}

// ---------- Storys ----------
// Instagram und Facebook zeigen Storys in 9:16. Alles andere landet dort klein mit Balken –
// dafür eine eigene Fassung: Bild mittig, dahinter eine unscharfe Kopie.
// Oben (Fortschrittsbalken, Profil) und unten (Antwortfeld) blenden die Apps je gut 10 % ein;
// das Hochkant-Layout (Logo ab 14 %, Bauchbinde bis 76 %) lässt das schon frei.

/** Passt eine Bauchbinde der Höhe `h` unten ins Bild der Story-Fassung (höchstens ein Drittel davon)? */
const imBild = (layout, h) => Boolean(layout.bild) && layout.bild.unten - layout.bild.oben >= 3 * h;

/** Wo das scharfe Bild auf der Story-Fläche liegt – so, wie storyFlaeche es setzt. */
export function storyBild(original, masse = STORY_MASSE) {
  const faktor = Math.min(masse.breite / original.breite, masse.hoehe / original.hoehe);
  const h = gerade(original.hoehe * faktor);
  const oben = Math.round((masse.hoehe - h) / 2);
  return { oben, unten: oben + h };
}

/**
 * Layout für die Story-Fassung eines Videos, das nicht 9:16 ist: am Bild ausgerichtet statt an der
 * ganzen Fläche – Logo darüber, Bauchbinde unten im Bild, Untertitel direkt darunter auf der
 * unscharfen Fläche (so verdecken sie nichts). Untertitel nur dorthin, wo sie noch über Name und
 * Caption von Reels/TikTok bleiben (untere 22 %); sonst gilt das normale Hochkant-Layout.
 */
export function storyLayout(layout, original, masse = STORY_MASSE) {
  const bild = storyBild(original, masse);
  const ergebnis = { ...layout, bild };
  const unterkante = bild.unten + Math.round(masse.hoehe * 0.025) + 1.35 * untertitelGroesse(masse);
  const position = (masse.hoehe - unterkante) / masse.hoehe;
  if (position >= 0.22) ergebnis.positionFest = Math.round(position * 1000) / 1000;
  return ergebnis;
}

/** Fotos in der Story: höchstens 80 % der Höhe, damit das Logo des Fotos unter der Kopfzeile bleibt. */
export const STORY_FOTO_HOEHE = 0.8;

export const STORY_MASSE = { breite: 1080, hoehe: 1920 };

/** Schon 9:16 (mit etwas Spielraum)? Dann taugt die normale Fassung auch als Story. */
export const istStoryFormat = (masse) => Math.abs(masse.hoehe / masse.breite - 16 / 9) < 0.03;

/**
 * Filter: beliebiges Bild → 1080×1920, mittig auf einer unscharfen Kopie seiner selbst.
 * Nicht abgedunkelt: Das Logo mit dunkler Schrift soll auf dem Hintergrund lesbar bleiben.
 * `vorneHoehe` begrenzt die Höhe des scharfen Bildes (für Fotos, s. STORY_FOTO_HOEHE).
 */
export function storyFlaeche({ breite, hoehe } = STORY_MASSE, { vorneHoehe = hoehe } = {}) {
  return `split[sgrund][sbild];` +
    `[sgrund]scale=${breite}:${hoehe}:force_original_aspect_ratio=increase,crop=${breite}:${hoehe},` +
    `boxblur=40:2,eq=saturation=0.85[sunscharf];` +
    `[sbild]scale=${breite}:${gerade(vorneHoehe)}:force_original_aspect_ratio=decrease:force_divisible_by=2[svorne];` +
    `[sunscharf][svorne]overlay=(W-w)/2:(H-h)/2,setsar=1`;
}

/**
 * Weicher dunkler Verlauf oben auf der Story-Fläche (halb deckend bis 26 % der Höhe, bis 40 % auslaufend):
 * Darauf ist das Logo mit heller Schrift auf jedem Hintergrund lesbar – auch auf hellem Himmel oder
 * gemischtem Grund, wo weder helle noch dunkle Schrift allein sicher wäre.
 */
export async function storySchleier(masse, ziel, bild = null) {
  const { breite, hoehe } = masse;
  // Mit bekanntem Bild endet der Verlauf an dessen Oberkante, damit er nichts davon abdunkelt
  const ende = bild ? Math.min(0.40, bild.oben / hoehe) : 0.40;
  await ausfuehren("ffmpeg", [
    "-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${breite}x${hoehe}:d=1`,
    "-vf", `format=rgba,geq=r=0:g=0:b=0:a='128*clip((${ende.toFixed(4)}-Y/${hoehe})/0.14,0,1)'`,
    "-frames:v", "1", ziel,
  ]);
}

/**
 * Logo für die Story-Fläche: Das freie Logo steht dort auf dem dunklen Verlauf, also die Variante
 * mit heller Schrift (quer-hell → quer-dunkel), sofern es sie gibt. Mit Karte bleibt es, wie es ist.
 */
export async function logoFuerStory(layout) {
  if (layout.logoStil !== "frei" || !/-hell\.png$/.test(layout.logo)) return layout.logo;
  const dunkel = layout.logo.replace(/-hell\.png$/, "-dunkel.png");
  try {
    await fs.access(dunkel);
    return dunkel;
  } catch {
    return layout.logo;
  }
}

/**
 * Story-Fassung eines Fotos: das fertige Feed-Foto (samt Logo, wie im Beitrag) auf 1080×1920,
 * höchstens 80 % hoch – so liegt sein Logo immer unter der Kopfzeile der Story.
 */
export async function storyFoto({ eingabe, ausgabe }) {
  await ausfuehren("ffmpeg", [
    "-y", "-v", "error", "-i", eingabe,
    "-filter_complex", `[0:v]${storyFlaeche(STORY_MASSE, { vorneHoehe: STORY_MASSE.hoehe * STORY_FOTO_HOEHE })},format=yuvj420p[bild]`,
    "-map", "[bild]", "-frames:v", "1", "-q:v", "3", ausgabe,
  ]);
}

/** Verkleinerte Kopie, die die KI für den Caption-Vorschlag ansieht. */
export async function fotoFuerKi(eingabe, ausgabe) {
  await ausfuehren("ffmpeg", [
    "-y", "-v", "error", "-i", eingabe,
    "-vf", "scale='min(1568,iw)':'min(1568,ih)':force_original_aspect_ratio=decrease",
    "-frames:v", "1", "-q:v", "4", ausgabe,
  ]);
}

/** Kleinere Fassung nur für die Telegram-Vorschau (Bot-API: max. 50 MB). */
export async function vorschau(eingabe, ausgabe) {
  await ausfuehren("ffmpeg", [
    "-y", "-v", "error", "-i", eingabe,
    "-vf", "scale='if(gt(iw,ih),-2,540)':'if(gt(iw,ih),540,-2)'",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart", ausgabe,
  ]);
}

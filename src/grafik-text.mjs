import fs from "node:fs/promises";
import path from "node:path";
import { ausfuehren, logoGrafik, textBreite } from "./video.mjs";
import { grafikInhalt } from "./redaktion.mjs";

// Der lokale Renderer benötigt weder Canvas noch einen Cloud-KI-Schlüssel.
const FARBEN = {
  dunkel: { grund: "#1D1D1B", text: "#FFFFFF", akzent: "#F18616", sub: "#F0F0EF" },
  hell: { grund: "#F5F2ED", text: "#1D1D1B", akzent: "#D86900", sub: "#32312F" },
  orange: { grund: "#F18616", text: "#1D1D1B", akzent: "#FFFFFF", sub: "#282828" },
};
const farbe = (s) => `0x${s.replace("#", "")}`;

export function textZeilen(text, limit, maxZeilen) {
  const zeilen = [];
  for (const absatz of String(text ?? "").split("\n")) {
    let puffer = "";
    for (const wort of absatz.split(/\s+/).filter(Boolean)) {
      if (wort.length > limit) throw new Error("Ein Wort in der Grafik ist zu lang. Bitte kürzen.");
      if (puffer && (puffer + " " + wort).length > limit) {
        zeilen.push(puffer);
        puffer = "";
      }
      puffer = puffer ? puffer + " " + wort : wort;
    }
    if (puffer) zeilen.push(puffer);
  }
  if (zeilen.length > maxZeilen) throw new Error(`Für diese Vorlage sind höchstens ${maxZeilen} Zeilen möglich. Bitte kürzen.`);
  return zeilen;
}

// Bei den beiden mitgelieferten Varianten heißt dunkel = weiße Schrift auf dunklem Grund.
export function logoFuerGrafik(logo, stil = "dunkel") {
  if (!logo) return logo;
  if (!/quer-(?:hell|dunkel)\.png$/.test(path.basename(logo))) return logo;
  return logo.replace(/quer-(?:hell|dunkel)\.png$/, stil === "dunkel" ? "quer-dunkel.png" : "quer-hell.png");
}

function zeichenBreite(text) {
  return [...text].reduce((sum, c) => sum +
    (/[ilI.,:;!|']/u.test(c) ? 0.45 : /[mMwW@]/u.test(c) ? 1.3 : /[A-ZÄÖÜ]/u.test(c) ? 1.1 : 1), 0);
}

// Wörter möglichst gleichmäßig verteilen, statt eine erste volle und eine zweite fast leere Zeile.
export function ausgewogeneZeilen(text, maxBreite) {
  const woerter = String(text ?? "").trim().split(/\s+/u).filter(Boolean);
  if (!woerter.length) return [];
  const einheiten = woerter.map(zeichenBreite);
  const n = woerter.length;
  const memo = new Map();
  const teilen = (i) => {
    if (i === n) return { wert: 0, zeilen: [] };
    if (memo.has(i)) return memo.get(i);
    let beste = null;
    let breite = 0;
    for (let j = i; j < n; j++) {
      breite += einheiten[j] + (j > i ? 0.6 : 0);
      if (breite > maxBreite) break;
      const rest = teilen(j + 1);
      if (!rest) continue;
      const ungleich = (maxBreite - breite) ** 2 * (j + 1 === n ? 0.3 : 1);
      const wert = rest.wert + ungleich + 240;
      if (!beste || wert < beste.wert) {
        beste = { wert, zeilen: [woerter.slice(i, j + 1).join(" "), ...rest.zeilen] };
      }
    }
    memo.set(i, beste);
    return beste;
  };
  return teilen(0)?.zeilen ?? [];
}

// Die angenäherte Zeilenbreite wird mit FFmpeg an der echten Inter-Schrift nachgemessen.
async function titelEinpassen(text, schrift, ordner, { maxBreite, maxZeilen, maxHoehe }) {
  for (let groesse = 102; groesse >= 46; groesse -= 4) {
    const zeilenhoehe = Math.round(groesse * 1.24);
    const zeilen = ausgewogeneZeilen(text, maxBreite / (groesse * 0.56));
    if (!zeilen.length || zeilen.length > maxZeilen || zeilen.length * zeilenhoehe > maxHoehe) continue;
    let passt = true;
    for (let i = 0; i < zeilen.length; i++) {
      const datei = path.join(ordner, `grafik-titel-messen-${i}.txt`);
      await fs.writeFile(datei, zeilen[i], "utf8");
      if (await textBreite(datei, schrift, groesse) > maxBreite) {
        passt = false;
        break;
      }
    }
    if (passt) return { zeilen, groesse, zeilenhoehe };
  }
  throw new Error("Die Überschrift passt nicht aufs Motiv. Bitte kürzen oder auf mehrere Grafiken verteilen.");
}

// Testbare Abstände: Header, Logo und die App-Bedienelemente bleiben getrennt.
export function grafikGeometrie({ format, titelHoehe, textHoehe, logoHoehe }) {
  const story = format === "story";
  const labelY = story ? 345 : 135;
  const logoUnten = story ? 1510 : 1230;
  const logoY = logoUnten - logoHoehe;
  const oben = story ? 520 : 295;
  const unten = logoY - (story ? 115 : 95);
  const blockHoehe = titelHoehe + 40 + (textHoehe ? 54 + textHoehe : 0);
  if (unten - oben < blockHoehe) return null;
  return {
    labelY, logoY, logoUnten, oben, unten,
    titelY: Math.round(oben + (unten - oben - blockHoehe) / 2),
    blockHoehe,
  };
}

export async function textGrafik({ ausgabe, inhalt, layout, format = "post", stil = "dunkel", logoModus = "frei", stufe = "voll", animation = false, dauer = 5 }) {
  if (!["post", "story"].includes(format)) throw new Error("Ungültiges Grafikformat.");
  const palette = FARBEN[stil] ?? FARBEN.dunkel;
  const story = format === "story";
  const hoehe = story ? 1920 : 1350;
  const breite = 1080;
  const ordner = path.dirname(ausgabe);
  const schrift = path.join(layout.schriftOrdner, "Inter-Bold.otf");
  const normal = path.join(layout.schriftOrdner, "Inter-Medium.otf");

  const logoPfad = logoFuerGrafik(layout.logo, stil);
  let logo = null;
  if (logoPfad) {
    await fs.access(logoPfad);
    logo = await logoGrafik({
      layout: {
        ...layout, logo: logoPfad,
        logoBreite: Math.min(layout.logoBreite ?? 0.4, 0.4),
        logoStil: logoModus === "karte" ? "karte" : "frei", logoPosition: "oben-links",
        karteFarbe: stil === "dunkel" ? "#1D1D1B" : "#F5F2ED",
      },
      masse: { breite, hoehe }, ordner, video: false,
    });
  }

  const body = inhalt.beschreibung ? textZeilen(inhalt.beschreibung, 34, story ? 6 : 5) : [];
  const bodyZeile = 56;
  const bodyHoehe = body.length * bodyZeile;
  const reserve = grafikGeometrie({ format, titelHoehe: 0, textHoehe: bodyHoehe, logoHoehe: logo?.sichtbar?.h ?? 0 });
  const verfuegbar = reserve ? reserve.unten - reserve.oben - 40 - (bodyHoehe ? bodyHoehe + 54 : 0) : 0;
  const titel = await titelEinpassen(inhalt.titel, schrift, ordner, {
    maxBreite: 872, maxZeilen: story ? 6 : 5, maxHoehe: verfuegbar,
  });
  const plan = grafikGeometrie({
    format, titelHoehe: titel.zeilen.length * titel.zeilenhoehe,
    textHoehe: bodyHoehe, logoHoehe: logo?.sichtbar?.h ?? 0,
  });
  if (!plan) throw new Error("Der Text passt nicht sicher zwischen Überschrift und Logo. Bitte kürzen.");

  const titelY = plan.titelY;
  const linieY = titelY + titel.zeilen.length * titel.zeilenhoehe + 8;
  const untertitelY = linieY + 94;
  // Das bestehende dreistufige Layout bleibt erhalten. Zusätzliche Zwischenstufen
  // zeigen erst einzelne Titelzeilen, dann eine von links wachsende Akzentlinie.
  const titelStufe = /^titel-(\d+)$/.exec(stufe);
  const linienStufe = /^linie-(\d+)$/.exec(stufe);
  const titelAnzahl = stufe === "kopf" ? 0 : titelStufe ? Number(titelStufe[1]) : titel.zeilen.length;
  const linienAnteil = stufe === "kopf" || titelStufe ? 0
    : linienStufe ? Math.max(0, Math.min(1, Number(linienStufe[1]) / 10)) : 1;
  const filter = [];
  if (titelAnzahl) {
    filter.push(`drawbox=x=88:y=${titelY - 20}:w=10:h=${Math.min(92, titel.zeilenhoehe)}:color=${farbe(palette.akzent)}:t=fill`);
  }
  if (!animation && linienAnteil > 0) {
    filter.push(`drawbox=x=100:y=${linieY}:w=${Math.ceil((body.length ? 700 : 430) * linienAnteil)}:h=6:color=${farbe(palette.akzent)}:t=fill`);
  }
  const schreiben = async (name, content, font, fontSize, fc, x, y) => {
    const filename = `grafik-${name}.txt`;
    await fs.writeFile(path.join(ordner, filename), content, "utf8");
    let posX = String(x);
    let alpha = "";
    if (animation) {
      const onset = name.startsWith("titel-") ? 0.28 + Number(name.split("-").at(-1)) * 0.19
        : name.startsWith("text-") ? 1.20 + Number(name.split("-").at(-1)) * 0.1 : 0;
      const zeit = `min(1,max(0,(t-${onset.toFixed(2)})/0.45))`;
      alpha = `:alpha='${zeit}'`;
      if (name.startsWith("titel-")) posX = `'${x}-24*(1-${zeit})'`;
    }
    filter.push(`drawtext=fontfile='${font}':textfile='${filename}':expansion=none:fontsize=${fontSize}:fontcolor=${farbe(fc)}:x=${posX}:y=${y}${alpha}`);
  };
  await schreiben("label", inhalt.etikett, normal, 28, palette.akzent, 90, plan.labelY);
  for (let i = 0; i < titelAnzahl; i++) {
    await schreiben(`titel-${i}`, titel.zeilen[i], schrift, titel.groesse, palette.text, 112, titelY + i * titel.zeilenhoehe);
  }
  for (let i = 0; i < (linienAnteil > 0 ? body.length : 0); i++) {
    await schreiben(`text-${i}`, body[i], normal, 39, palette.sub, 112, untertitelY + i * bodyZeile);
  }
  const args = ["-y", "-v", "error", "-f", "lavfi", "-i",
    `color=c=${farbe(palette.grund)}:s=${breite}x${hoehe}:r=25:d=${animation ? dauer : 1}`];
  if (animation) {
    // Separate Mini-Ebene: Pixel werden anhand der Videozeit T aufgedeckt.
    // Anders als Zwischenbilder wächst die Linie bei jedem Frame.
    const w = body.length ? 700 : 430;
    args.push("-f", "lavfi", "-i", `color=c=${farbe(palette.akzent)}:s=${w}x6:r=25:d=${dauer}`);
  }
  if (logo && (animation || stufe === "voll")) {
    if (animation) args.push("-loop", "1", "-framerate", "25");
    args.push("-i", logo.datei);
  }
  let graph = `[0:v]${filter.join(",")}[grund]`;
  let letzte = "grund";
  if (animation) {
    const w = body.length ? 700 : 430;
    graph += `;[1:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*lte(X,${w}*min(1,max(0,(T-1.05)/0.65)))'[linie]`;
    graph += `;[grund][linie]overlay=100:${linieY}:format=auto:shortest=1[mitlinie]`;
    letzte = "mitlinie";
  }
  if (logo && (animation || stufe === "voll")) {
    const x = 100 - logo.sichtbar.x + logo.x;
    const y = plan.logoY - logo.sichtbar.y + logo.y;
    const index = animation ? 2 : 1;
    if (animation) {
      graph += `;[${index}:v]format=rgba,fade=t=in:st=${Math.min(1.85, dauer * 0.60).toFixed(2)}:d=${Math.min(0.55, dauer * 0.22).toFixed(2)}:alpha=1[logoin]`;
      graph += `;[${letzte}][logoin]overlay=${x}:${y}:format=auto:shortest=1[mitlogo]`;
    } else graph += `;[${letzte}][${index}:v]overlay=${x}:${y}:format=auto[mitlogo]`;
    letzte = "mitlogo";
  }
  if (animation) {
    graph += `;[${letzte}]format=yuv420p[video]`;
    args.push("-filter_complex", graph, "-map", "[video]", "-t", String(dauer),
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
      "-movflags", "+faststart", ausgabe);
  } else args.push("-filter_complex", graph, "-map", `[${letzte}]`,
    "-frames:v", "1", "-q:v", "3", ausgabe);
  await ausfuehren("ffmpeg", args, { cwd: ordner });
  return ausgabe;
}

export async function textGrafiken({ ordner, text, layout, ausAntrag = false, stil = "dunkel" }) {
  const inhalt = grafikInhalt(text, { ausAntrag });
  const post = path.join(ordner, "redaktion-post.jpg");
  const story = path.join(ordner, "redaktion-story.jpg");
  await textGrafik({ ausgabe: post, inhalt, layout, format: "post", stil });
  await textGrafik({ ausgabe: story, inhalt, layout, format: "story", stil });
  return { post, story, gekuerzt: inhalt.gekuerzt };
}

/**
 * Eine kurze, ruhige Animation einer fertig gestalteten Textgrafik.
 * In der ersten Version blendet die komplette Grafik weich ein und bewegt sich
 * minimal (Ken Burns). Kein Audio, keine generative KI.
 */
export async function textAnimation({
  ausgabe, inhalt, layout, format = "post", stil = "dunkel",
  logoModus = "frei", dauer = 5,
}) {
  if (!["post", "story"].includes(format)) throw new Error("Ungültiges Animationsformat.");
  if (!Number.isFinite(dauer) || dauer < 2 || dauer > 12) throw new Error("Animationsdauer muss zwischen 2 und 12 Sekunden liegen.");
  return textGrafik({ ausgabe, inhalt, layout, format, stil, logoModus, animation: true, dauer });
}

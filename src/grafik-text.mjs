// Textgrafiken mit ffmpeg + vorhandenen Inter-Schriften; keine Canvas-Abhängigkeit,
// kein externer KI-Dienst. Für Telegram-Vorschau und Postiz als JPEG.
import fs from "node:fs/promises";
import path from "node:path";
import { ausfuehren, logoGrafik } from "./video.mjs";
import { grafikInhalt } from "./redaktion.mjs";

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

/** Erzeugt eine Grafik im 4:5-Format oder als 9:16-Story. */
export async function textGrafik({ ausgabe, inhalt, layout, format = "post", stil = "dunkel" }) {
  if (!["post", "story"].includes(format)) throw new Error("Ungültiges Grafikformat.");
  const palette = FARBEN[stil] ?? FARBEN.dunkel;
  const story = format === "story";
  const hoehe = story ? 1920 : 1350;
  const breite = 1080;
  const ordner = path.dirname(ausgabe);
  const schrift = path.join(layout.schriftOrdner, "Inter-Bold.otf");
  const normal = path.join(layout.schriftOrdner, "Inter-Medium.otf");
  const title = textZeilen(inhalt.titel, story ? 19 : 22, story ? 5 : 4);
  const body = inhalt.beschreibung ? textZeilen(inhalt.beschreibung, 34, story ? 6 : 5) : [];
  // Die wichtigsten Elemente liegen bei Stories außerhalb der App-Leisten oben/unten.
  const startY = story ? 395 : 250;
  const lineH = story ? 112 : 94;
  const titelFont = story ? 74 : 68;
  const textStart = startY + title.length * lineH + 64;
  if (body.length && textStart + body.length * 57 > (story ? 1490 : 1050)) {
    throw new Error("Diese Grafik enthält zu viel Text. Bitte kürzen oder eine zweite Grafik erstellen.");
  }
  const filter = [
    `drawbox=x=70:y=${startY - 64}:w=12:h=74:color=${farbe(palette.akzent)}:t=fill`,
    `drawbox=x=70:y=${startY + title.length * lineH + 16}:w=940:h=5:color=${farbe(palette.akzent)}:t=fill`,
  ];
  const writeLine = async (name, content, font, fontSize, fc, x, y) => {
    const filename = `grafik-${name}.txt`;
    await fs.writeFile(path.join(ordner, filename), content, "utf8");
    filter.push(`drawtext=fontfile='${font}':textfile='${filename}':expansion=none:fontsize=${fontSize}:fontcolor=${farbe(fc)}:x=${x}:y=${y}`);
  };
  await writeLine("label", inhalt.etikett, normal, 28, palette.akzent, 73, startY - 128);
  for (let i = 0; i < title.length; i++) {
    await writeLine(`titel-${i}`, title[i], schrift, titelFont, palette.text, 91, startY + i * lineH);
  }
  for (let i = 0; i < body.length; i++) {
    await writeLine(`text-${i}`, body[i], normal, 39, palette.sub, 90, textStart + i * 57);
  }
  const logo = layout.logo ? await logoGrafik({
    layout: { ...layout, logoBreite: Math.min(layout.logoBreite, 0.40), logoStil: "karte", logoPosition: "oben-links" },
    masse: { breite, hoehe }, ordner, video: false,
  }) : null;
  const safeBottom = story ? 1530 : 1290;
  const logoY = logo?.sichtbar ? safeBottom - logo.sichtbar.h : 0;
  const logoX = logo?.sichtbar ? 74 : 0;
  const output = ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=${farbe(palette.grund)}:s=${breite}x${hoehe}:d=1`];
  if (logo) output.push("-i", logo.datei);
  let graph = `[0:v]${filter.join(",")}[grund]`;
  const outLabel = logo ? "fertig" : "grund";
  if (logo) graph += ` ;[grund][1:v]overlay=${logoX - logo.sichtbar.x + logo.x}:${logoY - logo.sichtbar.y + logo.y}:format=auto[fertig]`;
  output.push("-filter_complex", graph, "-map", `[${outLabel}]`, "-frames:v", "1", "-q:v", "3", ausgabe);
  await ausfuehren("ffmpeg", output, { cwd: ordner });
  return ausgabe;
}

/** Post- und Storygrafik aus demselben überprüfbaren Text erzeugen. */
export async function textGrafiken({ ordner, text, layout, ausAntrag = false, stil = "dunkel" }) {
  const inhalt = grafikInhalt(text, { ausAntrag });
  const post = path.join(ordner, "redaktion-post.jpg");
  const story = path.join(ordner, "redaktion-story.jpg");
  await textGrafik({ ausgabe: post, inhalt, layout, format: "post", stil });
  await textGrafik({ ausgabe: story, inhalt, layout, format: "story", stil });
  return { post, story, gekuerzt: inhalt.gekuerzt };
}

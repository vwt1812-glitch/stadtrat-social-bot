// Story-Bildtext: kurze, gut lesbare Textkarte auf einem 1080×1920-Foto.
// FFmpeg und die vorhandene Inter-Schrift verwenden – keine neue Laufzeit-Abhängigkeit.
import fs from "node:fs/promises";
import path from "node:path";
import { ausfuehren, textBreite } from "./video.mjs";
import { storyTextPlatzierung } from "./story-layout.mjs";

const MAX_ZEICHEN = 180;
const MAX_ZEILEN = 6;
const SCHRIFTGROESSE = 66;
const INNENBREITE = 830;

/** Text sicher in Zeilen teilen; auch einzelne sehr lange Wörter umbrechen. */
export function storyTextZeilen(text, maxZeichen = 24) {
  const eingabe = String(text ?? "").trim().replace(/\r\n?/g, "\n");
  if (!eingabe) return [];
  if ([...eingabe].length > MAX_ZEICHEN) throw new Error(`Story-Text ist zu lang (maximal ${MAX_ZEICHEN} Zeichen).`);
  const zeilen = [];
  for (const absatz of eingabe.split("\n")) {
    if (!absatz.trim()) continue;
    let zeile = "";
    for (const wort of absatz.trim().split(/\s+/u)) {
      const teile = [...wort];
      if (teile.length > maxZeichen) {
        if (zeile) zeilen.push(zeile);
        zeile = "";
        while (teile.length > maxZeichen) zeilen.push(teile.splice(0, maxZeichen).join(""));
        if (teile.length) zeile = teile.join("");
        continue;
      }
      if (zeile && [...zeile, " ", ...teile].length > maxZeichen) {
        zeilen.push(zeile);
        zeile = "";
      }
      zeile = zeile ? `${zeile} ${wort}` : wort;
    }
    if (zeile) zeilen.push(zeile);
  }
  if (zeilen.length > MAX_ZEILEN) throw new Error(`Der Text braucht ${zeilen.length} Zeilen (maximal ${MAX_ZEILEN}). Bitte kürzen.`);
  return zeilen;
}

/** Mit der echten Schriftbreite prüfen, ob die Zeilen in die Karte passen. */
async function passendZeilen(text, ordner, schrift) {
  let zeilen = storyTextZeilen(text);
  let maximum = 24;
  for (; maximum >= 10; maximum -= 2) {
    zeilen = storyTextZeilen(text, maximum);
    let passt = true;
    for (let i = 0; i < zeilen.length; i++) {
      const testdatei = path.join(ordner, `story-messen-${i}.txt`);
      await fs.writeFile(testdatei, zeilen[i], "utf8");
      if (await textBreite(testdatei, schrift, SCHRIFTGROESSE) > INNENBREITE) {
        passt = false;
        break;
      }
    }
    if (passt) return zeilen;
  }
  throw new Error("Der Story-Text ist für die Grafik zu breit. Bitte kürzen.");
}

/** Fertige 9:16-Fotostory mit dunkler Textkarte ergänzen. */
export async function storyFotoText({ eingabe, ausgabe, text, layout }) {
  if (!String(text ?? "").trim()) return fs.copyFile(eingabe, ausgabe);
  const ordner = path.dirname(ausgabe);
  const schrift = path.join(layout.schriftOrdner, "Inter-Bold.otf");
  const zeilen = await passendZeilen(text, ordner, schrift);
  const zeilenHoehe = 82;
  const hoehe = zeilen.length * zeilenHoehe + 74;
  const oben = storyTextPlatzierung({
    masse: { breite: 1080, hoehe: 1920 }, hoehe, bild: layout.bild,
    logo: layout.logoBereich, wunsch: layout.storyTextPosition ?? "auto",
  });
  const filter = [
    `drawbox=x=70:y=${oben}:w=940:h=${hoehe}:color=0x1D1D1B@0.84:t=fill`,
    `drawbox=x=70:y=${oben}:w=11:h=${hoehe}:color=0xF18616@1:t=fill`,
  ];
  for (let i = 0; i < zeilen.length; i++) {
    const dateiname = `story-text-zeile-${i}.txt`;
    await fs.writeFile(path.join(ordner, dateiname), zeilen[i], "utf8");
    const y = oben + 32 + i * zeilenHoehe;
    filter.push(`drawtext=fontfile='${schrift}':textfile=${dateiname}:expansion=none:fontsize=${SCHRIFTGROESSE}:fontcolor=white:x=(w-text_w)/2:y=${y}`);
  }
  await ausfuehren("ffmpeg", [
    "-y", "-v", "error", "-i", eingabe,
    "-vf", filter.join(","),
    "-frames:v", "1", "-q:v", "3", ausgabe,
  ], { cwd: ordner });
}

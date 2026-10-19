// Spracherkennung lokal mit whisper.cpp (https://github.com/ggml-org/whisper.cpp).

import fs from "node:fs/promises";
import path from "node:path";
import { ausfuehren } from "./video.mjs";
import { parseSrt, parseKorrekturen, wendeKorrekturenAn } from "./untertitel.mjs";

/**
 * Glossar-Datei: eine Zeile pro Eintrag.
 *   „Küffner“            → Begriff, den Whisper kennen soll
 *   „Kuffner => Küffner“ → wird danach automatisch ersetzt
 * Zeilen mit # sind Kommentare.
 */
export async function ladeGlossar(datei) {
  let text = "";
  try {
    text = await fs.readFile(datei, "utf8");
  } catch {
    return { begriffe: [], korrekturen: [] };
  }
  const zeilen = text.split("\n").map((z) => z.trim()).filter((z) => z && !z.startsWith("#"));
  const korrekturen = parseKorrekturen(zeilen.join("\n"));
  const begriffe = zeilen
    .map((z) => z.split(/\s*(?:=>|->|→)\s*/).at(-1))
    .filter((b, i, alle) => alle.indexOf(b) === i);
  return { begriffe, korrekturen };
}

/** @returns {Promise<{start:number,end:number,text:string}[]>} */
export async function transkribiere(wav, whisper, glossarDatei) {
  const { begriffe, korrekturen } = await ladeGlossar(glossarDatei);
  const basis = path.join(path.dirname(wav), "whisper");
  const args = [
    "-m", whisper.modell,
    "-f", wav,
    "-l", whisper.sprache,
    "-t", String(whisper.threads),
    "-osrt", "-of", basis,
    "-ml", "42", "-sow", // kurze Abschnitte, an Wortgrenzen getrennt
    "-np",
  ];
  if (begriffe.length) args.push("--prompt", begriffe.join(", "));
  await ausfuehren(whisper.bin, args);
  const cues = parseSrt(await fs.readFile(`${basis}.srt`, "utf8"))
    // Whisper markiert Stille gern mit [Musik], (Applaus) o. Ä.
    .filter((c) => !/^[[(].*[\])]$/.test(c.text));
  return wendeKorrekturenAn(cues, korrekturen);
}

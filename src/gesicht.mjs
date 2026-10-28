// Gesicht im Video finden (src/gesicht.py, OpenCV lokal) und die Untertitel so legen,
// dass sie es nicht verdecken. Ohne OpenCV bleibt alles beim Standard.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ausfuehren } from "./video.mjs";
import { untertitelPosition, untertitelGroesse } from "./untertitel.mjs";

const SKRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "gesicht.py");

/** Reihenfolge, in der die Lagen probiert werden: der Standard zuerst. */
export const LAGE_REIHENFOLGE = ["unten", "oben", "mitte"];

/**
 * @param {string} video
 * @param {{python: string}} o Python mit OpenCV (siehe GESICHT_PYTHON)
 * @returns {Promise<{bilder:number, gesichter:{t:number,x:number,y:number,w:number,h:number}[]}|null>}
 *   null, wenn OpenCV fehlt oder etwas schiefgeht – die Gesichtssuche ist nur eine Hilfe
 */
export async function gesichtSuchen(video, { python }, bilder = 12) {
  if (!python || !fs.existsSync(python)) return null;
  try {
    return JSON.parse(await ausfuehren(python, [SKRIPT, video, String(bilder)]));
  } catch (e) {
    console.error("Gesichtssuche:", e.message);
    return null;
  }
}

/** Bereich der Untertitel (Anteile der Höhe, oben/unten) für eine Lage. */
export function untertitelBereich(lage, { masse, layout }) {
  const position = untertitelPosition({ ...masse, ...layout, lage });
  const zeilen = layout.zeilen === 1 ? 1 : 2;
  const hoehe = (untertitelGroesse(masse) * 1.3 * zeilen) / masse.hoehe;
  return { oben: 1 - position - hoehe, unten: 1 - position };
}

/**
 * Wählt die Lage der Untertitel, in der sie das Gesicht am wenigsten verdecken – bevorzugt „unten“.
 * Das Gesichtsfeld von OpenCV reicht etwa von den Augenbrauen bis unters Kinn; oben kommt etwas
 * Stirn dazu, unten etwas Kinn.
 * @returns {{lage: "unten"|"oben"|"mitte", frei: boolean, hinweise: string[]}}
 */
export function lageWaehlen(funde, { masse, layout }) {
  const ergebnis = { lage: "unten", frei: true, hinweise: [] };
  if (masse.hoehe <= masse.breite || !funde?.gesichter?.length) return ergebnis;
  // Zu selten gefunden: lieber nichts ändern als raten
  if (funde.gesichter.length < Math.max(2, funde.bilder * 0.4)) return ergebnis;

  const felder = funde.gesichter.map((g) => ({ oben: g.y - 0.1 * g.h, unten: g.y + 1.05 * g.h, stirn: g.y + 0.25 * g.h }));
  const verdeckt = (lage) => {
    const b = untertitelBereich(lage, { masse, layout });
    return felder.filter((f) => f.oben < b.unten && f.unten > b.oben).length / felder.length;
  };
  // Der frühere Logobereich wird erst ohne Logo freigegeben.
  const lagen = layout.logo ? LAGE_REIHENFOLGE : ["unten", "oben", "logobereich", "mitte"];
  const anteile = Object.fromEntries(lagen.map((lage) => [lage, verdeckt(lage)]));
  const frei = lagen.find((lage) => anteile[lage] <= 0.2);
  if (frei) {
    ergebnis.lage = frei;
  } else {
    ergebnis.lage = lagen.reduce((beste, lage) => (anteile[lage] < anteile[beste] ? lage : beste));
    ergebnis.frei = false;
    ergebnis.hinweise.push("Dein Gesicht füllt viel vom Bild – die Untertitel verdecken es überall ein Stück. Nächstes Mal einen Schritt zurück oder das Handy weiter weg halten.");
  }

  // Logo oben (ab 14 % der Höhe, etwa 10 % hoch): Reicht die Stirn hinein, ist der Kopf zu weit oben
  const median = (werte) => werte.sort((a, b) => a - b)[Math.floor(werte.length / 2)];
  if (layout.logo && median(felder.map((f) => f.stirn)) < 0.24) {
    ergebnis.hinweise.push("Dein Kopf reicht bis ins Logo. Nächstes Mal das Handy etwas höher halten oder etwas mehr Abstand nehmen.");
  }
  return ergebnis;
}

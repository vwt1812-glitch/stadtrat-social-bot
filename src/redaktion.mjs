// Redaktionshilfen ohne generative KI oder Cloud-Aufruf.
// Vorschläge werden aus Originalwortlaut extrahiert, nicht als freie Zusammenfassung ausgegeben.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function kurzerTitel(text, max = 82) {
  const zeilen = String(text ?? "").replace(/\r/g, "").split("\n").map((z) => z.trim()).filter(Boolean);
  const start = zeilen.find((z) => !/^(antrag|beschlussvorschlag|begründung|der stadtrat|seite \d+|stadtrat)$/i.test(z)) ?? "Neues Thema";
  if (start.length <= max) return start;
  const bis = start.slice(0, max + 1);
  const ende = bis.lastIndexOf(" ");
  return `${bis.slice(0, ende >= max / 2 ? ende : max).trimEnd()} …`;
}

/** Übernimmt nur Text aus dem Dokument und kennzeichnet gekürzte Passagen. */
function auszug(text, max = 210) {
  const sauber = String(text ?? "").replace(/\s+/g, " ").trim();
  if (sauber.length <= max) return sauber;
  const schnitt = sauber.slice(0, max + 1);
  const ende = schnitt.lastIndexOf(" ");
  return schnitt.slice(0, ende > max * 0.6 ? ende : max).trimEnd() + " […]";
}

const stop = /^(?:begründung|beschlussvorschlag|antrag|finanzielle auswirkungen|sachverhalt|anlagen|unterschrift)\s*:?$/im;
const beschluss = /(?:^|\n)\s*(?:beschlussvorschlag|der stadtrat (?:möge|wird gebeten)|wir beantragen|antrag(?:stext)?\s*:)\s*:?/im;
const begruendung = /(?:^|\n)\s*begründung\s*:?/im;

/**
 * Ein einfacher, rein dokumentgestützter Generator: keine erfundenen Resultate,
 * keine Behauptung, ein Antrag sei schon beschlossen. PDF-Extraktion findet vorher statt.
 */
export function antragVorschlaege(pdfText) {
  const text = String(pdfText ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ");
  if (text.replace(/\s/g, "").length < 60) throw new Error("Im PDF wurde zu wenig lesbarer Text gefunden. Ein Scan benötigt Texterkennung.");
  const zeilen = text.split("\n").map((z) => z.trim()).filter(Boolean);
  // Seitenköpfe und Anreden beim Titelsuchen überspringen.
  const titel = zeilen.find((z) => z.length >= 12 && z.length < 180 &&
    !/^(stadt nürnberg|stadtrat|antrag|an den|sehr geehrte|betreff|anlage|seite \d+|www\.|https?:)/i.test(z) &&
    !/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(z)) ?? zeilen[0] ?? "Antrag";
  const result = [{ art: "titel", titel: "Antrag: " + kurzerTitel(titel, 75), text: titel.trim(), etikett: "AUS DEM ANTRAG" }];
  const add = (art, titel, match) => {
    if (!match) return;
    const start = match.index + match[0].length;
    let rest = text.slice(start);
    const stopMatch = rest.match(stop);
    if (stopMatch?.index > 30) rest = rest.slice(0, stopMatch.index);
    const passage = auszug(rest, 225);
    if (passage.length < 30) return;
    result.push({ art, titel, text: passage, etikett: "WORTLAUT AUS DEM ANTRAG" });
  };
  add("beschluss", "Beschlussvorschlag", text.match(beschluss));
  add("begruendung", "Aus der Begründung", text.match(begruendung));
  if (result.length === 1) {
    // Ohne sichere Überschriften keine vermeintliche 'Kernaussage' erfinden.
    const passage = auszug(zeilen.filter((z) => z !== titel).slice(0, 8).join(" "), 225);
    if (passage.length >= 30) result.push({ art: "auszug", titel: "Textauszug", text: passage, etikett: "WORTLAUT AUS DEM ANTRAG" });
  }
  return result;
}

/** Textbeiträge verwenden den aktuellen Entwurf, bestehende Grafiken ihren eigenen Bildtext. */
export function grafikText(auftrag, quelle = null) {
  return quelle ?? (auftrag.art === "text"
    ? auftrag.caption ?? auftrag.grafikQuelleText ?? auftrag.notizen
    : auftrag.grafikQuelleText ?? auftrag.caption ?? auftrag.notizen);
}

export function grafikInhalt(text, { ausAntrag = false } = {}) {
  const zeilen = String(text ?? "").replace(/\r/g, "").split("\n").map((z) => z.trim()).filter(Boolean);
  const erste = zeilen[0] ?? "";
  if (!erste) throw new Error("Bitte Text für die Grafik schicken.");
  const titel = kurzerTitel(erste, 90);
  const rest = zeilen.slice(1).join(" ");
  const beschreibung = rest ? auszug(rest, 190) : "";
  return {
    titel,
    beschreibung,
    etikett: ausAntrag ? "AUS EINEM STADTRATSANTRAG" : "AUS DEM NÜRNBERGER STADTRAT",
    gekuerzt: titel !== erste || (rest && beschreibung !== rest),
  };
}

/** Lokaler Ideenspeicher mit atomarem Schreiben; in Telegram nur für freigegebene Nutzer nutzbar. */
export class IdeenSpeicher {
  constructor(datenDir) {
    this.pfad = path.join(datenDir, "ideen.json");
    fs.mkdirSync(datenDir, { recursive: true });
    try { this.ideen = JSON.parse(fs.readFileSync(this.pfad, "utf8")); }
    catch { this.ideen = []; }
  }

  speichern(chatId, text, quelle = "text") {
    const eintrag = {
      id: crypto.randomBytes(4).toString("hex"), chatId, quelle,
      text: String(text).slice(0, 6000), erstellt: new Date().toISOString(),
    };
    this.ideen.unshift(eintrag);
    const temp = `${this.pfad}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.ideen, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.pfad);
    return eintrag;
  }

  liste(chatId) {
    return this.ideen.filter((i) => i.chatId === chatId).slice(0, 20);
  }

  holen(chatId, id) {
    return this.ideen.find((i) => i.chatId === chatId && i.id === id) ?? null;
  }
}

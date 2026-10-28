// SRT lesen und schreiben, Korrekturen anwenden und daraus eine ASS-Datei
// bauen, die ffmpeg/libass mit fester Gestaltung ins Video brennt.

function zuMs(zeit) {
  const m = zeit.trim().match(/(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/);
  if (!m) throw new Error(`Ungültige Zeitangabe: ${zeit}`);
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4].padEnd(3, "0"));
}

function srtZeit(ms) {
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor(ms / 60e3) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`;
}

function assZeit(ms) {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs % 100)}`;
}

/** @returns {{start: number, end: number, text: string}[]} */
export function parseSrt(srt) {
  const bloecke = srt.replace(/\r/g, "").replace(/^﻿/, "").split(/\n\s*\n/);
  const cues = [];
  for (const block of bloecke) {
    const zeilen = block.split("\n").filter((z) => z.trim() !== "");
    const i = zeilen.findIndex((z) => z.includes("-->"));
    if (i < 0) continue;
    const [von, bis] = zeilen[i].split("-->");
    const text = zeilen.slice(i + 1).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    cues.push({ start: zuMs(von), end: zuMs(bis), text });
  }
  return cues;
}

export function formatSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtZeit(c.start)} --> ${srtZeit(c.end)}\n${c.text}\n`).join("\n");
}

/**
 * Korrekturen, eine pro Zeile: „falsch => richtig“ (auch -> oder →).
 * Gilt für ganze Wörter, Groß-/Kleinschreibung egal.
 * @returns {[string, string][]}
 */
export function parseKorrekturen(text) {
  return text
    .split("\n")
    .map((z) => z.split(/\s*(?:=>|->|→)\s*/))
    .filter((teile) => teile.length === 2 && teile[0].trim())
    .map(([alt, neu]) => [alt.trim(), neu.trim()]);
}

/**
 * Untertitel als nummerierte Liste zum Kopieren und Bearbeiten in Telegram – aufgeteilt auf
 * Nachrichten von höchstens `maxLaenge` Zeichen (Telegram erlaubt 4096).
 */
export function alsListe(cues, maxLaenge = 3800) {
  const teile = [];
  let aktuell = "";
  for (const [i, c] of cues.entries()) {
    const zeile = `${i + 1} ${c.text}`;
    if (aktuell && aktuell.length + 1 + zeile.length > maxLaenge) {
      teile.push(aktuell);
      aktuell = zeile;
    } else {
      aktuell = aktuell ? `${aktuell}\n${zeile}` : zeile;
    }
  }
  if (aktuell) teile.push(aktuell);
  return teile;
}

const NUMMER = /^\s*(\d{1,4})\s*[.:)]?\s+(.*?)\s*$|^\s*(\d{1,4})\s*[.:)]?\s*-\s*$/;

/**
 * Bearbeitete Liste übernehmen. „Nummer Text“ ersetzt genau diesen Untertitel (die Zeit bleibt),
 * „Nummer -“ löscht ihn. Unveränderte Zeilen schaden nicht, es reichen auch nur die geänderten.
 * Zeilen ohne Nummer mit „falsch => richtig“ ersetzen wie bisher überall.
 * @returns {{cues: object[], geaendert: number, geloescht: number, ersetzt: number, unbekannt: number[], erkannt: boolean}}
 */
export function wendeBearbeitungAn(cues, text) {
  const neu = cues.map((c) => ({ ...c }));
  const loeschen = new Set();
  const unbekannt = [];
  let geaendert = 0;
  const rest = [];
  for (const zeile of text.split("\n")) {
    const m = zeile.match(NUMMER);
    if (!m) {
      rest.push(zeile);
      continue;
    }
    const nr = Number(m[1] ?? m[3]);
    const cue = neu[nr - 1];
    if (!cue) {
      unbekannt.push(nr);
      continue;
    }
    const inhalt = m[1] ? m[2].replace(/\s+/g, " ") : "";
    if (!inhalt || inhalt === "-") loeschen.add(nr - 1);
    else if (inhalt !== cue.text) {
      cue.text = inhalt;
      geaendert++;
    }
  }
  const korrekturen = parseKorrekturen(rest.join("\n"));
  let ergebnis = neu.filter((_, i) => !loeschen.has(i));
  const vorher = ergebnis.map((c) => c.text).join("\n");
  if (korrekturen.length) ergebnis = wendeKorrekturenAn(ergebnis, korrekturen);
  const ersetzt = korrekturen.length && ergebnis.map((c) => c.text).join("\n") !== vorher ? korrekturen.length : 0;
  const erkannt = text.split("\n").some((z) => NUMMER.test(z)) || korrekturen.length > 0;
  return { cues: ergebnis, geaendert, geloescht: loeschen.size, ersetzt, unbekannt, erkannt };
}

/** Bauchbinde: „Name | Funktion“ oder zwei Zeilen. */
export function parseBauchbinde(text) {
  const [name, ...rest] = text.split(/\s*[|\n]\s*/).map((t) => t.trim()).filter(Boolean);
  return name ? { name: name.slice(0, 60), funktion: rest.join(" ").slice(0, 80) } : null;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function wendeKorrekturenAn(cues, korrekturen) {
  return cues.map((c) => {
    let text = c.text;
    for (const [alt, neu] of korrekturen) {
      text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(alt)}(?![\\p{L}\\p{N}])`, "giu"), neu);
    }
    return { ...c, text: text.replace(/\s+/g, " ").trim() };
  }).filter((c) => c.text);
}

/** Bricht einen Text in höchstens zwei möglichst gleich lange Zeilen um. */
export function umbrechen(text, maxZeichen) {
  if (text.length <= maxZeichen) return [text];
  const woerter = text.split(" ");
  let beste = null;
  for (let i = 1; i < woerter.length; i++) {
    const a = woerter.slice(0, i).join(" ");
    const b = woerter.slice(i).join(" ");
    const laenge = Math.max(a.length, b.length);
    if (!beste || laenge < beste.laenge) beste = { zeilen: [a, b], laenge };
  }
  return beste ? beste.zeilen : [text];
}

/**
 * Zerlegt einen Text an Wortgrenzen in Stücke von höchstens `max` Zeichen: so wenige wie
 * möglich, ähnlich lang und bevorzugt nach Satzzeichen („Hi, Lukas hier, | ich teste jetzt mal“).
 */
export function zerlegen(text, max) {
  const woerter = text.split(" ");
  // beste[i]: günstigste Zerlegung der ersten i Wörter
  const beste = [{ kosten: 0, teile: [] }];
  for (let i = 1; i <= woerter.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      const teil = woerter.slice(j, i).join(" ");
      if (teil.length > max && i - j > 1) break;
      const mitten = i < woerter.length && !/[,.;:!?–]$/.test(teil);
      const kosten = beste[j].kosten + 100 + (Math.max(0, max - teil.length) ** 2) / max + (mitten ? max / 2 : 0);
      if (!beste[i] || kosten < beste[i].kosten) beste[i] = { kosten, teile: [...beste[j].teile, teil] };
    }
  }
  return beste[woerter.length].teile;
}

/**
 * Teilt zu lange Untertitel an Wortgrenzen auf (Zeit anteilig nach Zeichen),
 * damit nie mehr als `zeilen` Zeilen gleichzeitig stehen.
 */
export function aufteilen(cues, maxZeichen, zeilen = 2) {
  const ergebnis = [];
  for (const c of cues) {
    if (c.text.length <= maxZeichen * zeilen) {
      ergebnis.push(c);
      continue;
    }
    const teile = zerlegen(c.text, maxZeichen * zeilen);
    const gesamt = teile.reduce((n, t) => n + t.length, 0);
    let start = c.start;
    for (const [i, t] of teile.entries()) {
      const end = i === teile.length - 1 ? c.end : Math.round(start + ((c.end - c.start) * t.length) / gesamt);
      ergebnis.push({ start, end, text: t });
      start = end;
    }
  }
  return ergebnis;
}

/** #RRGGBB → ASS-Farbe &HAABBGGRR (Alpha 00 = deckend) */
export function assFarbe(hex, alpha = 0) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) throw new Error(`Ungültige Farbe: ${hex}`);
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `&H${a}${m[3]}${m[2]}${m[1]}`.toUpperCase();
}

function assText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")");
}

/**
 * @param {{start:number,end:number,text:string}[]} cues
 * @param {{breite:number, hoehe:number, schrift:string, farbe:string, rand:string,
 *          stil:"rand"|"box", position:number}} o
 *   position: Abstand der Untertitel vom unteren Rand, Anteil der Bildhöhe
 */
/** Schriftgröße der Untertitel in Pixeln – auch für die Lage der Bauchbinde gebraucht. */
export function untertitelGroesse({ breite, hoehe }) {
  return Math.round(Math.min(breite, hoehe) * (hoehe > breite ? 0.062 : 0.058));
}

/** Wählbare Lagen pro Video; „unten“ ist die Einstellung aus der .env. */
export const UNTERTITEL_LAGEN = { oben: { hochkant: 0.62, quer: 0.8 }, mitte: { hochkant: 0.47, quer: 0.42 }, logobereich: { hochkant: 0.80, quer: 0.8 } };

/**
 * Abstand der Untertitel vom unteren Rand (Anteil der Bildhöhe) nach Format und gewählter Lage.
 * Hochkant liegt der Standard über dem Bereich, den TikTok und Reels für Name und Caption brauchen.
 */
export function untertitelPosition(o) {
  const hochkant = o.hoehe > o.breite;
  if (o.lage === "logobereich" && hochkant) {
    // Den ganzen Block unter der oberen UI-Leiste halten, auch bei zwei Zeilen.
    return 1 - 0.15 - untertitelGroesse(o) * 1.3 * (o.zeilen === 1 ? 1 : 2) / o.hoehe;
  }
  const lage = UNTERTITEL_LAGEN[o.lage]?.[hochkant ? "hochkant" : "quer"];
  // positionFest: von der Story-Fassung vorgegeben (direkt unter dem Bild); 📍 Position geht vor
  return lage ?? o.positionFest ?? (hochkant ? o.position : (o.positionQuer ?? 0.08));
}

export function zuAss(cues, o) {
  const hochkant = o.hoehe > o.breite;
  const groesse = untertitelGroesse(o);
  // Hochkant: 24 Zeichen Inter Bold sind gut 2/3 der Breite – frei von der Knopfleiste rechts (Like, Kommentar, Teilen)
  const maxZeichen = hochkant ? 24 : 38;
  const rahmen = Math.max(2, Math.round(groesse * 0.09));
  const box = o.stil === "box";

  const style = [
    "Untertitel",
    o.schrift,
    groesse,
    assFarbe(o.farbe), // Primary
    assFarbe(o.farbe), // Secondary
    box ? assFarbe(o.rand, 0.25) : assFarbe(o.rand), // Outline (bei Box: Kastenfarbe)
    assFarbe("#000000", 0.5), // Shadow
    -1, 0, 0, 0, // Bold, Italic, Underline, StrikeOut
    100, 100, 0, 0, // ScaleX, ScaleY, Spacing, Angle
    box ? 3 : 1, // BorderStyle: 1 = Rand, 3 = Kasten
    box ? Math.round(groesse * 0.25) : rahmen,
    box ? 0 : Math.round(rahmen / 2),
    2, // Alignment: unten mittig
    Math.round(o.breite * 0.06),
    Math.round(o.breite * 0.06),
    Math.round(o.hoehe * untertitelPosition(o)),
    1,
  ].join(",");

  // 1 = kurze Häppchen in einer Zeile, 2 = bis zu zwei Zeilen
  const zeilen = o.zeilen === 1 ? 1 : 2;
  const events = aufteilen(cues, maxZeichen, zeilen).map(
    (c) =>
      `Dialogue: 0,${assZeit(c.start)},${assZeit(c.end)},Untertitel,,0,0,0,,${zeilen === 1 ? assText(c.text) : umbrechen(assText(c.text), maxZeichen).join("\\N")}`,
  );

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${o.breite}
PlayResY: ${o.hoehe}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${style}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

/** Fließtext der Untertitel, z. B. als Grundlage für die Caption. */
export function volltext(cues) {
  return cues.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim();
}

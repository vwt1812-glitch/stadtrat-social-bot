// Versteht Zeitangaben, wie man sie in Telegram tippt:
// „jetzt“, „heute 18 Uhr“, „morgen 9:30“, „Fr 12:00“, „nächsten Montag 8“,
// „24.10. 18:00“, „24.10.2026 18.30 Uhr“, „18:00“, „in 2 Stunden“, „in 30 min“.
// Rechnet in der lokalen Zeitzone des Prozesses (der Bot setzt TZ beim Start).

const WOCHENTAGE = [
  ["so", "sonntag"],
  ["mo", "montag"],
  ["di", "dienstag"],
  ["mi", "mittwoch"],
  ["do", "donnerstag"],
  ["fr", "freitag"],
  ["sa", "samstag"],
];

const FORMAT = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** „Fr., 24.10., 18:00“ */
export function zeitText(date) {
  return FORMAT.format(date);
}

function uhrzeit(text) {
  // 18:00 · 18.30 Uhr · 18 Uhr · um 9
  let m = text.match(/\b(\d{1,2})[:.](\d{2})\b(?!\.)(?:\s*uhr)?/);
  if (!m) m = text.match(/\b(\d{1,2})\s*uhr\b/);
  if (!m) m = text.match(/\bum\s+(\d{1,2})\b/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return { h, min, rest: text.replace(m[0], " ") };
}

/**
 * @param {string} eingabe
 * @param {Date} [jetzt]
 * @returns {Date | null} null, wenn nicht verstanden oder in der Vergangenheit
 */
export function parseZeit(eingabe, jetzt = new Date()) {
  const text = eingabe.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/^(jetzt|sofort|gleich)$/.test(text)) return new Date(jetzt);

  const relativ = text.match(/^in (\d+)\s*(min|minuten|m|std|stunden|stunde|h|tagen|tag|tage|d)$/);
  if (relativ) {
    const n = Number(relativ[1]);
    const einheit = relativ[2];
    const ms = /^(min|minuten|m)$/.test(einheit) ? 60e3 : /^(std|stunden|stunde|h)$/.test(einheit) ? 3600e3 : 86400e3;
    return new Date(jetzt.getTime() + n * ms);
  }

  // Datum zuerst herauslösen, damit „24.10.“ nicht als Uhrzeit gilt
  let tag = null;
  let rest = text;
  const datum = rest.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
  if (datum) {
    let jahr = datum[3] ? Number(datum[3]) : jetzt.getFullYear();
    if (jahr < 100) jahr += 2000;
    tag = new Date(jahr, Number(datum[2]) - 1, Number(datum[1]));
    if (tag.getMonth() !== Number(datum[2]) - 1) return null;
    // ohne Jahr und schon vorbei → nächstes Jahr
    if (!datum[3] && tag < new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate())) {
      tag.setFullYear(jahr + 1);
    }
    rest = rest.replace(datum[0], " ");
  }

  const zeit = uhrzeit(rest);
  if (zeit) rest = zeit.rest;

  const heute = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  // \b kennt keine Umlaute, daher in Wörter zerlegen
  const woerter = rest.split(/[^\p{L}]+/u).filter(Boolean);
  const plusTage = (n) => {
    const d = new Date(heute);
    d.setDate(d.getDate() + n);
    return d;
  };
  let wochentagGenannt = false;
  if (!tag) {
    if (woerter.includes("übermorgen")) tag = plusTage(2);
    else if (woerter.includes("morgen")) tag = plusTage(1);
    else if (woerter.includes("heute")) tag = plusTage(0);
    else {
      const ziel = WOCHENTAGE.findIndex((namen) => namen.some((n) => woerter.includes(n)));
      if (ziel >= 0) {
        let diff = (ziel - heute.getDay() + 7) % 7;
        if (woerter.some((w) => /^nächste[nrs]?$/.test(w)) && diff === 0) diff = 7;
        tag = plusTage(diff);
        wochentagGenannt = true;
      }
    }
  }

  if (!tag && !zeit) return null;

  const ergebnis = new Date(tag ?? heute);
  ergebnis.setHours(zeit ? zeit.h : 12, zeit ? zeit.min : 0, 0, 0);

  if (ergebnis <= jetzt) {
    if (!tag) ergebnis.setDate(ergebnis.getDate() + 1); // nur Uhrzeit → morgen
    else if (wochentagGenannt) ergebnis.setDate(ergebnis.getDate() + 7); // heute schon vorbei → nächste Woche
    else return null;
  }
  return ergebnis;
}

/** Schnellauswahl für die Buttons: [Beschriftung, Date] */
export function vorschlaege(jetzt = new Date()) {
  const liste = [];
  const um = (tage, h, min = 0) => {
    const d = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + tage, h, min);
    return d;
  };
  const heute18 = um(0, 18);
  if (heute18.getTime() - jetzt.getTime() > 30 * 60e3) liste.push(["Heute 18:00", heute18]);
  liste.push(["Morgen 7:30", um(1, 7, 30)]);
  liste.push(["Morgen 12:00", um(1, 12)]);
  liste.push(["Morgen 18:00", um(1, 18)]);
  return liste;
}

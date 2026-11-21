// Ein fester Ausschnitt bleibt bevorzugt. Bei langsamer Bewegung folgt er
// innerhalb der gesicherten Zeitspanne; unbekannte Ränder bleiben vollständig.
// Ohne sichere Gesichtsfunde bleibt die vollständige Aufnahme sichtbar.
export const AUSSCHNITT_VERSION = 3;

/** Gültige Zeitabschnitte; außerhalb bleibt das vollständige Bild sichtbar. */
export function ausschnittAktiv(ausschnitt, t) {
  return (ausschnitt.bereiche ?? [{ ab: ausschnitt.ab ?? 0, bis: ausschnitt.bis ?? Infinity }])
    .some((b) => t >= b.ab && t <= b.bis);
}

export function ausschnittAktivFilter(ausschnitt) {
  return (ausschnitt.bereiche ?? [{ ab: ausschnitt.ab, bis: ausschnitt.bis }])
    .map((b) => `between(t,${b.ab},${b.bis})`).join("+");
}

/** Kurze Erklärung für die Vorschau, damit ein Fallback nicht wie ein Fehler wirkt. */
export function ausschnittHinweis(funde, ausschnitt) {
  if (ausschnitt) {
    const ab = Math.ceil(ausschnitt.ab ?? 0);
    return `${ausschnitt.punkte ? "Ausschnitt mit ruhiger Nachführung" : "Automatischer Ausschnitt"}${ab > 0 ? ` ab ${Math.floor(ab / 60)}:${String(ab % 60).padStart(2, "0")}; davor vollständiges Bild` : ""}${ausschnitt.bereiche?.length > 1 ? "; bei Wacklern oder unsicheren Stellen zwischendurch vollständiges Bild" : ""}`;
  }
  if (!funde) return "Gesichtserkennung nicht verfügbar; vollständiges Bild";
  const anzahl = new Set((funde.gesichter ?? []).map((g) => g.t)).size;
  if (anzahl < Math.ceil(funde.bilder * 0.9)) return `Gesicht nur in ${anzahl} von ${funde.bilder} Probebildern erkannt; vollständiges Bild`;
  return "Kein sicherer Hochkant-Ausschnitt gefunden; vollständiges Bild";
}

export function hochkantAusschnitt(original, funde) {
  const { breite, hoehe } = original;
  if (!(Number.isFinite(breite) && Number.isFinite(hoehe) && breite > hoehe && hoehe >= 32) || !funde?.alleGesichter ||
      !Number.isInteger(funde.bilder) || funde.bilder < 12 || !funde.gesichter?.length) return null;
  const gruppen = new Map();
  for (const g of funde.gesichter) {
    if (![g.t, g.x, g.y, g.w, g.h].every(Number.isFinite) ||
        g.t < 0 || g.x < 0 || g.y < 0 || g.w <= 0 || g.h <= 0 ||
        g.x + g.w > 1 || g.y + g.h > 1) return null;
    if (!gruppen.has(g.t)) gruppen.set(g.t, []);
    gruppen.get(g.t).push(g);
  }
  const dicht = funde.version === AUSSCHNITT_VERSION && funde.dicht && Array.isArray(funde.zeiten) &&
    (funde.zeiten.at(-1) - funde.zeiten[0]) / (funde.zeiten.length - 1) <= 0.55;
  // Bei dichter Analyse entscheidet jeder ruhige Abschnitt für sich. Ein
  // längerer Anfang ohne Gesicht darf nicht den gut erkannten Rest ausschließen.
  // Alte, weit verteilte Probebilder bleiben an die bisherige Quote gebunden.
  if ((!dicht && gruppen.size < Math.ceil(funde.bilder * 0.9)) || gruppen.size > funde.bilder) return null;
  const h = Math.floor(hoehe / 2) * 2;
  const w = Math.round(h * 9 / 16 / 2) * 2;
  // Chroma-kompatible Maße; das genaue Zielformat entsteht beim Skalieren.
  if (w % 2) return null;
  const y = Math.floor((hoehe - h) / 4) * 2;
  let minX = 0, maxX = breite - w;
  const rahmen = [];
  for (const [t, personen] of [...gruppen].sort((a, b) => a[0] - b[0])) {
    let von = 0, bis = breite - w;
    let passt = true;
    for (const g of personen) {
      // Im Hochkant-Interview darf der Oberkörper angeschnitten werden;
      // Kopf und seitlicher Abstand bleiben vollständig im Ausschnitt.
      const links = (g.x - g.w * 0.18) * breite;
      const rechts = (g.x + g.w * 1.18) * breite;
      // Die Originalhöhe erhalten: Kopfabstand darf nicht mehr verlangen,
      // als die Kamera überhaupt aufgenommen hat.
      if (Math.max(0, g.y - g.h * 0.35) * hoehe < y ||
          Math.min(1, g.y + g.h * 1.15) * hoehe > y + h) passt = false;
      von = Math.max(von, rechts - w);
      bis = Math.min(bis, links);
    }
    von = Math.ceil(von / 2) * 2;
    bis = Math.floor(bis / 2) * 2;
    if (!passt || von > bis) {
      if (dicht) continue;
      return null;
    }
    rahmen.push({ t, von, bis });
    minX = Math.max(minX, von);
    maxX = Math.min(maxX, bis);
  }
  if (!rahmen.length) return null;
  const links = Math.ceil(minX / 2) * 2;
  const rechts = Math.floor(maxX / 2) * 2;
  const mitte = funde.gesichter.reduce((sum, g) => sum + (g.x + g.w / 2) * breite, 0) / funde.gesichter.length;
  const ziel = Math.round((mitte - w / 2) / 2) * 2;
  const basis = { x: Math.max(links, Math.min(rechts, ziel)), y, breite: w, hoehe: h };
  // Bewegte Ausschnitte nur mit der neuen Erkennung und bekannten Probebildzeiten.
  if (funde.version !== AUSSCHNITT_VERSION || !Array.isArray(funde.zeiten)) {
    return links <= rechts ? basis : null;
  }
  const zeiten = funde.zeiten;
  if (zeiten.length !== funde.bilder || !zeiten.every((t, i) => Number.isFinite(t) && t >= 0 && (!i || t > zeiten[i - 1])) ||
      rahmen.some((p) => !zeiten.includes(p.t))) return null;
  const schritt = (zeiten.at(-1) - zeiten[0]) / (zeiten.length - 1);
  if (!(schritt > 0)) return null;
  const ab = rahmen[0].t === zeiten[0] ? 0 : rahmen[0].t;
  const bis = funde.dicht ? rahmen.at(-1).t : (rahmen.at(-1).t === zeiten.at(-1) ? (original.dauer ?? zeiten.at(-1)) : rahmen.at(-1).t);
  if (!funde.dicht || schritt > 0.55) return links <= rechts ? { ...basis, ab, bis } : null;
  const fest = links <= rechts;
  let x = Math.max(rahmen[0].von, Math.min(rahmen[0].bis, ziel));
  const abschnitte = [];
  let punkte = [];
  for (const p of rahmen) {
    const mitteX = Math.round((p.von + p.bis) / 4) * 2;
    // Kleine Bewegungen ignorieren, größere zur Mitte hin ausgleichen.
    let naechstesX = fest ? basis.x : Math.max(p.von, Math.min(p.bis, Math.abs(mitteX - x) > w * 0.08 ? mitteX : x));
    const vorher = punkte.at(-1);
    if (vorher && (p.t - vorher.t > schritt * 1.1 ||
        Math.abs(naechstesX - x) / (p.t - vorher.t) > breite * 0.35)) {
      abschnitte.push(punkte);
      punkte = [];
      // Nach einem Wackler neu ausrichten, statt vom alten Ausschnitt aus zu fahren.
      naechstesX = fest ? basis.x : mitteX;
    }
    x = naechstesX;
    punkte.push({ t: p.t, x });
  }
  abschnitte.push(punkte);
  // Nur ausreichend lange ruhige Abschnitte verwenden; kurze Fehlfunde und
  // das Ausrichten der Kamera am Anfang dürfen keinen hektischen Wechsel erzeugen.
  const sichere = abschnitte.filter((p) => p.at(-1).t - p[0].t >= 2);
  if (!sichere.length) return null;
  const bereiche = sichere.map((p) => ({ ab: p[0].t === zeiten[0] ? 0 : p[0].t, bis: p.at(-1).t }));
  const allePunkte = sichere.flat();
  return { ...basis, x: allePunkte[0].x, ab: bereiche[0].ab, bis: bereiche.at(-1).bis,
    bereiche, ...(fest ? {} : { punkte: allePunkte }) };
}

export function ausschnittX(ausschnitt, t) {
  const p = ausschnitt.punkte;
  if (!p?.length) return ausschnitt.x;
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i].t) {
      const u = Math.max(0, Math.min(1, (t - p[i - 1].t) / (p[i].t - p[i - 1].t)));
      return p[i - 1].x + (p[i].x - p[i - 1].x) * u * u * (3 - 2 * u);
    }
  }
  return p.at(-1).x;
}

/** Kleine einzelne Ausdrücke statt eines riesigen verschachtelten Filterarguments. */
export function ausschnittKommandos(ausschnitt) {
  const p = ausschnitt.punkte;
  if (!p?.length) return "";
  return p.map((a, i) => {
    const b = p[i + 1];
    if (!b) return `${a.t} crop@hochkant x '${a.x}';`;
    const u = `clip((t-${a.t})/${b.t - a.t},0,1)`;
    return `${a.t} crop@hochkant x '${a.x}+${b.x - a.x}*pow(${u},2)*(3-2*${u})';`;
  }).join("\n");
}

export function gesichterImAusschnitt(gesichter, original, ausschnitt, masse = { breite: 9, hoehe: 16 }) {
  const faktor = Math.min(masse.breite / original.breite, masse.hoehe / original.hoehe);
  const bw = original.breite * faktor / masse.breite;
  const bh = original.hoehe * faktor / masse.hoehe;
  return gesichter.map((g) => !ausschnittAktiv(ausschnitt, g.t ?? 0) ? {
    ...g, x: (1 - bw) / 2 + g.x * bw, y: (1 - bh) / 2 + g.y * bh, w: g.w * bw, h: g.h * bh,
  } : ({
    ...g,
    x: (g.x * original.breite - ausschnittX(ausschnitt, g.t ?? 0)) / ausschnitt.breite,
    y: (g.y * original.hoehe - ausschnitt.y) / ausschnitt.hoehe,
    w: g.w * original.breite / ausschnitt.breite,
    h: g.h * original.hoehe / ausschnitt.hoehe,
  }));
}

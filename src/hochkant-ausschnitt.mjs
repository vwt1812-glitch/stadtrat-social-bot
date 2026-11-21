// Ein fester Ausschnitt bleibt bevorzugt. Bei langsamer Bewegung folgt er
// innerhalb der gesicherten Zeitspanne; unbekannte Ränder bleiben vollständig.
// Ohne sichere Gesichtsfunde bleibt die vollständige Aufnahme sichtbar.
export const AUSSCHNITT_VERSION = 2;

/** Kurze Erklärung für die Vorschau, damit ein Fallback nicht wie ein Fehler wirkt. */
export function ausschnittHinweis(funde, ausschnitt) {
  if (ausschnitt) {
    const ab = Math.ceil(ausschnitt.ab ?? 0);
    return `${ausschnitt.punkte ? "Ausschnitt mit ruhiger Nachführung" : "Automatischer Ausschnitt"}${ab > 0 ? ` ab ${Math.floor(ab / 60)}:${String(ab % 60).padStart(2, "0")}; davor vollständiges Bild` : ""}`;
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
  // Mehrere Gesichter im selben Bild zählen nicht als mehrere erfolgreiche Probebilder.
  if (gruppen.size < Math.ceil(funde.bilder * 0.9) || gruppen.size > funde.bilder) return null;
  const h = Math.floor(hoehe / 32) * 32;
  const w = h * 9 / 16;
  // Chroma-kompatible Maße bei exakt 9:16.
  if (w % 2) return null;
  const y = Math.floor((hoehe - h) / 4) * 2;
  let minX = 0, maxX = breite - w;
  const rahmen = [];
  for (const [t, personen] of [...gruppen].sort((a, b) => a[0] - b[0])) {
    let von = 0, bis = breite - w;
    for (const g of personen) {
      // Im Hochkant-Interview darf der Oberkörper angeschnitten werden;
      // Kopf und seitlicher Abstand bleiben vollständig im Ausschnitt.
      const links = (g.x - g.w * 0.18) * breite;
      const rechts = (g.x + g.w * 1.18) * breite;
      if (g.y * hoehe - g.h * hoehe * 0.35 < y ||
          (g.y + g.h * 1.15) * hoehe > y + h) return null;
      von = Math.max(von, rechts - w);
      bis = Math.min(bis, links);
    }
    von = Math.ceil(von / 2) * 2;
    bis = Math.floor(bis / 2) * 2;
    if (von > bis) return null;
    rahmen.push({ t, von, bis });
    minX = Math.max(minX, von);
    maxX = Math.min(maxX, bis);
  }
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
  // Größere Erkennungslücken oder schnelle Bildsprünge sind keine sichere Grundlage.
  if (rahmen.some((p, i) => i && p.t - rahmen[i - 1].t > schritt * 2.1)) return null;
  const ab = rahmen[0].t === zeiten[0] ? 0 : rahmen[0].t;
  const bis = rahmen.at(-1).t === zeiten.at(-1) ? (original.dauer ?? zeiten.at(-1)) : rahmen.at(-1).t;
  if (links <= rechts) return { ...basis, ab, bis };
  let x = Math.max(rahmen[0].von, Math.min(rahmen[0].bis, ziel));
  const punkte = [];
  for (const p of rahmen) {
    const mitteX = Math.round((p.von + p.bis) / 4) * 2;
    // Kleine Bewegungen ignorieren, größere zur Mitte hin ausgleichen.
    const naechstesX = Math.max(p.von, Math.min(p.bis, Math.abs(mitteX - x) > w * 0.08 ? mitteX : x));
    const vorher = punkte.at(-1);
    if (vorher && Math.abs(naechstesX - x) / (p.t - vorher.t) > breite * 0.08) return null;
    x = naechstesX;
    punkte.push({ t: p.t, x });
  }
  return { ...basis, x: punkte[0].x, ab, bis, punkte };
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

/** Dieselbe ruhige Interpolation wie bei den Layout-Koordinaten, in FFmpeg-Syntax. */
export function ausschnittXFilter(ausschnitt) {
  const p = ausschnitt.punkte;
  if (!p?.length) return String(ausschnitt.x);
  let wert = String(p.at(-1).x);
  for (let i = p.length - 1; i > 0; i--) {
    const a = p[i - 1], b = p[i];
    const u = `clip((t-${a.t})/${b.t - a.t},0,1)`;
    const x = a.x === b.x ? String(a.x) : `${a.x}+${b.x - a.x}*pow(${u},2)*(3-2*${u})`;
    wert = `if(lt(t,${b.t}),${x},${wert})`;
  }
  return wert;
}

export function gesichterImAusschnitt(gesichter, original, ausschnitt) {
  return gesichter.map((g) => ({
    ...g,
    x: (g.x * original.breite - ausschnittX(ausschnitt, g.t ?? 0)) / ausschnitt.breite,
    y: (g.y * original.hoehe - ausschnitt.y) / ausschnitt.hoehe,
    w: g.w * original.breite / ausschnitt.breite,
    h: g.h * original.hoehe / ausschnitt.hoehe,
  }));
}

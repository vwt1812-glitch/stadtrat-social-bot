// Bewusst ein fester Ausschnitt: kein springender Bildausschnitt bei Bewegung.
// Ohne sichere Gesichtsfunde bleibt die vollständige Aufnahme sichtbar.
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
  for (const g of funde.gesichter) {
    // Kopf und Schultern mitnehmen; auch ein zweites kleineres Gesicht schützen.
    const links = (g.x - g.w * 0.6) * breite;
    const rechts = (g.x + g.w * 1.6) * breite;
    if (g.y * hoehe - g.h * hoehe * 0.35 < y ||
        (g.y + g.h * 1.15) * hoehe > y + h) return null;
    minX = Math.max(minX, rechts - w);
    maxX = Math.min(maxX, links);
  }
  const links = Math.ceil(minX / 2) * 2;
  const rechts = Math.floor(maxX / 2) * 2;
  if (links > rechts) return null;
  const mitte = funde.gesichter.reduce((sum, g) => sum + (g.x + g.w / 2) * breite, 0) / funde.gesichter.length;
  const x = Math.max(links, Math.min(rechts, Math.round((mitte - w / 2) / 2) * 2));
  return { x, y, breite: w, hoehe: h };
}

export function gesichterImAusschnitt(gesichter, original, ausschnitt) {
  return gesichter.map((g) => ({
    ...g,
    x: (g.x * original.breite - ausschnitt.x) / ausschnitt.breite,
    y: (g.y * original.hoehe - ausschnitt.y) / ausschnitt.hoehe,
    w: g.w * original.breite / ausschnitt.breite,
    h: g.h * original.hoehe / ausschnitt.hoehe,
  }));
}

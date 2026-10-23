// Gemeinsame Geometrie für 9:16-Storys, Reels und TikTok.
// Die Werte sind konservative Arbeitsbereiche, keine von Plattformen garantierten Pixelgrenzen.
export const SAFE_AREAS = Object.freeze({
  story: { top: 0.14, bottom: 0.16, left: 0.05, right: 0.05 },
  reel: { top: 0.14, bottom: 0.23, left: 0.06, right: 0.16 },
  normal: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
});

/** Sichere Koordinaten, in denen ein Element vollständig liegen muss. */
export function sichereZone(masse, modus = "story") {
  const werte = SAFE_AREAS[modus] ?? SAFE_AREAS.story;
  return {
    links: Math.round(masse.breite * werte.left),
    rechts: Math.round(masse.breite * (1 - werte.right)),
    oben: Math.round(masse.hoehe * werte.top),
    unten: Math.round(masse.hoehe * (1 - werte.bottom)),
  };
}

const gerade = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Exakte Position des unverzerrten Vordergrunds im unscharfen Story-Hintergrund. */
export function bildRechteck(original, masse, maximalHoehe = masse.hoehe) {
  const faktor = Math.min(masse.breite / original.breite, maximalHoehe / original.hoehe);
  const breite = gerade(original.breite * faktor);
  const hoehe = gerade(original.hoehe * faktor);
  return {
    links: Math.round((masse.breite - breite) / 2),
    rechts: Math.round((masse.breite + breite) / 2),
    oben: Math.round((masse.hoehe - hoehe) / 2),
    unten: Math.round((masse.hoehe + hoehe) / 2),
    breite, hoehe,
  };
}

/** OpenCV liefert 0..1 relativ zum Originalvideo; auf die 9:16-Fläche übertragen. */
export function gesichterUebertragen(gesichter = [], bild, masse) {
  if (!bild) return gesichter;
  return gesichter.map((g) => ({
    x: (bild.links + g.x * bild.breite) / masse.breite,
    y: (bild.oben + g.y * bild.hoehe) / masse.hoehe,
    w: (g.w * bild.breite) / masse.breite,
    h: (g.h * bild.hoehe) / masse.hoehe,
  }));
}

const ueberschneidet = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const innerhalb = (r, safe) =>
  r.x >= safe.links && r.y >= safe.oben && r.x + r.w <= safe.rechts && r.y + r.h <= safe.unten;

/**
 * Logo auf unscharfer Fläche bevorzugen, ansonsten freie Ecken.
 * Die Gesichtserkennung betrifft sämtliche untersuchten Einzelbilder, nicht nur einen Frame.
 * Der manuelle Wunsch wählt eine Position, bleibt aber immer innerhalb der Plattform-Safe-Area.
 */
export function logoPlatzierung({
  masse, breite, hoehe, bild = null, gesichter = [], modus = "story", wunsch = "auto",
}) {
  const safe = sichereZone(masse, modus);
  const rand = Math.round(Math.min(masse.breite, masse.hoehe) * 0.05);
  const mitteX = Math.round((masse.breite - breite) / 2);
  const links = safe.links;
  const rechts = safe.rechts - breite;
  const oben = safe.oben;
  const unten = safe.unten - hoehe;
  const kandidat = (x, y, typ) => ({ x: Math.round(x), y: Math.round(y), w: breite, h: hoehe, typ });
  const kandidaten = [];
  if (bild && wunsch === "auto") {
    kandidaten.push(kandidat(mitteX, bild.oben - 48 - hoehe, "blur-oben"));
    kandidaten.push(kandidat(mitteX, bild.unten + 48, "blur-unten"));
  }
  const standard = {
    "oben-links": kandidat(links, oben, "oben-links"),
    "oben-mitte": kandidat(mitteX, oben, "oben-mitte"),
    "oben-rechts": kandidat(rechts, oben, "oben-rechts"),
    "unten-links": kandidat(links, unten, "unten-links"),
    "unten-mitte": kandidat(mitteX, unten, "unten-mitte"),
    "unten-rechts": kandidat(rechts, unten, "unten-rechts"),
  };
  if (wunsch !== "auto" && standard[wunsch]) kandidaten.push(standard[wunsch]);
  kandidaten.push(standard["oben-links"], standard["oben-rechts"], standard["oben-mitte"],
    standard["unten-links"], standard["unten-rechts"], standard["unten-mitte"]);
  const gueltige = kandidaten.filter((r) => innerhalb(r, safe));
  if (!gueltige.length) return null;
  const gesichterRechtecke = gesichter.map((g) => ({
    x: (g.x - 0.04) * masse.breite, y: (g.y - 0.04) * masse.hoehe,
    w: (g.w + 0.08) * masse.breite, h: (g.h + 0.08) * masse.hoehe,
  }));
  // Erst freie Position wählen. Bei Konflikten die mit den wenigsten Gesichtsüberschneidungen.
  const mitTreffern = gueltige.map((r) => ({
    ...r, treffer: gesichterRechtecke.filter((g) => ueberschneidet(r, g)).length,
  }));
  mitTreffern.sort((a, b) => a.treffer - b.treffer);
  return { x: mitTreffern[0].x, y: mitTreffern[0].y, typ: mitTreffern[0].typ };
}

/** Vertikale Position einer Textkarte: freie Blur-Fläche, sonst Bildmitte innerhalb Safe Area. */
export function storyTextPlatzierung({ masse, hoehe, bild = null, logo = null, wunsch = "auto" }) {
  const safe = sichereZone(masse, "story");
  const padding = 24;
  const moegliche = [];
  if (bild && wunsch === "auto") {
    moegliche.push(bild.unten + padding, bild.oben - padding - hoehe);
  }
  if (wunsch === "oben") moegliche.push(safe.oben + padding);
  if (wunsch === "unten") moegliche.push(safe.unten - hoehe - padding);
  moegliche.push(Math.round((safe.oben + safe.unten - hoehe) / 2));
  for (const y of moegliche) {
    if (y < safe.oben || y + hoehe > safe.unten) continue;
    if (logo && y < logo.y + logo.h + padding && y + hoehe > logo.y - padding) continue;
    return Math.round(y);
  }
  // Lieber auf eine freie Safe-Area-Position als unter Plattform-UI zeichnen.
  return Math.max(safe.oben, Math.min(safe.unten - hoehe, Math.round((safe.oben + safe.unten - hoehe) / 2)));
}

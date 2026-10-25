// Manuell bestätigte Quellenmetadaten, unabhängig von Caption und KI.
export const VERFAHRENSSTAENDE = ["ungeprüft", "eingereicht", "in Beratung", "beschlossen", "abgelehnt", "umgesetzt"];

const FELDER = {
  Titel: "titel", Datum: "dokumentDatum", Aktenzeichen: "aktenzeichen", Link: "url",
  Stand: "stand", Standdatum: "standDatum", Beleg: "standBeleg", Wiedervorlage: "wiedervorlage",
};

function datumGueltig(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function quellenVorlage(q = {}) {
  return Object.entries(FELDER).map(([label, feld]) => `${label}: ${q[feld] || (feld === "stand" ? "ungeprüft" : "-")}`).join("\n");
}

export function quellenBearbeiten(text, bisher = {}) {
  const q = { ...bisher };
  let erkannt = false;
  const gesehen = new Set();
  for (const zeile of text.trim().split(/\r?\n/)) {
    if (!zeile.trim()) continue;
    const m = zeile.match(/^([^:]+):\s*(.*)$/);
    const label = m?.[1].trim();
    const feld = FELDER[label];
    if (!feld || gesehen.has(feld)) throw new Error("Bitte die Quellenvorlage mit eindeutigen Feldnamen zurückschicken.");
    gesehen.add(feld);
    const wert = m[2].trim();
    if (wert.length > (feld === "standBeleg" ? 1000 : 300)) throw new Error(`${label} ist zu lang.`);
    q[feld] = wert === "-" ? "" : wert;
    erkannt = true;
  }
  if (!erkannt) throw new Error("Keine Quellenfelder erkannt.");
  q.stand ||= "ungeprüft";
  if (!VERFAHRENSSTAENDE.includes(q.stand)) throw new Error(`Stand: ${VERFAHRENSSTAENDE.join(", ")}`);
  for (const feld of ["dokumentDatum", "standDatum", "wiedervorlage"]) {
    if (q[feld] && !datumGueltig(q[feld])) throw new Error("Datumsangaben bitte als JJJJ-MM-TT eingeben.");
  }
  if (q.url) {
    let url;
    try { url = new URL(q.url); } catch { throw new Error("Bitte einen vollständigen Quellenlink angeben."); }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Quellenlinks müssen HTTP oder HTTPS ohne Zugangsdaten verwenden.");
  }
  if (q.stand !== "ungeprüft" && (!q.standDatum || !q.standBeleg)) {
    throw new Error("Ein bestätigter Stand braucht Standdatum und Beleg (z. B. Quellenlink und Seite).");
  }
  return { ...q, geprueft: new Date().toISOString() };
}

export function quellenZeilen(q, passage) {
  if (!q) return [];
  return [
    q.dateiname && `Datei: ${q.dateiname}`,
    q.titel && `Titel: ${q.titel}`,
    q.dokumentDatum && `Dokumentdatum: ${q.dokumentDatum}`,
    q.aktenzeichen && `Aktenzeichen: ${q.aktenzeichen}`,
    passage?.seiten?.length && `Auszug auf PDF-Seite(n): ${passage.seiten.join(", ")}`,
    q.url && `Quelle: ${q.url}`,
    `Verfahrensstand: ${q.stand || "ungeprüft"}${q.standDatum ? ` (${q.standDatum})` : ""}`,
    q.standBeleg && `Beleg zum Stand: ${q.standBeleg}`,
    q.wiedervorlage && `Wiedervorlage (nur Notiz, keine automatische Erinnerung): ${q.wiedervorlage}`,
    q.sha256 && `Dokumentversion (SHA-256): ${q.sha256}`,
  ].filter(Boolean);
}

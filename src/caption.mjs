// Caption-Vorschlag. Mit ANTHROPIC_API_KEY schreibt Claude den Text (bei Fotos
// mit Blick aufs Bild), ohne Schlüssel gibt es einen einfachen Vorschlag.

import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `Du schreibst Social-Media-Beiträge für Lukas Küffner, Stadtrat in Nürnberg für PIRATEN & Humanisten.
Grundlage ist je nach Beitrag das automatische Transkript eines Videos, ein oder mehrere Fotos und/oder Stichpunkte von Lukas.

So soll der Text sein:
- Deutsch, Du-Ansprache, klar und bürgernah, keine Floskeln und kein Parteisprech
- Erste Zeile: ein Satz, der neugierig macht und sagt, worum es geht
- Danach 1–3 kurze Absätze mit dem Kern; nichts erfinden, was nicht im Material steht
- Bei Fotos: beschreiben, was für den Anlass wichtig ist – keine Vermutungen über Namen von Personen
- Wenn es passt, eine Frage oder Aufforderung zum Mitreden am Ende
- Höchstens zwei Emojis
- Zum Schluss eine Zeile mit 3–6 passenden Hashtags
- Transkripte können Erkennungsfehler enthalten – offensichtliche Fehler stillschweigend korrigieren

Antworte nur mit dem fertigen Beitragstext, ohne Einleitung und ohne Anführungszeichen.`;

function auszug(text) {
  const saetze = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let ergebnis = "";
  for (const satz of saetze) {
    if ((ergebnis + satz).length > 280) break;
    ergebnis += satz;
  }
  return (ergebnis || text.slice(0, 280)).trim();
}

/** Vorschlag ohne Claude: eigener Text, sonst Auszug aus dem Transkript, sonst nur Hashtags. */
export function einfacherVorschlag({ transkript = "", notizen = "" }, hashtags) {
  if (notizen.trim()) return { text: notizen.trim(), quelle: "eigene" };
  if (transkript.trim()) return { text: `${auszug(transkript)}\n\n${hashtags}`.trim(), quelle: "transkript" };
  return { text: hashtags, quelle: "hashtags" };
}

/**
 * @param {object} material
 * @param {"video"|"foto"|"text"} material.art
 * @param {string} [material.transkript] erkannte Sprache (Video)
 * @param {string} [material.notizen] eigener Text bzw. Stichpunkte
 * @param {string[]} [material.bilder] verkleinerte JPEGs (Foto)
 * @param {string} [material.bisher] aktuelle Fassung, auf die sich der Hinweis bezieht
 * @param {{anthropicKey?:string, modell:string, stil:string, hashtags:string}} o
 * @param {string} [hinweis] Wunsch für die neue Fassung, z. B. „kürzer“
 * @returns {Promise<{text:string, quelle:"claude"|"transkript"|"eigene"|"hashtags", fehler?:string}>}
 */
export async function captionVorschlag(material, o, hinweis = "") {
  const { art, transkript = "", notizen = "", bilder = [], bisher = "" } = material;
  const nichtsDa = !transkript.trim() && !notizen.trim() && !bilder.length;
  if (!o.anthropicKey || nichtsDa) return einfacherVorschlag(material, o.hashtags);

  const client = new Anthropic({ apiKey: o.anthropicKey });
  let system = SYSTEM;
  if (o.stil) system += `\n\nZusätzliche Vorgaben:\n${o.stil}`;
  if (o.hashtags) system += `\n\nDiese Hashtags immer verwenden: ${o.hashtags}`;

  const artText = { video: "Video", foto: bilder.length > 1 ? `${bilder.length} Fotos (Karussell)` : "Foto", text: "reiner Textbeitrag" }[art];
  const inhalt = [];
  for (const bild of bilder.slice(0, 5)) {
    inhalt.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await fs.readFile(bild)).toString("base64") } });
  }
  let text = `Art des Beitrags: ${artText}`;
  if (transkript.trim()) text += `\n\nTranskript:\n<transkript>\n${transkript}\n</transkript>`;
  if (notizen.trim()) text += `\n\nText/Stichpunkte von Lukas:\n<notizen>\n${notizen}\n</notizen>`;
  if (hinweis && bisher.trim()) text += `\n\nBisherige Fassung:\n<bisher>\n${bisher}\n</bisher>`;
  if (hinweis) text += `\n\nWunsch für die neue Fassung: ${hinweis}`;
  inhalt.push({ type: "text", text });

  try {
    const antwort = await client.beta.messages.create({
      model: o.modell,
      max_tokens: 4000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: inhalt }],
    });
    if (antwort.stop_reason === "refusal") throw new Error("Claude hat die Anfrage abgelehnt.");
    const ergebnis = antwort.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!ergebnis) throw new Error("Leere Antwort.");
    return { text: ergebnis, quelle: "claude" };
  } catch (e) {
    const grund = e instanceof Anthropic.AuthenticationError ? "API-Schlüssel ungültig" : e.message;
    return { ...einfacherVorschlag(material, o.hashtags), fehler: grund };
  }
}

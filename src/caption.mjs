// Caption-Vorschlag. Mit API-Schlüssel schreibt eine KI den Text (Claude oder
// OpenAI, bei Fotos mit Blick aufs Bild), ohne Schlüssel gibt es einen einfachen Vorschlag.

import fs from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

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

async function fragClaude(o, system, bilder, text) {
  const client = new Anthropic({ apiKey: o.anthropicKey });
  const inhalt = bilder.map((b) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b } }));
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
    return antwort.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Anthropic-API-Schlüssel ungültig");
    throw e;
  }
}

async function fragOpenAI(o, system, bilder, text) {
  const client = new OpenAI({ apiKey: o.openaiKey, ...(o.openaiUrl ? { baseURL: o.openaiUrl } : {}) });
  const inhalt = bilder.map((b) => ({ type: "input_image", image_url: `data:image/jpeg;base64,${b}`, detail: "auto" }));
  inhalt.push({ type: "input_text", text });
  try {
    const antwort = await client.responses.create({
      model: o.modell,
      instructions: system,
      input: [{ role: "user", content: inhalt }],
    });
    return antwort.output_text;
  } catch (e) {
    if (e instanceof OpenAI.AuthenticationError) throw new Error("OpenAI-API-Schlüssel ungültig");
    throw e;
  }
}

/**
 * @param {object} material
 * @param {"video"|"foto"|"text"} material.art
 * @param {string} [material.transkript] erkannte Sprache (Video)
 * @param {string} [material.notizen] eigener Text bzw. Stichpunkte
 * @param {string[]} [material.bilder] verkleinerte JPEGs (Foto)
 * @param {string} [material.bisher] aktuelle Fassung, auf die sich der Hinweis bezieht
 * @param {{anbieter:"claude"|"openai"|null, anthropicKey?:string, openaiKey?:string, openaiUrl?:string,
 *          modell:string, stil:string, hashtags:string}} o
 * @param {string} [hinweis] Wunsch für die neue Fassung, z. B. „kürzer“
 * @returns {Promise<{text:string, quelle:"ki"|"transkript"|"eigene"|"hashtags", fehler?:string}>}
 */
export async function captionVorschlag(material, o, hinweis = "") {
  const { art, transkript = "", notizen = "", bilder = [], bisher = "" } = material;
  const nichtsDa = !transkript.trim() && !notizen.trim() && !bilder.length;
  if (!o.anbieter || nichtsDa) return einfacherVorschlag(material, o.hashtags);

  let system = SYSTEM;
  if (o.stil) system += `\n\nZusätzliche Vorgaben:\n${o.stil}`;
  if (o.hashtags) system += `\n\nDiese Hashtags immer verwenden: ${o.hashtags}`;

  const artText = { video: "Video", foto: bilder.length > 1 ? `${bilder.length} Fotos (Karussell)` : "Foto", text: "reiner Textbeitrag" }[art];
  let text = `Art des Beitrags: ${artText}`;
  if (transkript.trim()) text += `\n\nTranskript:\n<transkript>\n${transkript}\n</transkript>`;
  if (notizen.trim()) text += `\n\nText/Stichpunkte von Lukas:\n<notizen>\n${notizen}\n</notizen>`;
  if (hinweis && bisher.trim()) text += `\n\nBisherige Fassung:\n<bisher>\n${bisher}\n</bisher>`;
  if (hinweis) text += `\n\nWunsch für die neue Fassung: ${hinweis}`;

  try {
    const base64 = await Promise.all(bilder.slice(0, 5).map(async (b) => (await fs.readFile(b)).toString("base64")));
    const frag = o.anbieter === "openai" ? fragOpenAI : fragClaude;
    const ergebnis = (await frag(o, system, base64, text)).trim();
    if (!ergebnis) throw new Error("Leere Antwort.");
    return { text: ergebnis, quelle: "ki" };
  } catch (e) {
    return { ...einfacherVorschlag(material, o.hashtags), fehler: e.message };
  }
}

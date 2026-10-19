// Caption-Vorschlag aus dem Transkript. Mit ANTHROPIC_API_KEY schreibt Claude
// den Text, ohne Schlüssel gibt es einen einfachen Vorschlag aus dem Transkript.

import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `Du schreibst Social-Media-Captions für Lukas Küffner, Stadtrat in Nürnberg für PIRATEN & Humanisten.
Grundlage ist das automatische Transkript eines kurzen Videos (Instagram, TikTok, Facebook u. a.).

So soll die Caption sein:
- Deutsch, Du-Ansprache, klar und bürgernah, keine Floskeln und kein Parteisprech
- Erste Zeile: ein Satz, der neugierig macht und sagt, worum es geht
- Danach 1–3 kurze Absätze mit dem Kern; nichts erfinden, was nicht im Transkript steht
- Wenn es passt, eine Frage oder Aufforderung zum Mitreden am Ende
- Höchstens zwei Emojis
- Zum Schluss eine Zeile mit 3–6 passenden Hashtags
- Das Transkript kann Erkennungsfehler enthalten – offensichtliche Fehler stillschweigend korrigieren

Antworte nur mit der fertigen Caption, ohne Einleitung und ohne Anführungszeichen.`;

function einfacherVorschlag(transkript, hashtags) {
  const saetze = transkript.match(/[^.!?]+[.!?]+/g) ?? [transkript];
  let text = "";
  for (const satz of saetze) {
    if ((text + satz).length > 280) break;
    text += satz;
  }
  return `${(text || transkript.slice(0, 280)).trim()}\n\n${hashtags}`.trim();
}

/**
 * @param {string} transkript
 * @param {{anthropicKey?:string, modell:string, stil:string, hashtags:string}} o
 * @param {string} [hinweis] zusätzlicher Wunsch, z. B. „kürzer“ oder „mehr zum Haushalt“
 * @returns {Promise<{text:string, quelle:"claude"|"transkript", fehler?:string}>}
 */
export async function captionVorschlag(transkript, o, hinweis = "") {
  if (!transkript.trim()) return { text: o.hashtags, quelle: "transkript" };
  if (!o.anthropicKey) return { text: einfacherVorschlag(transkript, o.hashtags), quelle: "transkript" };

  const client = new Anthropic({ apiKey: o.anthropicKey });
  let system = SYSTEM;
  if (o.stil) system += `\n\nZusätzliche Vorgaben:\n${o.stil}`;
  if (o.hashtags) system += `\n\nDiese Hashtags immer verwenden: ${o.hashtags}`;

  let inhalt = `Transkript:\n<transkript>\n${transkript}\n</transkript>`;
  if (hinweis) inhalt += `\n\nWunsch für diese Fassung: ${hinweis}`;

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
    const text = antwort.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) throw new Error("Leere Antwort.");
    return { text, quelle: "claude" };
  } catch (e) {
    const grund = e instanceof Anthropic.AuthenticationError ? "API-Schlüssel ungültig" : e.message;
    return { text: einfacherVorschlag(transkript, o.hashtags), quelle: "transkript", fehler: grund };
  }
}

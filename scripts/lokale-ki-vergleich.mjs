#!/usr/bin/env node
// Unabhängiger, rein lokaler Prüfstand. Keine Veröffentlichung oder Weiterleitung an externe KI.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const daten = JSON.parse(await fs.readFile(path.join(root, "lokale-ki-faelle.json"), "utf8"));
const adresse = process.env.LOKALE_KI_URL || "http://127.0.0.1:8088";
const modell = process.env.LOKALE_KI_MODELL || "lokales-modell";
const datei = process.argv[2] || path.join(process.cwd(), "lokale-ki-ergebnisse.json");
const prompts = {
  fakten(fall) {
    return "Extrahiere aus dem folgenden Text ausschließlich überprüfbare Aussagen. Gib jede Aussage als eine kurze nummerierte Zeile aus. Trenne ausdrücklich Antrag/Forderung, Entscheidung, Umsetzung und Ausblick. Erfinde nichts, leite keinen Erfolg aus einem Antrag ab. Keine Einleitung.\n\n" + fall.quelle;
  },
  redaktion(fall) {
    return "Du überarbeitest einen deutschen Informationstext. Formuliere klar und natürlich, maximal 350 Zeichen. Nutze ausschließlich die Fakten im folgenden Text. Verändere weder Zuständigkeit noch Status von Forderungen oder Beschlüssen. Keine zusätzlichen Aussagen, keine Floskeln, keine Hashtags. Nur den fertigen Text ausgeben.\n\n" + fall.quelle;
  },
};
async function antwort(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600000);
  const anfang = performance.now();
  try {
    const response = await fetch(new URL("/v1/chat/completions", adresse), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modell, temperature: 0.7, top_p: 0.8, top_k: 20, max_tokens: 220, stream: false,
        chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Lokaler Server: HTTP " + response.status + " – " + (await response.text()).slice(0, 200));
    const data = await response.json();
    const inhalt = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!inhalt) throw new Error("Leere Antwort trotz " + (data.usage?.completion_tokens ?? "?") + " Tokens; finish_reason=" + (data.choices?.[0]?.finish_reason ?? "?") + ". Denkmodus / Chat-Template prüfen.");
    return { text: inhalt, sekunden: +((performance.now() - anfang) / 1000).toFixed(1), tokens: data.usage?.completion_tokens ?? null };
  } finally { clearTimeout(timeout); }
}
const ergebnisse = [];
for (const fall of daten) {
  for (const aufgabe of ["fakten", "redaktion"]) {
    console.log("Prüfe", fall.id, aufgabe, "…");
    try {
      const result = await antwort(prompts[aufgabe](fall));
      const kontrolle = {
        // Nur textuelle Hinweise. Keine automatische Faktenprüfung!
        zuLang: aufgabe === "redaktion" && result.text.length > 350,
        vermuteteStatuswoerter: [...new Set(result.text.match(/beantragt|abgelehnt|beschlossen|umgesetzt|geplant|gefordert/gi) ?? [])],
      };
      ergebnisse.push({ fall: fall.id, aufgabe, quelle: fall.quelle, erwarteteFakten: fall.fakten,
        ...result, zeichen: result.text.length, kontrolle, manuellePruefung: {
          alleFaktenEnthalten: null, zusaetzlicheBehauptungen: null, sprachlichBrauchbar: null, notiz: "" },
      });
      console.log("  " + result.sekunden + " s, " + result.text.length + " Zeichen");
    } catch (e) {
      ergebnisse.push({ fall: fall.id, aufgabe, fehler: e.message });
      console.error("  FEHLER:", e.message);
    }
  }
}
await fs.writeFile(datei, JSON.stringify({ erstellt: new Date().toISOString(), modell, adresse, ergebnisse }, null, 2) + "\n", "utf8");
console.log("\nGespeichert:", datei);
console.log("Die Prüf-Felder sind absichtlich leer: Wahrheit und sprachliche Qualität müssen Menschen prüfen.");

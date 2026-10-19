// Kontrolle nach dem Posten: Hat Postiz unsere Posts zum Termin wirklich veröffentlicht?
// Postiz veröffentlicht über Temporal; hängt dort etwas (z. B. der Orchestrator nach einem Neustart),
// bleiben Posts still auf „QUEUE“ stehen. Der Bot fragt deshalb nach (GET /posts) und meldet sich.
// Übernommen aus vwt1812-glitch/eu-piraten-abstimmungen (lib/kontrolle.mjs).
// Zustand in daten/kontrolle.json: { erledigt: { postId: true }, gemeldet: { postId: "QUEUE" | "ERROR" } }

export const KARENZ_MINUTEN = 15;
const MAX_TAGE = 3;

/** Alle Postiz-Post-IDs aus den Aufträgen: Map postId → { auftrag, chatId, zeitpunkt } */
export function erwartetePosts(auftraege) {
  const ids = new Map();
  for (const a of auftraege) {
    if (!["geplant", "gepostet"].includes(a.status) || !a.postiz) continue;
    for (const p of [...(a.postiz.post ?? []), ...(a.postiz.story ?? [])]) {
      if (p?.postId) ids.set(p.postId, { auftrag: a.id, chatId: a.chatId, zeitpunkt: a.plan?.zeit ?? a.erstellt });
    }
  }
  return ids;
}

/** Posts, deren Termin plus Karenz vorbei ist (höchstens MAX_TAGE alt) und die noch nicht als erledigt gelten. */
export function faelligeKontrollen(erwartet, kontrolle, jetzt = new Date(), karenz = KARENZ_MINUTEN) {
  const bis = jetzt.getTime() - karenz * 60e3;
  const ab = jetzt.getTime() - MAX_TAGE * 864e5;
  return [...erwartet].filter(([id, e]) => {
    const t = Date.parse(e.zeitpunkt);
    return !kontrolle.erledigt?.[id] && t <= bis && t >= ab;
  });
}

/** Zeitraum für GET /posts: vom ältesten fälligen Termin bis morgen (falls jemand in Postiz verschoben hat). */
export function abfragezeitraum(faellig, jetzt = new Date()) {
  const aeltester = Math.min(...faellig.map(([, e]) => Date.parse(e.zeitpunkt)));
  return { von: new Date(aeltester - 864e5), bis: new Date(jetzt.getTime() + 864e5) };
}

const uhrzeit = (d) => new Date(d).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const kurz = (html) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);

/**
 * posts: Antwort von GET /posts. Ändert `kontrolle` und gibt die Meldungen je Chat zurück.
 * @returns {Map<number, string[]>} chatId → Texte
 */
export function auswerten(posts, faellig, kontrolle, jetzt = new Date(), karenz = KARENZ_MINUTEN) {
  kontrolle.erledigt ??= {};
  kontrolle.gemeldet ??= {};
  const nachId = new Map(posts.map((p) => [p.id, p]));
  const jeChat = new Map();
  const eintrag = (chatId) => {
    if (!jeChat.has(chatId)) jeChat.set(chatId, { probleme: [], nachgeholt: [] });
    return jeChat.get(chatId);
  };

  for (const [id, e] of faellig) {
    const p = nachId.get(id);
    const name = p ? `${p.integration?.name ?? ""} (${p.integration?.providerIdentifier ?? "?"})` : "";
    if (!p) {
      // In Postiz gelöscht oder weit verschoben – nichts mehr zu kontrollieren.
      kontrolle.erledigt[id] = true;
      delete kontrolle.gemeldet[id];
    } else if (p.state === "PUBLISHED") {
      kontrolle.erledigt[id] = true;
      if (kontrolle.gemeldet[id]) eintrag(e.chatId).nachgeholt.push(`• ${name}: ${kurz(p.content)}`);
      delete kontrolle.gemeldet[id];
    } else if (p.state === "ERROR" && kontrolle.gemeldet[id] !== "ERROR") {
      kontrolle.gemeldet[id] = "ERROR";
      eintrag(e.chatId).probleme.push({ fehler: true, text: `• ${name}, geplant ${uhrzeit(p.publishDate)}: Fehler – ${p.error ?? "ohne Meldung"}\n  ${kurz(p.content)}` });
    } else if (p.state === "QUEUE" && !kontrolle.gemeldet[id] && jetzt - new Date(p.publishDate) > karenz * 60e3) {
      kontrolle.gemeldet[id] = "QUEUE";
      const minuten = Math.round((jetzt - new Date(p.publishDate)) / 60e3);
      eintrag(e.chatId).probleme.push({ fehler: false, text: `• ${name}, geplant ${uhrzeit(p.publishDate)}: wartet seit ${minuten} Minuten\n  ${kurz(p.content)}` });
    }
  }

  const ergebnis = new Map();
  for (const [chatId, { probleme, nachgeholt }] of jeChat) {
    const texte = [];
    if (probleme.length) {
      const nurWartend = probleme.every((p) => !p.fehler);
      texte.push([
        `⚠️ Postiz hat ${probleme.length === 1 ? "einen Post" : `${probleme.length} Posts`} nicht veröffentlicht:`,
        ...probleme.map((p) => p.text),
        "",
        nurWartend
          ? "Hängen sie alle, läuft vermutlich der Orchestrator von Postiz nicht (z. B. nach einem Neustart).\nPrüfen: docker exec postiz pm2 list – im Zweifel: docker restart postiz"
          : "Den Fehler zeigt Postiz auch am Post im Kalender; oft muss der Kanal neu verbunden werden.",
      ].join("\n"));
    }
    if (nachgeholt.length) texte.push(["✅ Inzwischen veröffentlicht:", ...nachgeholt].join("\n"));
    if (texte.length) ergebnis.set(chatId, texte);
  }
  return ergebnis;
}

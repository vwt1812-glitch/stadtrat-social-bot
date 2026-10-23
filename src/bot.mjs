// Telegram-Bot: Video, Fotos oder Text rein → Vorschau mit Logo, Untertiteln und
// Caption zurück → per Knopfdruck sofort oder geplant über Postiz veröffentlichen.

import fs from "node:fs/promises";
import path from "node:path";
import { ladeConfig } from "./config.mjs";
import { Telegram, html } from "./telegram.mjs";
import {
  Postiz, passendeKanaele, BRAUCHT_MEDIEN, NUR_VIDEO, kundenAus, findeKunde, kanaeleVonKunde,
  repostKandidaten, parseCollabs, REPOST_VERZOEGERUNG, zeichenLimit, zeichenZahl, AnfragenZaehler, STORY, passtZu,
} from "./postiz.mjs";
import { Mastodon, DIREKT, mastodonMedien } from "./mastodon.mjs";
import { erwartetePosts, faelligeKontrollen, abfragezeitraum, auswerten } from "./kontrolle.mjs";
import { Auftraege } from "./auftraege.mjs";
import {
  ausfuehren, untersuche, tonFuerWhisper, rendern, vorschau, fotoRendern, fotoFuerKi, storyFoto, istStoryFormat, STORY_MASSE, storyLayout,
} from "./video.mjs";
import { transkribiere } from "./whisper.mjs";
import { gesichtSuchen, lageWaehlen } from "./gesicht.mjs";
import { captionVorschlag, einfacherVorschlag, kuerzen } from "./caption.mjs";
import { parseSrt, formatSrt, zuAss, volltext, parseBauchbinde, alsListe, wendeBearbeitungAn } from "./untertitel.mjs";
import { parseZeit, zeitText, vorschlaege } from "./zeit.mjs";
import { storyFotoText, storyTextZeilen } from "./story-text.mjs";

const config = ladeConfig();
const tg = new Telegram(config.telegram);
const auftraege = new Auftraege(config.datenDir);
const postiz = new Postiz({ ...config.postiz, zaehler: new AnfragenZaehler(path.join(config.datenDir, "postiz-anfragen.json"), config.postiz.maxAnfragen) });
const mastodon = config.mastodon ? new Mastodon(config.mastodon) : null;
const MB = 1024 * 1024;

// ---------- Hilfsfunktionen ----------

let kanalCache = { zeit: 0, liste: [] };
let mastodonKonto = null;
async function alleKanaele() {
  if (Date.now() - kanalCache.zeit > 10 * 60e3) {
    let liste = await postiz.kanaele();
    if (mastodon) {
      // Mastodon läuft direkt – Postiz-Mastodon-Kanäle ausblenden, sonst käme alles doppelt und öffentlich
      mastodonKonto ??= await mastodon.konto().catch(() => null);
      liste = liste.filter((k) => k.identifier !== "mastodon");
      liste.push({
        id: DIREKT,
        name: mastodonKonto ? `Mastodon @${mastodonKonto}` : "Mastodon (direkt)",
        identifier: DIREKT,
        customer: findeKunde(liste, config.postiz.kunde) ?? undefined,
        maxZeichen: 500 - mastodon.cwLaenge,
      });
    }
    kanalCache = { zeit: Date.now(), liste };
  }
  return kanalCache.liste;
}

const erlaubt = (...ids) => ids.some((id) => config.telegram.erlaubt.includes(id));

/** Bedarf an Postiz-Anfragen prüfen; Fehlertext, wenn das Stundenlimit nicht reicht. */
function limitFehler(auftrag, kanaele) {
  const postizKanaele = kanaele.filter((k) => k.id !== DIREKT);
  if (!postizKanaele.length) return null;
  const medien = (auftrag.medien ?? [datei(auftrag, "fertig.mp4")]).length;
  const bedarf = Postiz.bedarf({
    medien: auftrag.nurStory ? 1 : medien,
    hochgeladen: Boolean(auftrag.hochgeladen), story: auftrag.story, nurStory: Boolean(auftrag.nurStory), kanaele: postizKanaele,
    storyUpload: Boolean(auftrag.storyDatei && !auftrag.storyHochgeladen),
    storyBereit: Boolean(auftrag.storyDatei ? auftrag.storyHochgeladen : auftrag.hochgeladen),
    hochkant: hochkantAn(auftrag), hochkantNetze: config.hochkant.netze,
  });
  const frei = postiz.zaehler.wiederFrei(bedarf);
  if (!frei) return null;
  return frei === Infinity
    ? `Der Beitrag braucht ${bedarf} Postiz-Anfragen, erlaubt sind nur ${config.postiz.maxAnfragen} pro Stunde (POSTIZ_MAX_ANFRAGEN bzw. API_LIMIT in Postiz erhöhen).`
    : `Postiz-Limit für diese Stunde erreicht – ab ${frei.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr geht es wieder. Planen kannst du trotzdem: einfach dann nochmal „Ja“.`;
}

/** Vorauswahl: Kanäle des Kunden, ggf. eingeschränkt auf POSTIZ_KANAELE, passend zur Beitragsart. */
function standardKanaele(alle, auftrag) {
  const vomKunden = kanaeleVonKunde(alle, auftrag.kunde);
  const vorgabe = vomKunden.filter((k) => config.postiz.kanaele.some((e) => passtZu(k, e)));
  const passend = passendeKanaele(vorgabe.length ? vorgabe : vomKunden, art(auftrag));
  return (auftrag.nurStory ? passend.filter((k) => STORY[k.identifier]) : passend).map((k) => k.id);
}

async function gewaehlteKanaele(auftrag) {
  const alle = await alleKanaele();
  if (auftrag.kunde === undefined) auftraege.aendern(auftrag.id, { kunde: findeKunde(alle, config.postiz.kunde)?.id ?? null });
  if (!auftrag.kanaele) auftraege.aendern(auftrag.id, { kanaele: standardKanaele(alle, auftrag) });
  return alle.filter((k) => auftrag.kanaele.includes(k.id) && (!auftrag.nurStory || STORY[k.identifier]));
}

// ---------- Texte pro Kanal ----------

/** Stil-Hinweise für die KI, wenn sie eine Fassung für ein Netzwerk schreibt. */
const NETZ_STIL = {
  x: "Kurz und pointiert, höchstens 2 Hashtags.",
  bluesky: "Kurz und pointiert, höchstens 2 Hashtags.",
  threads: "Locker und kurz, wenige Hashtags.",
  mastodon: "Sachlich und kurz, Hashtags in CamelCase (z. B. #StadtratNürnberg).",
  linkedin: "Sachlich-professionell, gern etwas ausführlicher, 3 Hashtags.",
  "linkedin-page": "Sachlich-professionell, gern etwas ausführlicher, 3 Hashtags.",
  instagram: "Persönlich, kurze Absätze, Hashtags am Ende.",
  "instagram-standalone": "Persönlich, kurze Absätze, Hashtags am Ende.",
  facebook: "Persönlich und erklärend, höchstens 2 Hashtags.",
  tiktok: "Sehr kurz und locker, 3–5 Hashtags.",
  "tiktok-business": "Sehr kurz und locker, 3–5 Hashtags.",
  [DIREKT]: "Sachlich und kurz, Hashtags in CamelCase (z. B. #StadtratNürnberg).",
};

const captionFuer = (auftrag, kanal) => auftrag.captions?.[kanal.id] ?? auftrag.caption;

/** Länge des Textes je gewähltem Kanal im Vergleich zum Limit. */
function laengen(auftrag, kanaele) {
  const eigene = postiz.eigeneEinstellungen();
  return kanaele.map((kanal) => {
    const text = captionFuer(auftrag, kanal);
    const zahl = zeichenZahl(text, kanal.identifier);
    const max = zeichenLimit(kanal, eigene);
    return { kanal, text, zahl, max, eigen: auftrag.captions?.[kanal.id] !== undefined, zuLang: max !== null && zahl > max };
  });
}

const zahlText = (l) => `${l.zahl}/${l.max ?? "∞"}`;

async function captionsInhalt(auftrag) {
  const alle = await alleKanaele();
  const liste = laengen(auftrag, await gewaehlteKanaele(auftrag));
  const zeilen = liste.map((l) => [
    knopf(`${l.zuLang ? "⚠️" : l.eigen ? "✂️" : "✅"} ${l.kanal.name} · ${zahlText(l)}${l.eigen ? " · eigene" : ""}`, auftrag, `kc:${alle.indexOf(l.kanal)}`),
  ]);
  if (config.caption.anbieter && liste.length) zeilen.push([knopf("🤖 Alle per KI anpassen", auftrag, "kia")]);
  if (liste.some((l) => l.zuLang)) zeilen.push([knopf("✂️ Zu lange automatisch kürzen", auftrag, "kka")]);
  zeilen.push([knopf("✔️ Fertig", auftrag, "zurueck")]);
  return {
    text: "<b>Texte pro Kanal</b>\nOhne eigene Fassung gilt der Haupttext. ⚠️ = zu lang für das Netzwerk, ✂️ = eigene Fassung.\nAntippen zum Ansehen und Ändern.",
    reply_markup: { inline_keyboard: zeilen },
  };
}

async function kanalTextInhalt(auftrag, kanal) {
  const [l] = laengen(auftrag, [kanal]);
  const i = (await alleKanaele()).indexOf(kanal);
  const zeilen = [[knopf("✏️ Eigenen Text schreiben", auftrag, `kt:${i}:schreiben`)]];
  if (config.caption.anbieter) zeilen.push([knopf("🤖 KI-Fassung für dieses Netzwerk", auftrag, `kt:${i}:ki`)]);
  if (l.zuLang) zeilen.push([knopf("✂️ Automatisch kürzen", auftrag, `kt:${i}:kurz`)]);
  if (l.eigen) zeilen.push([knopf("↩️ Haupttext verwenden", auftrag, `kt:${i}:haupt`)]);
  zeilen.push([knopf("↩️ Zurück", auftrag, "pk")]);
  return {
    text: `<b>${html(kanal.name)}</b> (${kanal.identifier}) · ${zahlText(l)} Zeichen${l.zuLang ? " ⚠️ zu lang" : ""}\n${l.eigen ? "Eigene Fassung" : "Haupttext"}:\n<blockquote expandable>${html(l.text)}</blockquote>`,
    reply_markup: { inline_keyboard: zeilen },
  };
}

/** KI-Fassung für ein Netzwerk; zur Sicherheit danach aufs Limit gekürzt. */
async function kiFassung(auftrag, kanal, max) {
  // Riesige Limits (Facebook) sind keine Vorgabe für die Länge
  const grenze = max && max <= 5000 ? `, höchstens ${max} Zeichen inklusive Hashtags` : "";
  const hinweis = `Eigene Fassung für ${kanal.identifier}${grenze}. ${NETZ_STIL[kanal.identifier] ?? ""}`;
  const material = { art: art(auftrag), transkript: auftrag.transkript, notizen: auftrag.notizen, bilder: auftrag.fuerKi, bisher: auftrag.caption };
  const v = await captionVorschlag(material, config.caption, hinweis);
  if (v.fehler) throw new Error(`KI nicht erreichbar: ${v.fehler}`);
  return max ? kuerzen(v.text, max, (t) => zeichenZahl(t, kanal.identifier)) : v.text;
}

/** Haupttext geändert → Kanal-Fassungen passen nicht mehr. */
async function captionsZuruecksetzen(auftrag) {
  if (!Object.keys(auftrag.captions ?? {}).length) return auftrag;
  await tg.senden(auftrag.chatId, "ℹ️ Die eigenen Fassungen pro Kanal wurden zurückgesetzt, weil sich der Haupttext geändert hat.");
  return auftraege.aendern(auftrag.id, { captions: {} });
}

// ---------- Bauchbinde ----------

const standardBauchbinde = () => (config.bauchbinde.name ? { name: config.bauchbinde.name, funktion: config.bauchbinde.funktion } : null);
const bauchbindeText = (b) => html([b.name, b.funktion].filter(Boolean).join(" – "));

function bauchbindeMenue(auftrag) {
  const zeilen = [];
  const standard = standardBauchbinde();
  if (standard) zeilen.push([knopf(`👤 ${[standard.name, standard.funktion].filter(Boolean).join(" – ")}`, auftrag, "bb:std")]);
  zeilen.push([knopf("✏️ Anderer Name / Funktion", auftrag, "bb:text")]);
  if (auftrag.bauchbinde) zeilen.push([knopf("🚫 Ohne Bauchbinde", auftrag, "bb:aus")]);
  zeilen.push([knopf("↩️ Zurück", auftrag, "zurueck")]);
  const jetzt = auftrag.bauchbinde ? `Jetzt: <b>${bauchbindeText(auftrag.bauchbinde)}</b>` : "Jetzt: keine";
  return {
    text: `<b>Bauchbinde</b> – Name und Funktion, ${config.layout.bauchbindeStart} s nach Beginn für ${config.layout.bauchbindeDauer} s eingeblendet.\n${jetzt}`,
    reply_markup: { inline_keyboard: zeilen },
  };
}

// ---------- Lage der Untertitel ----------

const LAGE_TEXT = { oben: "⬆️ Oben", mitte: "↕️ Mitte", unten: "⬇️ Unten (Standard)" };

function lageMenue(auftrag) {
  const jetzt = auftrag.untertitelLage ?? "unten";
  const zeilen = Object.entries(LAGE_TEXT).map(([lage, text]) => [knopf(`${lage === jetzt ? "🔘" : "⚪"} ${text}`, auftrag, `pos:${lage}`)]);
  zeilen.push([knopf("↩️ Zurück", auftrag, "zurueck")]);
  return {
    text: "<b>Untertitel-Position</b> – „Unten“ liegt über Name und Caption von TikTok und Reels. Verdecken die Untertitel etwas Wichtiges (Gesicht, Schild), weiter nach oben schieben.",
    reply_markup: { inline_keyboard: zeilen },
  };
}

/** Layout für diesen Auftrag: Einstellungen aus der .env plus gewählte Lage der Untertitel. */
const layoutFuer = (auftrag) => ({ ...config.layout, lage: auftrag.untertitelLage ?? null });

const verzoegerungText = (ms) => REPOST_VERZOEGERUNG.find(([, wert]) => wert === ms)?.[0] ?? "sofort";

/** Zusatzzeilen für Kunde, Collab und Repost. */
function details(auftrag, alle) {
  const zeilen = [];
  const kunde = kundenAus(alle).find((k) => k.id === auftrag.kunde);
  if (kundenAus(alle).length) zeilen.push(`👤 ${kunde ? html(kunde.name) : "<i>alle Kunden</i>"}`);
  if (auftrag.collabs?.length) zeilen.push(`🤝 Collab: ${auftrag.collabs.map((c) => `@${html(c)}`).join(", ")}`);
  const reposter = alle.filter((k) => auftrag.repost?.kanaele.includes(k.id));
  if (reposter.length) zeilen.push(`🔁 Repost ${verzoegerungText(auftrag.repost.verzoegerung)}: ${reposter.map((k) => html(k.name)).join(", ")}`);
  if (auftrag.nurStory) zeilen.push("📱 Ausschließlich als Story – kein Feed-Beitrag");
  else if (auftrag.story && art(auftrag) !== "text") zeilen.push(`📱 Zusätzlich als Story auf Instagram/Facebook${auftrag.storyDatei ? " (eigene 9:16-Fassung)" : ""}`);
  if (auftrag.storyText && art(auftrag) === "foto" && auftrag.story) zeilen.push(`✏️ Bildtext: ${html(auftrag.storyText)}`);
  if (hochkantAn(auftrag)) zeilen.push("📲 Instagram/TikTok bekommen eine eigene 9:16-Fassung, die anderen das Querformat");
  if (auftrag.bauchbinde && art(auftrag) === "video") zeilen.push(`🪪 Bauchbinde: ${bauchbindeText(auftrag.bauchbinde)}`);
  if (auftrag.untertitelLage && art(auftrag) === "video") {
    zeilen.push(`📍 Untertitel: ${LAGE_TEXT[auftrag.untertitelLage]}${auftrag.lageAutomatisch ? " – automatisch, unten wäre dein Gesicht verdeckt" : ""}`);
  }
  if (art(auftrag) === "video") for (const h of auftrag.gesichtHinweise ?? []) zeilen.push(`💡 ${html(h)}`);
  return zeilen;
}

/** Ältere Aufträge stammen aus der Zeit, als es nur Videos gab. */
const art = (auftrag) => auftrag.art ?? "video";

// Videos und Fotos nacheinander verarbeiten – der Pi soll nicht zwei Renderings parallel stemmen
let warteschlange = Promise.resolve();
const einreihen = (fn) => (warteschlange = warteschlange.then(fn, fn));

const knopf = (text, auftrag, aktion) => ({ text, callback_data: `a:${auftrag.id}:${aktion}` });
const datei = (auftrag, name) => path.join(auftrag.ordner, name);

const HILFE = `<b>So funktioniert's</b>
Schick mir
• ein <b>Video</b> – am besten <b>als Datei</b> (📎 → Datei), dann bleibt die volle Qualität erhalten. Ich baue Logo und Untertitel ein.
• ein oder mehrere <b>Fotos</b> (als Album = Karussell). Ich setze das Logo drauf. Text in der Bildunterschrift wird zur Caption. Über <b>📱 Nur Story</b> und <b>✏️ Text ins Bild</b> kannst du eine reine Fotostory machen.
• einfach <b>Text</b> – daraus wird ein Textbeitrag (nicht für Instagram, TikTok, YouTube).

Danach kannst du Caption, Kunde, Kanäle, Collab-Partner, Reposts und Zeit anpassen und mit <b>Ja</b> posten.

/kanaele – verbundene Postiz-Kanäle nach Kunden
/status – prüft Postiz, Whisper, ffmpeg und KI
/id – zeigt deine Telegram-ID (und die der Gruppe)
/hilfe – diese Hilfe`;

// ---------- Menüs ----------

async function menueInhalt(auftrag) {
  let kanalText;
  let kanaele = [];
  let alle = [];
  try {
    kanaele = await gewaehlteKanaele(auftrag);
    alle = await alleKanaele();
    kanalText = kanaele.length ? kanaele.map((k) => html(k.name)).join(", ") : "<i>keine gewählt</i>";
  } catch (e) {
    kanalText = `<i>Postiz nicht erreichbar (${html(e.message.slice(0, 120))})</i>`;
  }
  const quelle = {
    transkript: "\n<i>(einfacher Vorschlag aus dem Transkript)</i>",
    hashtags: "\n<i>(noch ohne Text – über „Caption ändern“ ergänzen)</i>",
  }[auftrag.captionQuelle] ?? "";
  const titel = auftrag.nurStory ? "Story-Vorschau" : art(auftrag) === "text" ? "Textbeitrag" : "Caption-Vorschlag";
  const hinweise = [];
  try {
    const liste = auftrag.nurStory ? [] : laengen(auftrag, kanaele);
    const eigen = liste.filter((l) => l.eigen && !l.zuLang);
    if (eigen.length) hinweise.push(`✂️ Eigene Fassung: ${eigen.map((l) => `${html(l.kanal.name)} (${zahlText(l)})`).join(", ")}`);
    const zuLang = liste.filter((l) => l.zuLang);
    if (zuLang.length) hinweise.push(`⚠️ Zu lang für ${zuLang.map((l) => `${html(l.kanal.name)} (${zahlText(l)})`).join(", ")} – unter „✂️ Pro Kanal“ anpassen`);
  } catch (e) {
    hinweise.push(`⚠️ ${html(e.message)}`);
  }
  const text = [
    auftrag.nurStory ? `<b>${titel}</b>\nDie Story erhält keine Feed-Caption. Text kannst du direkt aufs Foto setzen.`
      : `<b>${titel}</b>${quelle}\n<blockquote expandable>${html(auftrag.caption)}</blockquote>`,
    ...details(auftrag, alle), `📺 ${kanalText}`, ...hinweise,
  ].join("\n");
  const extra = {
    video: [knopf("📝 Untertitel", auftrag, "untertitel"), knopf("📍 Position", auftrag, "pos"), knopf(auftrag.bauchbinde ? "🪪 Bauchbinde ✓" : "🪪 Bauchbinde", auftrag, "bb")],
    foto: [knopf(auftrag.mitLogo ? "🏷️ Logo entfernen" : "🏷️ Logo drauf", auftrag, "logo")],
    text: [],
  }[art(auftrag)];
  const zeilen = [
    [knopf("✅ Jetzt posten", auftrag, "jetzt"), knopf("🕐 Planen", auftrag, "planen")],
    ...(!auftrag.nurStory ? [[knopf(art(auftrag) === "text" ? "✏️ Text ändern" : "✏️ Caption ändern", auftrag, "caption"), ...(config.caption.anbieter ? [knopf("🔄 Neu formulieren", auftrag, "neu")] : [])]] : []),
    ...(extra.length ? [extra] : []),
    [knopf("📺 Kanäle", auftrag, "kanaele"), ...(!auftrag.nurStory && kanaele.length ? [knopf("✂️ Pro Kanal", auftrag, "pk")] : [])],
  ];
  const optionen = [];
  if (kundenAus(alle).length) optionen.push(knopf("👤 Kunde", auftrag, "kunde"));
  if (!auftrag.nurStory && art(auftrag) !== "text" && kanaele.some((k) => k.identifier.startsWith("instagram"))) optionen.push(knopf("🤝 Collab", auftrag, "collab"));
  if (!auftrag.nurStory && repostKandidaten(alle, kanaele).length) optionen.push(knopf("🔁 Repost", auftrag, "repost"));
  if (art(auftrag) !== "text" && !auftrag.nurStory && kanaele.some((k) => STORY[k.identifier])) optionen.push(knopf(auftrag.story ? "📱 Story ✓" : "📱 Story", auftrag, "story"));
  if (art(auftrag) !== "text" && alle.some((k) => STORY[k.identifier] && (auftrag.kunde == null || k.customer?.id === auftrag.kunde))) {
    optionen.push(knopf(auftrag.nurStory ? "📱 Nur Story ✓" : "📱 Nur Story", auftrag, "nurst"));
  }
  if (art(auftrag) === "foto" && auftrag.story) optionen.push(knopf(auftrag.storyText ? "✏️ Bildtext ✓" : "✏️ Text ins Bild", auftrag, "storytext"));
  if (!auftrag.nurStory && hochkantMoeglich(auftrag) && kanaele.some((k) => config.hochkant.netze.includes(k.identifier))) {
    optionen.push(knopf(auftrag.hochkant ? "📲 9:16 ✓" : "📲 9:16 für Insta", auftrag, "hochkant"));
  }
  if (optionen.length) zeilen.push(optionen);
  zeilen.push([knopf("🗑️ Verwerfen", auftrag, "verwerfen")]);
  return { text, reply_markup: { inline_keyboard: zeilen } };
}

/** Menü in der bestehenden Nachricht anzeigen. */
async function zeigeMenue(auftrag, inhalt) {
  inhalt ??= await menueInhalt(auftrag);
  await tg.bearbeiten(auftrag.chatId, auftrag.menueNachricht, inhalt.text, { reply_markup: inhalt.reply_markup });
}

/** Menü als neue Nachricht unten im Chat (nach einer Texteingabe). */
async function neuesMenue(auftrag, inhalt) {
  inhalt ??= await menueInhalt(auftrag);
  if (auftrag.menueNachricht) {
    await tg.aufruf("editMessageReplyMarkup", { chat_id: auftrag.chatId, message_id: auftrag.menueNachricht }).catch(() => {});
  }
  const msg = await tg.senden(auftrag.chatId, inhalt.text, { reply_markup: inhalt.reply_markup });
  auftraege.aendern(auftrag.id, { menueNachricht: msg.message_id });
}

async function zeitMenue(auftrag) {
  const zeilen = vorschlaege().map(([text, d]) => [knopf(text, auftrag, `z:${Math.floor(d / 1000)}`)]);
  zeilen.push([knopf("🧭 Nächster freier Slot", auftrag, "slot")]);
  zeilen.push([knopf("⌨️ Andere Zeit eingeben", auftrag, "eigen")]);
  zeilen.push([knopf("↩️ Zurück", auftrag, "zurueck")]);
  await zeigeMenue(auftrag, { text: "<b>Wann soll der Beitrag erscheinen?</b>", reply_markup: { inline_keyboard: zeilen } });
}

async function kanalMenue(auftrag) {
  const alle = await alleKanaele();
  await gewaehlteKanaele(auftrag);
  const sichtbar = new Set(kanaeleVonKunde(alle, auftrag.kunde).filter((k) => !auftrag.nurStory || STORY[k.identifier]).map((k) => k.id));
  // Indizes beziehen sich auf die Gesamtliste, damit die Knöpfe eindeutig bleiben
  const zeilen = alle.flatMap((k, i) => sichtbar.has(k.id)
    ? [[knopf(`${auftrag.kanaele.includes(k.id) ? "✅" : "⬜"} ${k.name} (${k.identifier})`, auftrag, `k:${i}`)]]
    : []);
  const kunde = kundenAus(alle).find((k) => k.id === auftrag.kunde);
  const unten = [knopf("✔️ Fertig", auftrag, "zurueck")];
  if (kundenAus(alle).length) unten.unshift(knopf("👤 Kunde wechseln", auftrag, "kunde"));
  zeilen.push(unten);
  const titel = auftrag.nurStory ? "<b>Story-Kanäle (Instagram/Facebook)</b>" : kunde ? `<b>Kanäle von ${html(kunde.name)}</b>` : "<b>Auf welchen Kanälen posten?</b>";
  await zeigeMenue(auftrag, { text: titel, reply_markup: { inline_keyboard: zeilen } });
}

async function kundeMenue(auftrag) {
  const kunden = kundenAus(await alleKanaele());
  const zeilen = kunden.map((k, i) => [knopf(`${auftrag.kunde === k.id ? "🔘" : "⚪"} ${k.name}`, auftrag, `ku:${i}`)]);
  zeilen.push([knopf(`${auftrag.kunde ? "⚪" : "🔘"} Alle Kanäle`, auftrag, "ku:alle")]);
  zeilen.push([knopf("↩️ Zurück", auftrag, "zurueck")]);
  await zeigeMenue(auftrag, {
    text: "<b>Für welchen Kunden?</b>\nDanach sind dessen Kanäle vorausgewählt.",
    reply_markup: { inline_keyboard: zeilen },
  });
}

async function repostMenue(auftrag) {
  const alle = await alleKanaele();
  const kandidaten = repostKandidaten(alle, await gewaehlteKanaele(auftrag));
  const repost = auftrag.repost ?? { kanaele: [], verzoegerung: 0 };
  const zeilen = kandidaten.map((k) => [
    knopf(`${repost.kanaele.includes(k.id) ? "✅" : "⬜"} ${k.name} (${k.identifier})`, auftrag, `rp:${alle.indexOf(k)}`),
  ]);
  zeilen.push([knopf(`⏱️ Repost ${verzoegerungText(repost.verzoegerung)}`, auftrag, "rv")]);
  zeilen.push([knopf("✔️ Fertig", auftrag, "zurueck")]);
  await zeigeMenue(auftrag, {
    text: "<b>Welche Konten sollen den Beitrag reposten?</b>\nGeht bei Postiz nur auf X und LinkedIn: Die gewählten Konten teilen den Beitrag, nachdem er erschienen ist. Ein Konto repostet sich nicht selbst.",
    reply_markup: { inline_keyboard: zeilen },
  });
}

async function bestaetigung(auftrag, typ, zeit) {
  const kanaele = await gewaehlteKanaele(auftrag);
  if (!kanaele.length) return { fehler: "Bitte zuerst mindestens einen Kanal wählen." };
  if (auftrag.nurStory && kanaele.some((k) => !STORY[k.identifier])) return { fehler: "Nur Story ist auf Instagram und Facebook möglich." };
  if (auftrag.nurStory && art(auftrag) === "text") return { fehler: "Bitte zuerst ein Foto oder Video schicken." };
  if (auftrag.storyText && auftrag.story && !auftrag.storyDatei) return { fehler: "Die Story mit Bildtext wurde noch nicht erstellt. Bitte die Vorschau erneut erzeugen." };
  const unpassend = kanaele.filter((k) =>
    (art(auftrag) === "text" && BRAUCHT_MEDIEN.includes(k.identifier)) || (art(auftrag) === "foto" && NUR_VIDEO.includes(k.identifier)));
  if (unpassend.length) {
    const was = art(auftrag) === "text" ? "ein Bild oder Video" : "ein Video";
    return { fehler: `${unpassend.map((k) => k.name).join(", ")} braucht ${was} – bitte unter „Kanäle“ abwählen.` };
  }
  if (typ === "schedule" && zeit.getTime() < Date.now() + 60e3) return { fehler: "Die Zeit liegt in der Vergangenheit." };
  const liste = auftrag.nurStory ? [] : laengen(auftrag, kanaele);
  const zuLang = liste.filter((l) => l.zuLang);
  if (zuLang.length) return { fehler: `Zu lang für ${zuLang.map((l) => `${l.kanal.name} (${zahlText(l)})`).join(", ")} – bitte unter „✂️ Pro Kanal“ anpassen.` };
  const eigen = liste.filter((l) => l.eigen).map((l) => html(l.kanal.name));
  const limit = limitFehler(auftrag, kanaele);
  if (limit) return { fehler: limit };
  auftraege.aendern(auftrag.id, { plan: { typ, zeit: zeit.toISOString() } });
  const wann = typ === "now" ? "<b>jetzt</b>" : `am <b>${zeitText(zeit)}</b>`;
  return {
    text: [
      `Wirklich ${wann} ${auftrag.nurStory ? "nur die Story" : "den Beitrag"} auf ${kanaele.map((k) => `<b>${html(k.name)}</b>`).join(", ")} posten?`,
      ...details(auftrag, await alleKanaele()),
      ...(eigen.length ? [`✂️ Eigene Fassung für ${eigen.join(", ")} (über „Zurück → Pro Kanal“ ansehen)`] : []),
      ...(!auftrag.nurStory ? [`<blockquote expandable>${html(auftrag.caption)}</blockquote>`] : []),
    ].join("\n"),
    reply_markup: { inline_keyboard: [[knopf("✅ Ja, posten", auftrag, "ja"), knopf("↩️ Zurück", auftrag, "zurueck")]] },
  };
}

// ---------- Verarbeitung ----------

async function neuesVideo(msg, video) {
  const chatId = msg.chat.id;
  if (!tg.lokal && video.file_size > 20 * MB) {
    await tg.senden(chatId, `Das Video ist ${Math.round(video.file_size / MB)} MB groß. Über api.telegram.org kann ich nur bis 20 MB laden – dafür den lokalen Bot-API-Server einrichten (siehe README).`);
    return;
  }
  const auftrag = auftraege.neu(chatId);
  const status = await tg.senden(chatId, "📥 Video erhalten – kommt gleich dran …", { reply_to_message_id: msg.message_id });
  auftraege.aendern(auftrag.id, {
    art: "video", statusNachricht: status.message_id, dateiName: video.file_name ?? "video.mp4",
    bauchbinde: config.bauchbinde.standard ? standardBauchbinde() : null,
    hochkant: config.hochkant.standard,
  });
  einreihen(() => verarbeiten(auftrag.id, video.file_id));
}

async function schritt(auftrag, text) {
  await tg.bearbeiten(auftrag.chatId, auftrag.statusNachricht, text).catch(() => {});
}

async function verarbeiten(id, fileId) {
  let auftrag = auftraege.aendern(id, { status: "arbeitet" });
  try {
    await schritt(auftrag, "⬇️ Lade Video …");
    const original = datei(auftrag, `original${path.extname(auftrag.dateiName) || ".mp4"}`);
    await tg.herunterladen(fileId, original);
    const masse = await untersuche(original);
    auftrag = auftraege.aendern(id, { original, masse });

    // Hochkant: Gesicht suchen und die Untertitel dorthin legen, wo sie es nicht verdecken
    if (masse.hoehe > masse.breite) {
      await schritt(auftrag, "🙂 Suche dein Gesicht …");
      const funde = await gesichtSuchen(original, config.gesicht);
      if (funde) {
        const wahl = lageWaehlen(funde, { masse, layout: config.layout });
        auftrag = auftraege.aendern(id, {
          untertitelLage: wahl.lage === "unten" ? null : wahl.lage, lageAutomatisch: wahl.lage !== "unten", gesichtHinweise: wahl.hinweise,
        });
      }
    }

    let cues = [];
    if (masse.hatTon) {
      await schritt(auftrag, `🎙️ Erkenne Sprache … (${Math.round(masse.dauer)} s Video)`);
      const wav = datei(auftrag, "ton.wav");
      await tonFuerWhisper(original, wav);
      cues = await transkribiere(wav, config.whisper, config.glossar);
      await fs.rm(wav, { force: true });
    }
    await fs.writeFile(datei(auftrag, "untertitel.srt"), formatSrt(cues));

    await schritt(auftrag, "✍️ Schreibe Caption-Vorschlag …");
    const vorschlag = await captionVorschlag({ art: "video", transkript: volltext(cues) }, config.caption);
    if (vorschlag.fehler) await tg.senden(auftrag.chatId, `⚠️ KI nicht erreichbar (${html(vorschlag.fehler)}) – einfacher Vorschlag stattdessen.`);
    auftraege.aendern(id, { caption: vorschlag.text, captionQuelle: vorschlag.quelle });

    await renderUndVorschau(id);
  } catch (e) {
    console.error(e);
    auftraege.aendern(id, { status: "fehler" });
    await schritt(auftraege.get(id), `❌ Fehler bei der Verarbeitung:\n<pre>${html(e.message)}</pre>`);
  }
}

// ---------- Story-Fassung ----------

/**
 * Eigene Story-Fassung nötig? Videos, die nicht 9:16 sind. Fotos immer: Ihr Logo sitzt bei 7 % der
 * Höhe – in der Story läge es unter Fortschrittsbalken und Profilname.
 */
async function storyNoetig(auftrag) {
  if (art(auftrag) === "video") return !istStoryFormat(auftrag.masse);
  return art(auftrag) === "foto";
}

/** Querformat-Video, das sich für Instagram/TikTok in 9:16 umbauen lässt? */
const hochkantMoeglich = (auftrag) => art(auftrag) === "video" && Boolean(auftrag.masse) && !istStoryFormat(auftrag.masse);
const hochkantAn = (auftrag) => !auftrag.nurStory && Boolean(auftrag.hochkant) && hochkantMoeglich(auftrag);

/**
 * Baut die eigene 9:16-Fassung im selben Layout wie den Beitrag – für die Story und, bei Videos,
 * für Instagram/TikTok („📲 9:16“); null, wenn keine nötig ist.
 */
async function storyFassung(auftrag) {
  if (!(auftrag.story || hochkantAn(auftrag)) || !(await storyNoetig(auftrag))) return null;
  if (art(auftrag) === "foto") {
    const ziel = datei(auftrag, "story.jpg");
    await storyFoto({ eingabe: auftrag.medien[0], ausgabe: ziel });
    if (!auftrag.storyText?.trim()) return ziel;
    const mitText = datei(auftrag, "story-text.jpg");
    await storyFotoText({ eingabe: ziel, ausgabe: mitText, text: auftrag.storyText, layout: config.layout });
    return mitText;
  }
  const masse = { ...STORY_MASSE, dauer: auftrag.masse.dauer };
  const layout = storyLayout(layoutFuer(auftrag), auftrag.masse, masse);
  const cues = parseSrt(await fs.readFile(datei(auftrag, "untertitel.srt"), "utf8"));
  let ass = null;
  if (cues.length) {
    ass = datei(auftrag, "story.ass");
    await fs.writeFile(ass, zuAss(cues, { ...masse, ...layout }));
  }
  const ziel = datei(auftrag, "story.mp4");
  await rendern({
    eingabe: auftrag.original, ausgabe: ziel, ass, masse, layout, video: config.video,
    bauchbinde: auftrag.bauchbinde, story: true,
  });
  return ziel;
}

/** Story-Fassung neu bauen (oder verwerfen) und als eigene Vorschau schicken. */
async function storyAktualisieren(auftrag) {
  if (auftrag.statusNachricht && (auftrag.story || hochkantAn(auftrag))) await schritt(auftrag, "📱 Baue die 9:16-Fassung …");
  let storyDatei = null;
  try {
    storyDatei = await storyFassung(auftrag);
  } catch (e) {
    // Bildtext darf nicht stillschweigend verschwinden: dann NICHT ohne Text veröffentlichen.
    console.error(e);
    if (auftrag.storyText?.trim()) throw e;
    await tg.senden(auftrag.chatId, `⚠️ Story-Fassung ging nicht, die Story nimmt dann das normale Medium:\n<pre>${html(e.message)}</pre>`);
  }
  auftrag = auftraege.aendern(auftrag.id, { storyDatei, storyHochgeladen: null });
  if (!storyDatei) return auftrag;
  if (art(auftrag) === "foto") {
    await tg.fotos(auftrag.chatId, [storyDatei], "Story-Vorschau");
    return auftrag;
  }
  let senden = storyDatei;
  if (!tg.lokal && (await fs.stat(storyDatei)).size > 49 * MB) {
    senden = datei(auftrag, "story-vorschau.mp4");
    await vorschau(storyDatei, senden);
  }
  const wofuer = [hochkantAn(auftrag) && "Instagram/TikTok", auftrag.story && "Story"].filter(Boolean).join(" und ");
  await tg.datei(auftrag.chatId, "sendVideo", "video", senden, {
    caption: `9:16-Fassung für ${wofuer}`, supports_streaming: "true",
    width: String(STORY_MASSE.breite), height: String(STORY_MASSE.hoehe),
  });
  return auftrag;
}

async function renderUndVorschau(id) {
  let auftrag = auftraege.aendern(id, { status: "arbeitet" });
  if (!auftrag.statusNachricht) {
    const status = await tg.senden(auftrag.chatId, "🎬 …");
    auftrag = auftraege.aendern(id, { statusNachricht: status.message_id });
  }
  try {
    await schritt(auftrag, "🎬 Baue Logo und Untertitel ein …");
    const cues = parseSrt(await fs.readFile(datei(auftrag, "untertitel.srt"), "utf8"));
    let ass = null;
    if (cues.length) {
      ass = datei(auftrag, "untertitel.ass");
      await fs.writeFile(ass, zuAss(cues, { ...auftrag.masse, ...layoutFuer(auftrag) }));
    }
    const fertig = datei(auftrag, "fertig.mp4");
    await rendern({
      eingabe: auftrag.original, ausgabe: fertig, ass, masse: auftrag.masse, layout: layoutFuer(auftrag), video: config.video,
      bauchbinde: auftrag.bauchbinde,
    });
    auftraege.aendern(id, { medien: [fertig], hochgeladen: null }); // neues Video → neu hochladen

    let senden = fertig;
    if (!tg.lokal && (await fs.stat(fertig)).size > 49 * MB) {
      await schritt(auftrag, "📦 Verkleinere die Vorschau für Telegram …");
      senden = datei(auftrag, "vorschau.mp4");
      await vorschau(fertig, senden);
    }
    await schritt(auftrag, "📤 Schicke Vorschau …");
    await tg.datei(auftrag.chatId, "sendVideo", "video", senden, {
      caption: cues.length ? "Vorschau" : "Vorschau – keine Sprache erkannt, daher ohne Untertitel",
      supports_streaming: "true",
      width: String(auftrag.masse.breite),
      height: String(auftrag.masse.hoehe),
    });
    auftrag = await storyAktualisieren(auftrag);
    await tg.aufruf("deleteMessage", { chat_id: auftrag.chatId, message_id: auftrag.statusNachricht }).catch(() => {});
    auftrag = auftraege.aendern(id, { status: "vorschau", statusNachricht: null, transkript: volltext(cues) });
    await neuesMenue(auftrag);
  } catch (e) {
    console.error(e);
    auftraege.aendern(id, { status: auftrag.menueNachricht ? "vorschau" : "fehler", statusNachricht: null });
    await schritt(auftrag, `❌ Fehler beim Rendern:\n<pre>${html(e.message)}</pre>`);
  }
}

// Alben kommen als einzelne Nachrichten mit gleicher media_group_id – kurz sammeln
const alben = new Map();

function fotoEingang(msg, foto) {
  const chatId = msg.chat.id;
  if (!tg.lokal && foto.file_size > 20 * MB) {
    return tg.senden(chatId, `Das Foto ist ${Math.round(foto.file_size / MB)} MB groß – über api.telegram.org gehen nur 20 MB.`);
  }
  const teil = { msg, foto };
  if (!msg.media_group_id) return neueFotos(chatId, [teil]);
  let album = alben.get(msg.media_group_id);
  if (!album) alben.set(msg.media_group_id, (album = { teile: [] }));
  album.teile.push(teil);
  clearTimeout(album.timer);
  album.timer = setTimeout(() => {
    alben.delete(msg.media_group_id);
    neueFotos(chatId, album.teile).catch((e) => fehlerMelden(chatId, e));
  }, 1500);
}

async function neueFotos(chatId, teile) {
  teile.sort((a, b) => a.msg.message_id - b.msg.message_id);
  if (teile.length > 10) await tg.senden(chatId, "Mehr als 10 Fotos gehen nicht in einen Beitrag – ich nehme die ersten 10.");
  const fotos = teile.slice(0, 10).map(({ foto }) => ({ fileId: foto.file_id, name: foto.file_name ?? "foto.jpg" }));
  const notizen = teile.map(({ msg }) => msg.caption).find(Boolean) ?? "";
  const auftrag = auftraege.neu(chatId);
  const status = await tg.senden(chatId, `🖼️ ${fotos.length === 1 ? "Foto" : `${fotos.length} Fotos`} erhalten – kommt gleich dran …`, { reply_to_message_id: teile[0].msg.message_id });
  auftraege.aendern(auftrag.id, { art: "foto", fotos, notizen, mitLogo: config.layout.logoAufFotos, statusNachricht: status.message_id });
  einreihen(() => verarbeiteFotos(auftrag.id));
}

async function verarbeiteFotos(id) {
  let auftrag = auftraege.aendern(id, { status: "arbeitet" });
  try {
    await schritt(auftrag, "⬇️ Lade Fotos …");
    const originale = [];
    const fuerKi = [];
    for (const [i, foto] of auftrag.fotos.entries()) {
      const original = datei(auftrag, `original-${i + 1}${path.extname(foto.name) || ".jpg"}`);
      await tg.herunterladen(foto.fileId, original);
      originale.push(original);
      if (config.caption.anbieter) {
        fuerKi.push(datei(auftrag, `ki-${i + 1}.jpg`));
        await fotoFuerKi(original, fuerKi.at(-1));
      }
    }
    auftrag = auftraege.aendern(id, { originale, fuerKi });

    // Eigener Text in der Bildunterschrift hat Vorrang vor einem Vorschlag
    let vorschlag = einfacherVorschlag({ notizen: auftrag.notizen }, config.caption.hashtags);
    if (vorschlag.quelle !== "eigene" && config.caption.anbieter) {
      await schritt(auftrag, "✍️ Schreibe Caption-Vorschlag …");
      vorschlag = await captionVorschlag({ art: "foto", bilder: fuerKi }, config.caption);
      if (vorschlag.fehler) await tg.senden(auftrag.chatId, `⚠️ KI nicht erreichbar (${html(vorschlag.fehler)}).`);
    }
    auftraege.aendern(id, { caption: vorschlag.text, captionQuelle: vorschlag.quelle });
    await fotosRendernUndVorschau(id);
  } catch (e) {
    console.error(e);
    auftraege.aendern(id, { status: "fehler" });
    await schritt(auftraege.get(id), `❌ Fehler bei der Verarbeitung:\n<pre>${html(e.message)}</pre>`);
  }
}

async function fotosRendernUndVorschau(id) {
  let auftrag = auftraege.aendern(id, { status: "arbeitet" });
  if (!auftrag.statusNachricht) {
    const status = await tg.senden(auftrag.chatId, "🖼️ …");
    auftrag = auftraege.aendern(id, { statusNachricht: status.message_id });
  }
  try {
    await schritt(auftrag, auftrag.mitLogo ? "🏷️ Setze das Logo drauf …" : "🖼️ Bereite Fotos vor …");
    const medien = [];
    for (const [i, original] of auftrag.originale.entries()) {
      medien.push(datei(auftrag, `fertig-${i + 1}.jpg`));
      await fotoRendern({ eingabe: original, ausgabe: medien.at(-1), layout: config.layout, mitLogo: auftrag.mitLogo });
    }
    auftrag = auftraege.aendern(id, { medien, hochgeladen: null });
    await schritt(auftrag, "📤 Schicke Vorschau …");
    await tg.fotos(auftrag.chatId, medien, "Vorschau");
    auftrag = await storyAktualisieren(auftrag);
    await tg.aufruf("deleteMessage", { chat_id: auftrag.chatId, message_id: auftrag.statusNachricht }).catch(() => {});
    auftrag = auftraege.aendern(id, { status: "vorschau", statusNachricht: null });
    await neuesMenue(auftrag);
  } catch (e) {
    console.error(e);
    auftraege.aendern(id, { status: auftrag.menueNachricht ? "vorschau" : "fehler", statusNachricht: null });
    await schritt(auftrag, `❌ Fehler bei den Fotos:\n<pre>${html(e.message)}</pre>`);
  }
}

async function textBeitrag(chatId, text) {
  let auftrag = auftraege.neu(chatId);
  auftrag = auftraege.aendern(auftrag.id, { art: "text", notizen: text, caption: text.trim(), captionQuelle: "eigene", medien: [], status: "vorschau" });
  await neuesMenue(auftrag);
}

async function veroeffentlichen(auftrag) {
  if (auftrag.status !== "vorschau" || !auftrag.plan) return;
  auftrag = auftraege.aendern(auftrag.id, { status: "postet" });
  const { typ } = auftrag.plan;
  const zeit = typ === "now" ? new Date() : new Date(auftrag.plan.zeit);
  try {
    const kanaele = await gewaehlteKanaele(auftrag);
    const postizKanaele = kanaele.filter((k) => k.id !== DIREKT);
    const direkt = kanaele.find((k) => k.id === DIREKT);
    const medien = auftrag.medien ?? [datei(auftrag, "fertig.mp4")];
    const hinweise = [];

    if (postizKanaele.length && !auftrag.postiz) {
      const limit = limitFehler(auftrag, kanaele);
      if (limit) throw new Error(limit);
      // Bei reinen Storys weder Karussellbilder noch den normalen Feed-Beitrag hochladen:
      // wenn es eine gerenderte 9:16-Fassung gibt, wird nur diese hochgeladen.
      const normaleMedien = auftrag.nurStory ? (auftrag.storyDatei ? [] : medien.slice(0, 1)) : medien;
      if (normaleMedien.length && !auftrag.hochgeladen) {
        await zeigeMenue(auftrag, { text: `⏫ Lade ${normaleMedien.length === 1 ? "Datei" : `${normaleMedien.length} Dateien`} zu Postiz hoch …`, reply_markup: { inline_keyboard: [] } });
        const hochgeladen = [];
        for (const d of normaleMedien) hochgeladen.push(await postiz.hochladen(d));
        auftrag = auftraege.aendern(auftrag.id, { hochgeladen });
      }
      const story = auftrag.story && art(auftrag) !== "text";
      const hochkant = hochkantAn(auftrag) && postizKanaele.some((k) => config.hochkant.netze.includes(k.identifier));
      const fassungGebraucht = (story && postizKanaele.some((k) => STORY[k.identifier])) || hochkant;
      if (fassungGebraucht && auftrag.storyDatei && !auftrag.storyHochgeladen) {
        await zeigeMenue(auftrag, { text: "⏫ Lade die 9:16-Fassung zu Postiz hoch …", reply_markup: { inline_keyboard: [] } });
        auftrag = auftraege.aendern(auftrag.id, { storyHochgeladen: await postiz.hochladen(auftrag.storyDatei) });
      }
      await zeigeMenue(auftrag, { text: "📮 Lege Beitrag an …", reply_markup: { inline_keyboard: [] } });
      const ergebnis = await postiz.beitrag({
        typ, zeit, caption: auftrag.caption, captions: auftrag.captions, medien: auftrag.hochgeladen ?? [], kanaele: postizKanaele,
        collabs: art(auftrag) === "text" || auftrag.nurStory ? [] : auftrag.collabs,
        repost: auftrag.nurStory ? null : auftrag.repost, story, nurStory: Boolean(auftrag.nurStory),
        storyMedium: story && auftrag.storyDatei ? auftrag.storyHochgeladen : null,
        hochkantMedium: hochkant && auftrag.storyDatei ? auftrag.storyHochgeladen : null, hochkantNetze: config.hochkant.netze,
      });
      auftrag = auftraege.aendern(auftrag.id, { postiz: ergebnis });
    }

    // Mastodon direkt: Ein Fehler hier darf den Postiz-Beitrag nicht wiederholen lassen
    if (direkt && !auftrag.mastodon) {
      await zeigeMenue(auftrag, { text: "🐘 Poste auf Mastodon …", reply_markup: { inline_keyboard: [] } });
      const mastoMedien = mastodonMedien(medien);
      if (mastoMedien.length < medien.length) hinweise.push(`Mastodon nimmt höchstens 4 Bilder – dort sind nur die ersten ${mastoMedien.length} dabei.`);
      try {
        const m = await mastodon.posten({ text: captionFuer(auftrag, direkt), medien: mastoMedien, zeit: typ === "now" ? null : zeit, schluessel: `stadtrat-${auftrag.id}` });
        auftrag = auftraege.aendern(auftrag.id, { mastodon: m });
      } catch (e) {
        if (!postizKanaele.length) throw e;
        hinweise.push(`⚠️ Mastodon fehlgeschlagen: ${e.message}`);
      }
    }

    auftraege.aendern(auftrag.id, { status: typ === "now" ? "gepostet" : "geplant" });
    const namen = kanaele.filter((k) => k.id !== DIREKT || auftrag.mastodon).map((k) => html(k.name)).join(", ");
    const text = typ === "now"
      ? `✅ <b>Wird jetzt ${auftrag.nurStory ? "als Story" : "gepostet"}</b> auf ${namen}.`
      : `📅 <b>${auftrag.nurStory ? "Story geplant" : "Geplant"} für ${zeitText(zeit)}</b> auf ${namen}.\nÄndern oder löschen kannst du den Eintrag im Postiz-Kalender${auftrag.mastodon ? " (Mastodon: in den geplanten Beiträgen dort)" : ""}.`;
    const kontrolle = postizKanaele.length ? "\nIch schaue nach dem Termin nach, ob Postiz wirklich veröffentlicht hat." : "";
    await zeigeMenue(auftrag, {
      text: `${text}${kontrolle}${auftrag.nurStory ? "" : `\n<blockquote expandable>${html(auftrag.caption)}</blockquote>`}`,
      reply_markup: { inline_keyboard: [] },
    });
    if (hinweise.length) await tg.senden(auftrag.chatId, html(hinweise.join("\n")));
  } catch (e) {
    console.error(e);
    auftrag = auftraege.aendern(auftrag.id, { status: "vorschau" });
    await tg.senden(auftrag.chatId, `❌ Posten fehlgeschlagen:\n<pre>${html(e.message)}</pre>`);
    await neuesMenue(auftrag);
  }
}

// ---------- Eingaben ----------

async function knopfGedrueckt(cq) {
  const antwort = (text, alert = false) => tg.aufruf("answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: alert }).catch(() => {});
  const [, id, aktion, arg, arg2] = (cq.data ?? "").split(":");
  let auftrag = auftraege.get(id);
  if (!auftrag) return antwort("Dieser Vorschlag ist nicht mehr da.", true);
  if (auftrag.status !== "vorschau") return antwort(`Nicht mehr änderbar (Status: ${auftrag.status}).`, true);
  // Klicks auf ältere Menüs dieses Auftrags umleiten
  if (cq.message?.message_id && cq.message.message_id !== auftrag.menueNachricht) {
    auftrag = auftraege.aendern(id, { menueNachricht: cq.message.message_id });
  }
  auftrag = auftraege.aendern(id, { wartetAuf: null });

  const bestaetigen = async (typ, zeit) => {
    const inhalt = await bestaetigung(auftrag, typ, zeit);
    if (inhalt.fehler) return antwort(inhalt.fehler, true);
    await zeigeMenue(auftrag, inhalt);
    await antwort();
  };

  switch (aktion) {
    case "jetzt":
      return bestaetigen("now", new Date());
    case "planen":
      await zeitMenue(auftrag);
      return antwort();
    case "z":
      return bestaetigen("schedule", new Date(Number(arg) * 1000));
    case "slot": {
      const [erster] = await gewaehlteKanaele(auftrag);
      if (!erster) return antwort("Bitte zuerst einen Kanal wählen.", true);
      return bestaetigen("schedule", await postiz.freierSlot(erster.id));
    }
    case "eigen":
      auftraege.aendern(id, { wartetAuf: "zeit" });
      await tg.senden(auftrag.chatId, "Wann? Zum Beispiel <code>morgen 18 Uhr</code>, <code>Fr 12:30</code>, <code>24.10. 19:00</code> oder <code>in 2 Stunden</code>.");
      return antwort();
    case "caption":
      auftraege.aendern(id, { wartetAuf: "caption" });
      await tg.senden(auftrag.chatId, `Schick mir ${art(auftrag) === "text" ? "den neuen Text" : "die neue Caption"}. Zum Bearbeiten hier der aktuelle Text:`);
      await tg.aufruf("sendMessage", { chat_id: auftrag.chatId, text: auftrag.caption });
      return antwort();
    case "neu":
      auftraege.aendern(id, { wartetAuf: "hinweis" });
      await tg.senden(auftrag.chatId, "Was soll anders werden? Z. B. <code>kürzer</code>, <code>lockerer</code>, <code>mehr zum Haushalt</code> – oder <code>-</code> für einfach neu.");
      return antwort();
    case "untertitel": {
      auftraege.aendern(id, { wartetAuf: "untertitel" });
      const cues = parseSrt(await fs.readFile(datei(auftrag, "untertitel.srt"), "utf8"));
      if (!cues.length) {
        await tg.senden(auftrag.chatId, "Es gibt keine Untertitel. Du kannst eine .srt-Datei schicken, dann baue ich sie ein.");
        return antwort();
      }
      await tg.senden(auftrag.chatId, [
        "<b>Untertitel bearbeiten</b>",
        "Die Liste unten kopieren (lange drücken → Kopieren), Fehler ändern und zurückschicken. Die Nummer bleibt vorne stehen – so wird genau dieser Untertitel geändert, die Zeit bleibt gleich.",
        "• Es reichen auch nur die geänderten Zeilen, z. B. <code>4 Ob das klappt?</code>",
        "• <code>4 -</code> löscht Untertitel 4",
        "• <code>Kuffner => Küffner</code> (ohne Nummer) ersetzt überall",
        "• oder eine .srt-Datei schicken",
        "<code>abbrechen</code> beendet das Bearbeiten.",
      ].join("\n"), { reply_markup: { inline_keyboard: [[knopf("📄 Als SRT-Datei", auftrag, "srt")]] } });
      // Ohne Formatierung, damit beim Kopieren nichts verloren geht
      for (const teil of alsListe(cues)) await tg.aufruf("sendMessage", { chat_id: auftrag.chatId, text: teil });
      return antwort();
    }
    case "srt":
      auftraege.aendern(id, { wartetAuf: "untertitel" });
      await tg.datei(auftrag.chatId, "sendDocument", "document", datei(auftrag, "untertitel.srt"), {
        caption: "Bearbeitet zurückschicken – ich baue sie dann ein.",
      });
      return antwort();
    case "logo":
      auftrag = auftraege.aendern(id, { mitLogo: !auftrag.mitLogo, statusNachricht: null });
      await tg.aufruf("editMessageReplyMarkup", { chat_id: auftrag.chatId, message_id: auftrag.menueNachricht }).catch(() => {});
      einreihen(() => fotosRendernUndVorschau(id));
      return antwort(auftrag.mitLogo ? "Logo kommt drauf …" : "Logo kommt weg …");
    case "kanaele":
      await kanalMenue(auftrag);
      return antwort();
    case "kunde":
      await kundeMenue(auftrag);
      return antwort();
    case "pk":
      await zeigeMenue(auftrag, await captionsInhalt(auftrag));
      return antwort();
    case "kc": {
      const kanal = (await alleKanaele())[Number(arg)];
      if (!kanal) return antwort("Kanal nicht gefunden.", true);
      await zeigeMenue(auftrag, await kanalTextInhalt(auftrag, kanal));
      return antwort();
    }
    case "kt": {
      const kanal = (await alleKanaele())[Number(arg)];
      if (!kanal) return antwort("Kanal nicht gefunden.", true);
      const [l] = laengen(auftrag, [kanal]);
      const setze = (text) => {
        const captions = { ...auftrag.captions };
        if (text === null) delete captions[kanal.id];
        else captions[kanal.id] = text;
        auftrag = auftraege.aendern(id, { captions });
      };
      if (arg2 === "schreiben") {
        auftraege.aendern(id, { wartetAuf: "kanaltext", wartetKanal: kanal.id });
        await tg.senden(auftrag.chatId, `Schick mir den Text für <b>${html(kanal.name)}</b>${l.max ? ` (höchstens ${l.max} Zeichen)` : ""}. Zum Bearbeiten hier der aktuelle:`);
        await tg.aufruf("sendMessage", { chat_id: auftrag.chatId, text: l.text });
        return antwort();
      }
      if (arg2 === "ki") {
        await antwort("KI schreibt …");
        await zeigeMenue(auftrag, { text: `🤖 Schreibe eine Fassung für ${html(kanal.name)} …`, reply_markup: { inline_keyboard: [] } });
        try {
          setze(await kiFassung(auftrag, kanal, l.max));
        } catch (e) {
          await tg.senden(auftrag.chatId, `⚠️ ${html(e.message)}`);
        }
      } else if (arg2 === "kurz") {
        setze(kuerzen(l.text, l.max, (t) => zeichenZahl(t, kanal.identifier)));
      } else if (arg2 === "haupt") {
        setze(null);
      }
      await zeigeMenue(auftrag, await kanalTextInhalt(auftrag, kanal));
      return arg2 === "ki" ? undefined : antwort();
    }
    case "kia": {
      await antwort("KI schreibt …");
      const liste = laengen(auftrag, await gewaehlteKanaele(auftrag));
      // Eine Fassung je Netzwerk; mehrere Konten desselben Netzwerks teilen sie sich
      const netze = [...new Set(liste.map((l) => l.kanal.identifier))];
      const captions = { ...auftrag.captions };
      const fehler = [];
      for (const netz of netze) {
        const gruppe = liste.filter((l) => l.kanal.identifier === netz);
        await zeigeMenue(auftrag, { text: `🤖 Schreibe Fassung für ${netz} (${netze.indexOf(netz) + 1}/${netze.length}) …`, reply_markup: { inline_keyboard: [] } });
        const limits = gruppe.map((l) => l.max).filter((m) => m !== null);
        try {
          const text = await kiFassung(auftrag, gruppe[0].kanal, limits.length ? Math.min(...limits) : null);
          for (const l of gruppe) captions[l.kanal.id] = text;
        } catch (e) {
          fehler.push(`${netz}: ${e.message}`);
        }
      }
      auftrag = auftraege.aendern(id, { captions });
      if (fehler.length) await tg.senden(auftrag.chatId, `⚠️ ${html(fehler.join("\n"))}`);
      await zeigeMenue(auftrag, await captionsInhalt(auftrag));
      return;
    }
    case "kka": {
      const captions = { ...auftrag.captions };
      for (const l of laengen(auftrag, await gewaehlteKanaele(auftrag)).filter((l) => l.zuLang)) {
        captions[l.kanal.id] = kuerzen(l.text, l.max, (t) => zeichenZahl(t, l.kanal.identifier));
      }
      auftrag = auftraege.aendern(id, { captions });
      await zeigeMenue(auftrag, await captionsInhalt(auftrag));
      return antwort("Gekürzt – bitte kurz drüberschauen.");
    }
    case "ku": {
      const kunde = arg === "alle" ? null : kundenAus(await alleKanaele())[Number(arg)];
      auftrag = auftraege.aendern(id, { kunde: kunde?.id ?? null });
      auftrag = auftraege.aendern(id, { kanaele: standardKanaele(await alleKanaele(), auftrag) });
      await zeigeMenue(auftrag);
      return antwort(kunde ? `Kanäle von ${kunde.name} gewählt` : "Alle Kanäle");
    }
    case "collab":
      auftraege.aendern(id, { wartetAuf: "collab" });
      await tg.senden(auftrag.chatId, "Instagram-Namen der Collab-Partner (bis zu 3), z. B. <code>@piraten_nuernberg @humanisten</code>.\n<code>-</code> entfernt alle. Bei Storys gibt es keine Collabs.");
      return antwort();
    case "repost":
      await repostMenue(auftrag);
      return antwort();
    case "bb": {
      if (!arg) {
        await zeigeMenue(auftrag, bauchbindeMenue(auftrag));
        return antwort();
      }
      if (arg === "text") {
        auftraege.aendern(id, { wartetAuf: "bauchbinde" });
        await tg.senden(auftrag.chatId, "Name und Funktion, getrennt mit <code>|</code> oder in zwei Zeilen, z. B.\n<code>Maria Muster | Vorsitzende Radentscheid Nürnberg</code>");
        return antwort();
      }
      const neu = arg === "std" ? standardBauchbinde() : null;
      await antwort();
      return neuRendern(auftraege.aendern(id, { bauchbinde: neu }), neu ? "Bauchbinde kommt rein." : "Bauchbinde ist raus.");
    }
    case "pos": {
      if (!arg) {
        await zeigeMenue(auftrag, lageMenue(auftrag));
        return antwort();
      }
      const lage = arg === "unten" ? null : arg;
      if (!LAGE_TEXT[arg] || lage === (auftrag.untertitelLage ?? null)) {
        await zeigeMenue(auftrag);
        return antwort("Bleibt, wie es ist.");
      }
      await antwort();
      const info = { oben: "Untertitel kommen nach oben.", mitte: "Untertitel kommen in die Mitte.", unten: "Untertitel kommen wieder nach unten." }[arg];
      return neuRendern(auftraege.aendern(id, { untertitelLage: lage, lageAutomatisch: false }), info);
    }
    case "nurst": {
      const alle = await alleKanaele();
      if (auftrag.nurStory) {
        auftrag = auftraege.aendern(id, {
          nurStory: false, story: Boolean(auftrag.vorherigeStory),
          kanaele: auftrag.vorherigeKanaele ?? auftrag.kanaele,
          vorherigeStory: null, vorherigeKanaele: null,
        });
        await zeigeMenue(auftrag);
        return antwort("Wieder normaler Beitrag");
      }
      await gewaehlteKanaele(auftrag);
      const storyKanaele = kanaeleVonKunde(alle, auftrag.kunde).filter((k) => STORY[k.identifier]);
      if (!storyKanaele.length) return antwort("Für diesen Kunden ist kein Instagram-/Facebook-Kanal verbunden.", true);
      const vorherige = [...auftrag.kanaele];
      const auswahl = storyKanaele.filter((k) => vorherige.includes(k.id));
      auftrag = auftraege.aendern(id, {
        nurStory: true, story: true, vorherigeStory: Boolean(auftrag.story),
        vorherigeKanaele: vorherige, kanaele: (auswahl.length ? auswahl : storyKanaele).map((k) => k.id),
      });
      if (!auftrag.storyDatei && await storyNoetig(auftrag)) {
        auftrag = auftraege.aendern(id, { status: "arbeitet" });
        await tg.aufruf("editMessageReplyMarkup", { chat_id: auftrag.chatId, message_id: auftrag.menueNachricht }).catch(() => {});
        einreihen(async () => {
          try {
            await storyAktualisieren(auftraege.get(id));
          } catch (e) {
            console.error(e);
            await tg.senden(auftrag.chatId, `❌ Story konnte nicht erstellt werden: <pre>${html(e.message)}</pre>`);
          }
          await neuesMenue(auftraege.aendern(id, { status: "vorschau" }));
        });
        return antwort("Erstelle die reine Story …");
      }
      await zeigeMenue(auftrag);
      return antwort("Nur Story – kein normaler Beitrag");
    }
    case "storytext": {
      if (art(auftrag) !== "foto" || !auftrag.story) return antwort("Bildtext ist nur für Foto-Storys verfügbar.", true);
      auftraege.aendern(id, { wartetAuf: "storytext" });
      await tg.senden(auftrag.chatId,
        `Schick mir den Text, der direkt auf dem Story-Foto stehen soll (maximal 6 Zeilen).\n\n<b>Aktuell:</b> ${html(auftrag.storyText || "kein Text")}\n\nMit <code>-</code> entfernst du den Bildtext. Mit <code>abbrechen</code> kehrst du zurück.`);
      return antwort();
    }
    case "hochkant": {
      auftrag = auftraege.aendern(id, { hochkant: !auftrag.hochkant });
      if (auftrag.hochkant && !auftrag.storyDatei) {
        auftrag = auftraege.aendern(id, { status: "arbeitet" });
        await tg.aufruf("editMessageReplyMarkup", { chat_id: auftrag.chatId, message_id: auftrag.menueNachricht }).catch(() => {});
        einreihen(async () => {
          await storyAktualisieren(auftraege.get(id)).catch((e) => console.error(e));
          await neuesMenue(auftraege.aendern(id, { status: "vorschau" }));
        });
        return antwort("Baue die 9:16-Fassung für Instagram/TikTok …");
      }
      // Ohne Story wird die Fassung nicht mehr gebraucht
      if (!auftrag.hochkant && !auftrag.story) auftrag = auftraege.aendern(id, { storyDatei: null, storyHochgeladen: null });
      await zeigeMenue(auftrag);
      return antwort(auftrag.hochkant ? "Instagram/TikTok bekommen die 9:16-Fassung" : "Alle Kanäle bekommen das Querformat");
    }
    case "story": {
      if (auftrag.nurStory) return antwort("Im Modus Nur Story bleibt Story aktiv.", true);
      auftrag = auftraege.aendern(id, { story: !auftrag.story });
      if (auftrag.story && !auftrag.storyDatei && (await storyNoetig(auftrag))) {
        // Nicht 9:16: eigene Story-Fassung bauen, danach kommt das Menü neu
        auftrag = auftraege.aendern(id, { status: "arbeitet" });
        await tg.aufruf("editMessageReplyMarkup", { chat_id: auftrag.chatId, message_id: auftrag.menueNachricht }).catch(() => {});
        einreihen(async () => {
          await storyAktualisieren(auftraege.get(id)).catch((e) => console.error(e));
          await neuesMenue(auftraege.aendern(id, { status: "vorschau" }));
        });
        return antwort("Baue eine eigene Story-Fassung in 9:16 …");
      }
      await zeigeMenue(auftrag);
      return antwort(auftrag.story ? "Kommt zusätzlich als Story (erstes Bild bzw. Video)" : "Keine Story");
    }
    case "rp": {
      const kanal = (await alleKanaele())[Number(arg)];
      const repost = auftrag.repost ?? { kanaele: [], verzoegerung: 0 };
      if (kanal) {
        repost.kanaele = repost.kanaele.includes(kanal.id) ? repost.kanaele.filter((k) => k !== kanal.id) : [...repost.kanaele, kanal.id];
        auftrag = auftraege.aendern(id, { repost });
      }
      await repostMenue(auftrag);
      return antwort();
    }
    case "rv": {
      const repost = auftrag.repost ?? { kanaele: [], verzoegerung: 0 };
      const i = REPOST_VERZOEGERUNG.findIndex(([, ms]) => ms === repost.verzoegerung);
      repost.verzoegerung = REPOST_VERZOEGERUNG[(i + 1) % REPOST_VERZOEGERUNG.length][1];
      auftrag = auftraege.aendern(id, { repost });
      await repostMenue(auftrag);
      return antwort();
    }
    case "k": {
      const kanal = (await alleKanaele())[Number(arg)];
      if (kanal) {
        if (auftrag.nurStory && !STORY[kanal.identifier]) return antwort("Im Modus Nur Story nur Instagram/Facebook wählen.", true);
        await gewaehlteKanaele(auftrag);
        const liste = auftrag.kanaele.includes(kanal.id) ? auftrag.kanaele.filter((k) => k !== kanal.id) : [...auftrag.kanaele, kanal.id];
        auftrag = auftraege.aendern(id, { kanaele: liste });
      }
      await kanalMenue(auftrag);
      return antwort();
    }
    case "zurueck":
      auftraege.aendern(id, { plan: null });
      await zeigeMenue(auftrag);
      return antwort();
    case "ja":
      await antwort("Wird erledigt …");
      return veroeffentlichen(auftrag);
    case "verwerfen":
      auftraege.aendern(id, { status: "verworfen" });
      await zeigeMenue(auftrag, { text: "🗑️ Verworfen.", reply_markup: { inline_keyboard: [] } });
      return antwort();
    default:
      return antwort();
  }
}

async function texteingabe(auftrag, text) {
  if (/^(abbrechen|stop)$/i.test(text.trim())) {
    auftrag = auftraege.aendern(auftrag.id, { wartetAuf: null });
    return neuesMenue(auftrag);
  }
  switch (auftrag.wartetAuf) {
    case "storytext": {
      const neu = text.trim() === "-" ? "" : text.trim();
      if (neu) {
        try { storyTextZeilen(neu); }
        catch (e) { return tg.senden(auftrag.chatId, `❌ ${html(e.message)} Bitte kürzeren Text schicken.`); }
      }
      auftrag = auftraege.aendern(auftrag.id, { storyText: neu, wartetAuf: null, status: "arbeitet" });
      await tg.senden(auftrag.chatId, "✏️ Erstelle Story-Vorschau mit Bildtext …");
      einreihen(async () => {
        try { await storyAktualisieren(auftraege.get(auftrag.id)); }
        catch (e) {
          console.error(e);
          auftraege.aendern(auftrag.id, { storyDatei: null, storyHochgeladen: null });
          await tg.senden(auftrag.chatId, `❌ Bildtext fehlgeschlagen: <pre>${html(e.message)}</pre>`);
        }
        await neuesMenue(auftraege.aendern(auftrag.id, { status: "vorschau" }));
      });
      return;
    }
    case "caption":
      auftrag = auftraege.aendern(auftrag.id, { caption: text.trim(), captionQuelle: "eigene", wartetAuf: null });
      auftrag = await captionsZuruecksetzen(auftrag);
      return neuesMenue(auftrag);
    case "kanaltext": {
      const kanal = (await alleKanaele()).find((k) => k.id === auftrag.wartetKanal);
      if (!kanal) return tg.senden(auftrag.chatId, "Den Kanal gibt es nicht mehr.");
      auftrag = auftraege.aendern(auftrag.id, { captions: { ...auftrag.captions, [kanal.id]: text.trim() }, wartetAuf: null, wartetKanal: null });
      return neuesMenue(auftrag, await kanalTextInhalt(auftrag, kanal));
    }
    case "hinweis": {
      await tg.senden(auftrag.chatId, "✍️ Formuliere neu …");
      const hinweis = text.trim() === "-" ? "" : text.trim();
      const material = { art: art(auftrag), transkript: auftrag.transkript, notizen: auftrag.notizen, bilder: auftrag.fuerKi, bisher: auftrag.caption };
      const v = await captionVorschlag(material, config.caption, hinweis || "neu formulieren");
      if (v.fehler) await tg.senden(auftrag.chatId, `⚠️ ${html(v.fehler)}`);
      auftrag = auftraege.aendern(auftrag.id, { caption: v.text, captionQuelle: v.quelle, wartetAuf: null });
      auftrag = await captionsZuruecksetzen(auftrag);
      return neuesMenue(auftrag);
    }
    case "bauchbinde": {
      const neu = parseBauchbinde(text);
      if (!neu) return tg.senden(auftrag.chatId, "Bitte so: <code>Name | Funktion</code>");
      return neuRendern(auftraege.aendern(auftrag.id, { bauchbinde: neu }), `Bauchbinde: ${bauchbindeText(neu)}.`);
    }
    case "collab": {
      const collabs = text.trim() === "-" ? [] : parseCollabs(text);
      if (collabs.length > 3) return tg.senden(auftrag.chatId, "Instagram erlaubt höchstens 3 Collab-Partner – bitte nochmal.");
      auftrag = auftraege.aendern(auftrag.id, { collabs, wartetAuf: null });
      return neuesMenue(auftrag);
    }
    case "zeit": {
      const zeit = parseZeit(text);
      if (!zeit) return tg.senden(auftrag.chatId, "Das hab ich nicht verstanden (oder es liegt in der Vergangenheit). Nochmal? <code>abbrechen</code> geht auch.");
      const inhalt = await bestaetigung(auftrag, zeit - Date.now() < 2 * 60e3 ? "now" : "schedule", zeit);
      if (inhalt.fehler) return tg.senden(auftrag.chatId, inhalt.fehler);
      auftrag = auftraege.aendern(auftrag.id, { wartetAuf: null });
      return neuesMenue(auftrag, inhalt);
    }
    case "untertitel": {
      const srt = datei(auftrag, "untertitel.srt");
      const b = wendeBearbeitungAn(parseSrt(await fs.readFile(srt, "utf8")), text);
      if (!b.erkannt) {
        return tg.senden(auftrag.chatId, "Bitte die Liste mit den Nummern vorne zurückschicken (z. B. <code>4 Ob das klappt?</code>) oder <code>falsch => richtig</code>. <code>abbrechen</code> beendet das Bearbeiten.");
      }
      const teile = [
        b.geaendert && `${b.geaendert} Untertitel geändert`,
        b.geloescht && `${b.geloescht} gelöscht`,
        b.ersetzt && `${b.ersetzt} Ersetzung(en) übernommen`,
      ].filter(Boolean);
      const warnung = b.unbekannt.length ? ` Nummer ${b.unbekannt.join(", ")} gibt es nicht.` : "";
      if (!teile.length) return tg.senden(auftrag.chatId, `Ich habe keine Änderung gefunden.${warnung} Schick die geänderten Zeilen oder <code>abbrechen</code>.`);
      await fs.writeFile(srt, formatSrt(b.cues));
      return neuRendern(auftrag, `${teile.join(", ")}.${warnung}`);
    }
  }
}

/** Video mit geänderten Untertiteln oder Bauchbinde neu bauen. */
async function neuRendern(auftrag, info) {
  auftrag = auftraege.aendern(auftrag.id, { wartetAuf: null, statusNachricht: null });
  if (auftrag.menueNachricht) {
    await tg.aufruf("editMessageReplyMarkup", { chat_id: auftrag.chatId, message_id: auftrag.menueNachricht }).catch(() => {});
  }
  await tg.senden(auftrag.chatId, `📝 ${info} Baue das Video neu …`);
  einreihen(() => renderUndVorschau(auftrag.id));
}

async function srtDatei(auftrag, dokument) {
  const tmp = datei(auftrag, "upload.srt");
  await tg.herunterladen(dokument.file_id, tmp);
  const cues = parseSrt(await fs.readFile(tmp, "utf8"));
  if (!cues.length) return tg.senden(auftrag.chatId, "In der Datei habe ich keine Untertitel gefunden.");
  await fs.writeFile(datei(auftrag, "untertitel.srt"), formatSrt(cues));
  await neuRendern(auftrag, `Untertitel-Datei mit ${cues.length} Einträgen übernommen.`);
}

async function nachricht(msg) {
  const chatId = msg.chat.id;
  const nutzer = msg.from?.id;
  if (/^\/id\b/.test(msg.text ?? "")) {
    return tg.senden(chatId, `Deine Telegram-ID: <code>${nutzer}</code>${msg.chat.type !== "private" ? `\nID dieser Gruppe: <code>${chatId}</code>` : ""}`);
  }
  if (!erlaubt(nutzer, chatId)) {
    // In Gruppen nicht auf jede Nachricht antworten
    if (msg.chat.type === "private") {
      await tg.senden(chatId, `Kein Zugriff. Deine Telegram-ID ist <code>${nutzer}</code> – zum Freischalten in <code>ERLAUBTE_NUTZER</code> eintragen.`);
    }
    return;
  }

  const video = msg.video ?? (msg.document?.mime_type?.startsWith("video/") ? msg.document : null);
  if (video) return neuesVideo(msg, video);
  const foto = msg.photo?.at(-1) ?? (msg.document?.mime_type?.startsWith("image/") ? msg.document : null);
  if (foto) return fotoEingang(msg, foto);

  const wartend = auftraege.wartend(chatId);
  if (msg.document && /\.srt$/i.test(msg.document.file_name ?? "") && wartend?.wartetAuf === "untertitel") {
    return srtDatei(wartend, msg.document);
  }

  const text = msg.text ?? "";
  if (/^\/(start|hilfe|help)\b/.test(text)) return tg.senden(chatId, HILFE);
  if (/^\/kanaele\b/.test(text)) {
    kanalCache.zeit = 0;
    const kanaele = await alleKanaele();
    if (!kanaele.length) return tg.senden(chatId, "In Postiz sind noch keine Kanäle verbunden.");
    const gruppen = [...kundenAus(kanaele).map((k) => [k.name, kanaeleVonKunde(kanaele, k.id)]), ["Ohne Kunde", kanaele.filter((k) => !k.customer)]];
    return tg.senden(chatId, gruppen
      .filter(([, liste]) => liste.length)
      .map(([name, liste]) => `👤 <b>${html(name)}</b>\n${liste.map((k) => `• ${html(k.name)} (${k.identifier})\n  <code>${k.id}</code>`).join("\n")}`)
      .join("\n\n"));
  }
  if (/^\/status\b/.test(text)) return tg.senden(chatId, await status());
  if (wartend && text) return texteingabe(wartend, text);
  if (/^(abbrechen|stop)$/i.test(text.trim())) return tg.senden(chatId, "Gerade läuft nichts, das ich abbrechen könnte.");
  if (text && !text.startsWith("/")) return textBeitrag(chatId, text);
  return tg.senden(chatId, "Schick mir ein Video, Fotos oder einfach Text – oder /hilfe.");
}

async function status() {
  const pruefe = async (name, fn) => {
    try {
      return `✅ ${name}: ${await fn()}`;
    } catch (e) {
      return `❌ ${name}: ${html(e.message.split("\n").at(-1).slice(0, 200))}`;
    }
  };
  return [
    await pruefe("Postiz", async () => {
      kanalCache.zeit = 0;
      const kanaele = await alleKanaele();
      const kunde = findeKunde(kanaele, config.postiz.kunde);
      if (config.postiz.kunde && !kunde) throw new Error(`Kunde „${config.postiz.kunde}“ (POSTIZ_KUNDE) gibt es nicht`);
      return `${kanaele.length} Kanäle, ${kundenAus(kanaele).length} Kunden${kunde ? `, Standard: ${html(kunde.name)}` : ""}`;
    }),
    await pruefe("ffmpeg", async () => (await ausfuehren("ffmpeg", ["-version"])).split("\n")[0].split(" ").slice(0, 3).join(" ")),
    await pruefe("Whisper", async () => {
      await fs.access(config.whisper.modell);
      await ausfuehren(config.whisper.bin, ["--help"]);
      return path.basename(config.whisper.modell);
    }),
    ...(mastodon ? [await pruefe("Mastodon direkt", async () => `@${await mastodon.konto()} (${mastodon.sichtbarkeit}${mastodon.inhaltswarnung ? `, Inhaltswarnung „${html(mastodon.inhaltswarnung)}“` : ""})`)] : []),
    `ℹ️ Postiz-Anfragen letzte Stunde: ${postiz.zaehler.anzahl()}${config.postiz.maxAnfragen ? `/${config.postiz.maxAnfragen}` : ""}`,
    `${config.caption.anbieter ? "✅" : "➖"} Caption-KI: ${config.caption.anbieter ? `${config.caption.anbieter} (${html(config.caption.modell)})` : "aus"}`,
    `ℹ️ Telegram: ${tg.lokal ? "lokaler Bot-API-Server" : "api.telegram.org (max. 20 MB)"}`,
  ].join("\n");
}

/** Fällige Postiz-Posts nachsehen und Probleme melden (fragt Postiz nur, wenn etwas fällig ist). */
async function kontrollieren() {
  const datei = path.join(config.datenDir, "kontrolle.json");
  let kontrolle = { erledigt: {}, gemeldet: {} };
  try {
    kontrolle = JSON.parse(await fs.readFile(datei, "utf8"));
  } catch {}
  const faellig = faelligeKontrollen(erwartetePosts(Object.values(auftraege.alle)), kontrolle);
  if (!faellig.length || postiz.zaehler.wiederFrei(1)) return;
  const { von, bis } = abfragezeitraum(faellig);
  const meldungen = auswerten(await postiz.posts(von, bis), faellig, kontrolle);
  for (const [chatId, texte] of meldungen) for (const text of texte) await tg.senden(chatId, html(text)).catch(() => {});
  await fs.writeFile(datei, JSON.stringify(kontrolle));
}

async function fehlerMelden(chatId, e) {
  console.error(e);
  if (chatId) await tg.senden(chatId, `❌ ${html(e.message)}`).catch(() => {});
}

// ---------- Start ----------

async function main() {
  const ich = await tg.aufruf("getMe");
  console.log(`Bot @${ich.username} läuft (${tg.lokal ? "lokaler Bot-API-Server" : "api.telegram.org"}).`);
  if (!config.telegram.erlaubt.length) console.warn("ERLAUBTE_NUTZER ist leer – niemand kann den Bot nutzen. Schreib dem Bot, er nennt dir deine ID.");

  // Verarbeitungen, die ein Neustart unterbrochen hat
  for (const a of Object.values(auftraege.alle)) {
    if (a.status === "arbeitet" || a.status === "postet") {
      auftraege.aendern(a.id, { status: a.status === "postet" ? "vorschau" : "fehler" });
      await tg.senden(a.chatId, a.status === "fehler"
        ? "⚠️ Der Bot wurde während der Verarbeitung neu gestartet – bitte nochmal schicken."
        : "⚠️ Der Bot wurde beim Posten neu gestartet – bitte in Postiz prüfen, ob der Beitrag angelegt wurde.").catch(() => {});
    }
  }
  auftraege.aufraeumen();
  setInterval(() => auftraege.aufraeumen(), 24 * 3600e3);
  const kontrolleLauf = () => kontrollieren().catch((e) => console.error("Kontrolle:", e.message));
  kontrolleLauf(); // gleich nach dem Start, z. B. nach einem Neustart des Pi
  setInterval(kontrolleLauf, 5 * 60e3);

  let offset = 0;
  for (;;) {
    let updates;
    try {
      updates = await tg.aufruf("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
    } catch (e) {
      console.error("getUpdates:", e.message);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      const verarbeite = u.message
        ? nachricht(u.message)
        : u.callback_query && erlaubt(u.callback_query.from.id, u.callback_query.message?.chat.id)
          ? knopfGedrueckt(u.callback_query)
          : null;
      verarbeite?.catch((e) => fehlerMelden(u.message?.chat.id ?? u.callback_query?.message?.chat.id, e));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

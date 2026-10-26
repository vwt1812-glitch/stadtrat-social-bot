// Telegram-Bot: Video, Fotos oder Text rein → Vorschau mit Logo, Untertiteln und
// Caption zurück → per Knopfdruck sofort oder geplant über Postiz veröffentlichen.

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
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
  ausfuehren, untersuche, tonFuerWhisper, rendern, vorschau, fotoRendern, fotoFuerKi, storyFoto, istStoryFormat, STORY_MASSE, storyLayout, querLayout,
} from "./video.mjs";
import { transkribiere } from "./whisper.mjs";
import { gesichtSuchen, lageWaehlen } from "./gesicht.mjs";
import { captionVorschlag, einfacherVorschlag, kuerzen } from "./caption.mjs";
import { parseSrt, formatSrt, zuAss, volltext, parseBauchbinde, alsListe, wendeBearbeitungAn } from "./untertitel.mjs";
import { parseZeit, zeitText, vorschlaege } from "./zeit.mjs";
import { storyFotoText, storyTextZeilen } from "./story-text.mjs";
import { textGrafiken, textAnimation } from "./grafik-text.mjs";
import { IdeenSpeicher, antragVorschlaege, grafikText, kurzerTitel } from "./redaktion.mjs";
import { quellenVorlage, quellenBearbeiten, quellenZeilen } from "./quellen.mjs";
import { thumbnailsErstellen, thumbnailZiel, videoStand, frameZeit, coverBedarf, THUMBNAIL_PROFILE, originalProfil } from "./thumbnail.mjs";

const config = ladeConfig();
const tg = new Telegram(config.telegram);
const auftraege = new Auftraege(config.datenDir);
const ideen = new IdeenSpeicher(config.datenDir);
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
  if (auftrag.videoFormatFehler) return "Die Videofassung konnte nicht erstellt werden. Bitte das Videoformat erneut wählen und die neue Vorschau prüfen.";
  const postizKanaele = kanaele.filter((k) => k.id !== DIREKT);
  if (!postizKanaele.length) return null;
  const medien = (auftrag.medien ?? [datei(auftrag, "fertig.mp4")]).length;
  const bedarf = Postiz.bedarf({
    medien: auftrag.nurStory ? 1 : medien,
    hochgeladen: Boolean(auftrag.hochgeladen), story: auftrag.story, nurStory: Boolean(auftrag.nurStory), kanaele: postizKanaele,
    storyUpload: Boolean(auftrag.storyDatei && !auftrag.storyHochgeladen),
    storyBereit: Boolean(auftrag.storyDatei ? auftrag.storyHochgeladen : auftrag.hochgeladen),
    hochkant: hochkantAn(auftrag), hochkantNetze: config.hochkant.netze,
    fortschritt: auftrag.postiz,
    coverUploads: art(auftrag) === "video" && !auftrag.nurStory ? coverBedarf(auftrag.thumbnail, postizKanaele, config.postiz.mastodonThumbnails) : 0,
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
  const basis = passendeKanaele(vorgabe.length ? vorgabe : vomKunden, art(auftrag));
  if (!auftrag.nurStory) return basis.map((k) => k.id);
  const storyVorgabe = basis.filter((k) => STORY[k.identifier]);
  return (storyVorgabe.length ? storyVorgabe : vomKunden.filter((k) => STORY[k.identifier])).map((k) => k.id);
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
  zeilen.push([knopf("↩️ Zur Vorschau", auftrag, "zurueck")]);
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
async function captionsZuruecksetzen(auftrag, felder) {
  const hatteFassungen = Object.keys(auftrag.captions ?? {}).length > 0;
  // Eine redaktionelle Änderung ist genau eine Version, inklusive abhängiger Kanaltexte.
  auftrag = auftraege.aendern(auftrag.id, { ...felder, captions: {} });
  if (hatteFassungen) await tg.senden(auftrag.chatId, "ℹ️ Die eigenen Fassungen pro Kanal wurden zurückgesetzt, weil sich der Haupttext geändert hat.");
  return auftrag;
}

// ---------- Bauchbinde ----------

const standardBauchbinde = () => (config.bauchbinde.name ? { name: config.bauchbinde.name, funktion: config.bauchbinde.funktion } : null);
const bauchbindeText = (b) => html([b.name, b.funktion].filter(Boolean).join(" – "));

function bauchbindeMenue(auftrag) {
  const zeilen = [];
  const standard = standardBauchbinde();
  if (standard) zeilen.push([knopf(`👤 ${[standard.name, standard.funktion].filter(Boolean).join(" – ")}`, auftrag, "bb:std")]);
  zeilen.push([knopf("✏️ Anderer Name / Funktion", auftrag, "bb:text")]);
  if (auftrag.bauchbinde) zeilen.push([knopf("🚫 Namenseinblendung entfernen", auftrag, "bb:aus")]);
  zeilen.push([knopf("↩️ Zur Vorschau", auftrag, "zurueck")]);
  const jetzt = auftrag.bauchbinde ? `Jetzt: <b>${bauchbindeText(auftrag.bauchbinde)}</b>` : "Jetzt: keine";
  return {
    text: `<b>Name und Funktion im Video</b> (Bauchbinde)\n${config.layout.bauchbindeStart} s nach Beginn für ${config.layout.bauchbindeDauer} s eingeblendet.\n${jetzt}`,
    reply_markup: { inline_keyboard: zeilen },
  };
}

// ---------- Lage der Untertitel ----------

const LAGE_TEXT = { oben: "⬆️ Oben", mitte: "↕️ Mitte", unten: "⬇️ Unten (Standard)" };

function lageMenue(auftrag) {
  const jetzt = auftrag.untertitelLage ?? "unten";
  const zeilen = Object.entries(LAGE_TEXT).map(([lage, text]) => [knopf(`${lage === jetzt ? "🔘" : "⚪"} ${text}`, auftrag, `pos:${lage}`)]);
  zeilen.push([knopf("↩️ Zur Vorschau", auftrag, "zurueck")]);
  return {
    text: "<b>Untertitel-Position</b> – „Unten“ liegt über Name und Caption von TikTok und Reels. Verdecken die Untertitel etwas Wichtiges (Gesicht, Schild), weiter nach oben schieben.",
    reply_markup: { inline_keyboard: zeilen },
  };
}

/** Layout für diesen Auftrag: Einstellungen aus der .env plus gewählte Lage der Untertitel. */
const layoutFuer = (auftrag) => ({
  ...config.layout,
  lage: auftrag.untertitelLage ?? null,
  gesichter: auftrag.gesichter ?? [],
  // Reguläre Beiträge behalten ihr Layout; für Hochkantvideos vermeiden wir zusätzlich Gesichter.
  smartLogo: Boolean(auftrag.gesichter?.length && auftrag.masse?.hoehe > auftrag.masse?.breite),
  layoutModus: "reel",
});

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
  if (auftrag.story && art(auftrag) === "foto" && auftrag.storyLogoPosition && auftrag.storyLogoPosition !== "auto") {
    zeilen.push(`🏷️ Story-Logo: ${html(auftrag.storyLogoPosition)}`);
  }
  if (hochkantAn(auftrag)) zeilen.push("📲 Instagram/TikTok bekommen eine eigene 9:16-Fassung, die anderen das Querformat");
  if (querAn(auftrag)) zeilen.push("🖥️ Feed-Fassung in 16:9 mit unscharfen Seitenflächen");
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

const STORY_LOGO_LAGEN = [
  ["auto", "✨ Automatisch"], ["oben-links", "↖️ Oben links"], ["oben-mitte", "⬆️ Oben Mitte"],
  ["oben-rechts", "↗️ Oben rechts"], ["unten-links", "↙️ Unten links"],
  ["unten-mitte", "⬇️ Unten Mitte"], ["unten-rechts", "↘️ Unten rechts"],
];

function storyLayoutMenue(auftrag) {
  const zeilen = STORY_LOGO_LAGEN.map(([wert, name]) => [
    knopf(`${(auftrag.storyLogoPosition ?? "auto") === wert ? "🔘" : "⚪"} ${name}`, auftrag, `sl:${wert}`),
  ]);
  if (auftrag.storyText) {
    // Beschriftung steht im Text; kein wirkungsloser Überschriften-Button.
    for (const wert of ["auto", "oben", "mitte", "unten"]) {
      const name = { auto: "Automatisch", oben: "Oben", mitte: "Mitte", unten: "Unten" }[wert];
      zeilen.push([knopf(`${(auftrag.storyTextPosition ?? "auto") === wert ? "🔘" : "⚪"} Bildtext: ${name}`, auftrag, `stp:${wert}`)]);
    }
  }
  zeilen.push([knopf("↩️ Zur Vorschau", auftrag, "zurueck")]);
  return {
    text: "<b>Story-Layout</b>\nLogo bevorzugt auf freien unscharfen Flächen. Manuelle Positionen bleiben innerhalb der Instagram-/Facebook-Safe-Area und weichen bei Gesichtern gegebenenfalls aus. Nach einer Änderung kommt eine neue Vorschau.",
    reply_markup: { inline_keyboard: zeilen },
  };
}
const datei = (auftrag, name) => path.join(auftrag.ordner, name);

const HILFE = `<b>So funktioniert's</b>
Schick mir
• ein <b>Video</b> – am besten <b>als Datei</b> (📎 → Datei), dann bleibt die volle Qualität erhalten. Ich baue Logo und Untertitel ein.
• ein oder mehrere <b>Fotos</b> (als Album = Karussell). Ich setze das Logo drauf. Text in der Bildunterschrift wird zum Beitragstext. Über <b>📱 Ausschließlich als Story</b> und <b>✏️ Text auf Storyfoto ändern</b> kannst du eine reine Fotostory machen.
• einfach <b>Text</b> – daraus wird ein Textbeitrag. Mit „🖼️ Beitragsgrafik“ oder „📱 Storygrafik“ entsteht lokal eine fertige Grafik.
• eine <b>Sprachnachricht</b> – Whisper transkribiert sie lokal und du entscheidest über Textpost, Grafik oder Ideenspeicher.
• einen <b>Antrag als PDF</b> – ich zeige dir Textauszüge für Posts und Sharepics, ohne unbelegte KI-Zusammenfassung.

Danach kannst du Beitragstext, Kunde, Kanäle, Instagram-Mitautoren und Zeit anpassen.
<b>Videoformat ändern</b> verändert das Video, <b>Video-Titelbild</b> nur dessen Vorschaubild.
Veröffentlicht wird erst mit der abschließenden Bestätigung; bei einem Termin heißt sie <b>Termin bestätigen</b>.

/idee Text – Gedanken für später speichern
/ideen – deine gespeicherten Ideen wieder aufrufen
/entwuerfe – vollständige Entwürfe wieder öffnen oder archivieren
/archiv – archivierte Entwürfe wiederherstellen
/antrag – Hinweise für das Hochladen von Antrags-PDFs
/kanaele – verbundene Postiz-Kanäle nach Kunden
/status – prüft Postiz, Whisper, ffmpeg und KI
/id – zeigt deine Telegram-ID (und die der Gruppe)
/hilfe – diese Hilfe`;

// ---------- Menüs ----------

async function menueInhalt(auftrag) {
  if (auftrag.postiz || auftrag.postizUnklar || auftrag.mastodon) return fortsetzenMenue(auftrag);
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
    hashtags: "\n<i>(noch ohne Text – über „Beitragstext bearbeiten“ ergänzen)</i>",
  }[auftrag.captionQuelle] ?? "";
  const titel = auftrag.grafikAnimation ? (auftrag.nurStory ? "Story-Animation" : "Animierte Textgrafik") :
    auftrag.grafikModus ? (auftrag.nurStory ? "Storygrafik" : "Sharepic") :
    auftrag.antragVarianten?.length ? "Antrag – Textentwurf" :
    auftrag.nurStory ? "Story-Vorschau" : art(auftrag) === "text" ? "Textbeitrag" : "Beitragstext-Vorschlag";
  const hinweise = [];
  try {
    const liste = auftrag.nurStory ? [] : laengen(auftrag, kanaele);
    const eigen = liste.filter((l) => l.eigen && !l.zuLang);
    if (eigen.length) hinweise.push(`✂️ Eigene Fassung: ${eigen.map((l) => `${html(l.kanal.name)} (${zahlText(l)})`).join(", ")}`);
    const zuLang = liste.filter((l) => l.zuLang);
    if (zuLang.length) hinweise.push(`⚠️ Zu lang für ${zuLang.map((l) => `${html(l.kanal.name)} (${zahlText(l)})`).join(", ")} – unter „✂️ Text je Kanal“ anpassen`);
  } catch (e) {
    hinweise.push(`⚠️ ${html(e.message)}`);
  }
  const text = [
    auftrag.nurStory ? `<b>${titel}</b>\nDie Story erhält keine Beitragstext. Text kannst du direkt aufs Foto setzen.`
      : `<b>${titel}</b>${quelle}\n<blockquote expandable>${html(auftrag.caption)}</blockquote>`,
    ...details(auftrag, alle), `📺 ${kanalText}`, ...hinweise,
  ].join("\n");
  const extra = {
    video: auftrag.grafikAnimation ? [] : [knopf("📝 Untertitel bearbeiten", auftrag, "untertitel"), knopf("📍 Untertitelposition", auftrag, "pos"), knopf("🪪 Name / Funktion im Video", auftrag, "bb")],
    foto: auftrag.grafikModus ? [] : [knopf(auftrag.mitLogo ? "🏷️ Logo entfernen" : "🏷️ Logo hinzufügen", auftrag, "logo")],
    text: [],
  }[art(auftrag)];
  const zeilen = [
    [knopf("✅ Jetzt veröffentlichen", auftrag, "jetzt"), knopf("🕐 Termin wählen", auftrag, "planen")],
    ...(!auftrag.grafikModus && art(auftrag) === "text" ? [
      [knopf("🖼️ Beitragsgrafik", auftrag, "grafik:post"), knopf("📱 Storygrafik", auftrag, "grafik:story")],
      [knopf("🎞️ Beitragsanimation", auftrag, "anim:post"), knopf("🎞️ Storyanimation", auftrag, "anim:story")],
    ] : []),
    ...(auftrag.grafikModus ? [
      [knopf(auftrag.grafikAnimation ? "🖼️ Animation ausschalten" : "🎞️ Grafik animieren",
        auftrag, `${auftrag.grafikAnimation ? "grafik" : "anim"}:${auftrag.nurStory ? "story" : "post"}`)],
      [knopf(auftrag.nurStory ? "🖼️ Beitragsformat verwenden" : "📱 Storyformat verwenden", auftrag,
        `${auftrag.grafikAnimation ? "anim" : "grafik"}:${auftrag.nurStory ? "post" : "story"}`)],
      [knopf("✏️ Text in Grafik ändern", auftrag, "grafiktext")],
      [knopf("↩️ Zurück zum Text", auftrag, "grafik:text")],
    ] : []),
    ...(auftrag.antragVarianten?.length ? [[knopf("📄 Andere Antragspassage", auftrag, "antragmenu")]] : []),
    [knopf("💾 Als Idee speichern", auftrag, "idee"), knopf("📚 Quelle und Stand", auftrag, "quelle")],
    ...(auftrag.versionen?.length ? [[knopf("↶ Letzte Textänderung zurück", auftrag, "undo")]] : []),
    ...(art(auftrag) === "video" && !auftrag.nurStory ? [[knopf(auftrag.thumbnail ? "🖼️ Video-Titelbild bearbeiten" : "🖼️ Video-Titelbild erstellen", auftrag, "thumb")]] : []),
    ...(!auftrag.nurStory ? [[knopf("✏️ Beitragstext bearbeiten", auftrag, "caption")], ...(config.caption.anbieter ? [[knopf("🤖 Beitragstext neu formulieren", auftrag, "neu")]] : [])] : []),
    ...extra.map((taste) => [taste]),
    [knopf("📺 Kanäle auswählen", auftrag, "kanaele"), ...(!auftrag.nurStory && kanaele.length ? [knopf("✂️ Text je Kanal", auftrag, "pk")] : [])],
  ];
  const optionen = [];
  if (kundenAus(alle).length) optionen.push(knopf("👤 Kunde auswählen", auftrag, "kunde"));
  if (!auftrag.nurStory && art(auftrag) !== "text" && kanaele.some((k) => k.identifier.startsWith("instagram"))) optionen.push(knopf("🤝 Instagram-Mitautoren", auftrag, "collab"));
  if (!auftrag.nurStory && repostKandidaten(alle, kanaele).length) optionen.push(knopf("🔁 Teilen durch andere Konten", auftrag, "repost"));
  if (art(auftrag) !== "text" && !auftrag.nurStory && kanaele.some((k) => STORY[k.identifier])) optionen.push(knopf(auftrag.story ? "📱 Zusätzliche Story entfernen" : "📱 Zusätzliche Story hinzufügen", auftrag, "story"));
  if (art(auftrag) !== "text" && !auftrag.grafikModus && alle.some((k) => STORY[k.identifier] && (auftrag.kunde == null || k.customer?.id === auftrag.kunde))) {
    optionen.push(knopf(auftrag.nurStory ? "🖼️ Zurück zum Beitragsmodus" : "📱 Ausschließlich als Story", auftrag, "nurst"));
  }
  if (art(auftrag) === "foto" && auftrag.story && !auftrag.grafikModus) {
    optionen.push(knopf("✏️ Text auf Storyfoto ändern", auftrag, "storytext"));
    optionen.push(knopf("🖼️ Logo- und Textposition", auftrag, "slmenu"));
  }
  if (!auftrag.nurStory && art(auftrag) === "video" && !auftrag.grafikAnimation &&
      (auftrag.masse?.hoehe > auftrag.masse?.breite || (hochkantMoeglich(auftrag) && kanaele.some((k) => config.hochkant.netze.includes(k.identifier))))) {
    optionen.push(knopf("📐 Videoformat ändern", auftrag, "videoformat"));
  }
  for (const taste of optionen) zeilen.push([taste]);
  zeilen.push([knopf("🗃️ Entwurf archivieren", auftrag, "archiv"), knopf("🗑️ Entwurf verwerfen", auftrag, "verwerfen")]);
  return { text, reply_markup: { inline_keyboard: zeilen } };
}

function coverVideo(a) {
  return a.medien?.[0] ?? datei(a, "fertig.mp4");
}

async function videoFormatMenue(a) {
  const kanaele = await gewaehlteKanaele(a);
  const ziele = kanaele.filter((k) => config.hochkant.netze.includes(k.identifier));
  const masse = feedMasse(a);
  const zeilen = [];
  if (a.masse?.hoehe > a.masse?.breite) {
    zeilen.push([knopf(querAn(a) ? "↩️ Feed im Originalformat" : "🖥️ Feed auf Querformat umstellen", a, "quer")]);
  }
  if (hochkantMoeglich(a) && ziele.length) {
    zeilen.push([knopf(hochkantAn(a) ? "📺 Überall Feedformat nutzen" : "📱 Zusätzlich Hochkant nutzen", a, "hochkant")]);
  }
  zeilen.push([knopf("↩️ Zur Vorschau", a, "zurueck")]);
  return {
    text: "<b>Videoformat</b>\n" +
      `Feed: ${querAn(a) ? "Querformat (16:9)" : "Originalformat"}${masse ? ` · ${masse.breite}×${masse.hoehe} Pixel` : ""}\n` +
      (hochkantAn(a) && ziele.length ? `Zusätzlich Hochkant (9:16) für: ${ziele.map((k) => html(k.name)).join(", ")}\n` : "Keine zusätzliche Hochkant-Zuordnung aktiv.\n") +
      "\nEine Formatänderung erzeugt eine neue Videovorschau. Ein vorhandenes Titelbild danach neu berechnen.\n" +
      "Das Vorschaubild des Videos bearbeitest du separat unter „Video-Titelbild“.",
    reply_markup: { inline_keyboard: zeilen },
  };
}

async function thumbnailMenue(a) {
  const kanaele = await gewaehlteKanaele(a);
  const t = a.thumbnail;
  const infos = kanaele.map((k) => {
    const z = thumbnailZiel(k, t, config.postiz.mastodonThumbnails);
    const profil = z.profil === "original" ? null : THUMBNAIL_PROFILE[z.profil];
    return `• ${html(k.name)}: ${z.hinweis ? html(z.hinweis) : "Eigenes Titelbild wird übertragen."}` + (profil ? ` (${profil.breite}×${profil.hoehe})` : "");
  });
  return {
    text: "<b>Video-Titelbild</b>\n" + (t ? `Quelle: ${{ text: "Nur Text", frame: "Bild aus dem Video", bild: "Hochgeladenes Foto" }[t.modus] ?? html(t.modus)}${t.frameMs != null ? ` bei ${t.frameMs / 1000} s` : ""}\n` +
      `Gestaltung: ${t.modus === "text" ? "Textgrafik" : !t.mitText ? "Bild ohne zusätzlichen Text" : t.vorlage === "grafik" ? "Textgrafik auf dem Bild" : "Foto mit Text"}\n` +
      `Zusätzliche Querdatei zum Download: ${t.quer ? "ja" : "nein"}\n` : "Noch kein eigenes Titelbild.\n") +
      "Foto mit Text: Hochkant bleibt das Foto vollflächig; im Querformat stehen Bild und Text nebeneinander. Titelbildtext und Beitragstext werden getrennt bearbeitet. Die zusätzliche Querdatei dient nur dem Download und ändert das Videoformat nicht.\n" + infos.join("\n") +
      "\nJPEG-Ausgaben: höchstens 2 MiB. Kanäle ohne Cover-Unterstützung erhalten kein zusätzliches Feedbild. Shorts-Cover werden für Studio exportiert.",
    reply_markup: { inline_keyboard: [
      [knopf("🎞️ Bild aus Video auswählen", a, "thumbframe")],
      [knopf("📝 Titelbild nur aus Text", a, "thumbgrafik")],
      [knopf("📷 Foto als Titelbild hochladen", a, "thumbbild")],
      ...(t ? [
        [knopf("✏️ Text im Titelbild ändern", a, "thumbtext")],
        [knopf("🔄 Titelbilder neu berechnen", a, "thumbneu")],
        [knopf(t.quer ? "🖥️ Zusätzliche Querdatei entfernen" : "🖥️ Querdatei zusätzlich erstellen", a, "thumbquer")],
        ...(t.modus !== "text" && t.mitText ? [[knopf(t.vorlage === "grafik" ? "🖼️ Zu Foto mit Text wechseln" : "📝 Zur Textgrafik wechseln", a, "thumbstil")]] : []),
        ...(t.modus !== "text" && t.mitText && t.vorlage !== "grafik" ? [[knopf("📍 Textposition im Hochkantbild", a, "thumbtextpos")]] : []),
        ...(kanaele.some((k) => k.identifier === "youtube") ? [[knopf(t.youtubeShort ? "YouTube: zu normalem Video wechseln" : "YouTube: zu Shorts-Export wechseln", a, "thumbshort")]] : []),
        [knopf("📎 Titelbilder herunterladen", a, "thumbexport")],
        [knopf("🗑️ Eigenes Titelbild entfernen", a, "thumboff")],
      ] : []),
      [knopf("↩️ Zur Vorschau", a, "zurueck")],
    ] },
  };
}

async function thumbnailBauen(a, optionen) {
  const kanaele = await gewaehlteKanaele(a);
  auftraege.aendern(a.id, { status: "arbeitet", wartetAuf: null, plan: null });
  await tg.senden(a.chatId, "🖼️ Erstelle die Titelbilder in den passenden Größen …");
  einreihen(async () => {
    try {
      const thumbnail = await thumbnailsErstellen({ ordner: a.ordner, video: coverVideo(a), quelle: a.original ?? coverVideo(a), layout: config.layout,
        optionen, kanaele, mastodonPatch: config.postiz.mastodonThumbnails, gesicht: config.gesicht });
      // Nur nach vollständigem Rendern übernehmen; eine misslungene Änderung lässt das bisherige Cover intakt.
      auftraege.aendern(a.id, { thumbnail });
      const gezeigt = new Set();
      const masse = await untersuche(coverVideo(a));
      for (const [key, bild] of Object.entries(thumbnail.dateien)) {
        const p = key === "original" ? originalProfil(masse) : THUMBNAIL_PROFILE[key];
        const groesse = `${p.breite}×${p.hoehe}`;
        if (gezeigt.has(groesse)) continue;
        gezeigt.add(groesse);
        await tg.fotos(a.chatId, [bild], `Titelbild – ${key} (${groesse})`);
      }
    } catch (e) {
      console.error(e);
      await tg.senden(a.chatId, `❌ Titelbild: ${html(e.message)}`);
    }
    const aktuell = auftraege.aendern(a.id, { status: "vorschau" });
    await neuesMenue(aktuell, await thumbnailMenue(aktuell));
  });
}

async function thumbnailPruefen(a, kanaele) {
  if (!a.thumbnail || a.nurStory || art(a) !== "video" || a.postiz?.post) return null;
  const t = a.thumbnail;
  try {
    if (JSON.stringify(await videoStand(coverVideo(a))) !== JSON.stringify(t.videoStand)) return "Das Video wurde geändert. Bitte unter Video-Titelbild → Titelbilder neu berechnen die Vorschau aktualisieren.";
    for (const k of kanaele) {
      const z = thumbnailZiel(k, t, config.postiz.mastodonThumbnails);
      if ((z.bild || z.zeit) && !t.dateien?.[z.profil]) return "Für die geänderte Kanalauswahl fehlt eine Covergröße. Bitte unter Video-Titelbild → Titelbilder neu berechnen ergänzen.";
      if (z.bild) {
        const profil = z.profil === "original" ? originalProfil(await untersuche(coverVideo(a))) : THUMBNAIL_PROFILE[z.profil];
        const stat = await fs.stat(t.dateien[z.profil]);
        if (stat.size > profil.maxBytes) return "Ein Cover überschreitet das Dateilimit. Bitte neu erzeugen.";
      }
    }
  } catch { return "Eine Titelbild-Datei fehlt. Bitte unter Video-Titelbild → Titelbilder neu berechnen aktualisieren."; }
  return null;
}

function fortsetzenMenue(a) {
  const bestaetigt = Object.entries(a.postiz ?? {}).filter(([, ids]) => ids.length)
    .map(([teil, ids]) => `${teil === "post" ? "Feed" : "Story"}: ${ids.map((p) => p.postId).join(", ")}`);
  const unklar = a.postizUnklar;
  return {
    text: ["<b>Veröffentlichung fortsetzen</b>", ...bestaetigt.map(html),
      unklar ? `⚠️ Für ${unklar === "post" ? "Feed" : "Story"} fehlt eine sichere Bestätigung. Bitte zuerst im Postiz-Kalender prüfen. Keine automatische Wiederholung.`
        : "Bereits bestätigte Beiträge werden übersprungen. Inhalt und Kanalauswahl bleiben bis zum Abschluss gesperrt.",
      a.plan?.typ === "schedule" ? `Ursprünglicher Termin: ${html(zeitText(new Date(a.plan.zeit)))}` : "Veröffentlichung: sofort",
    ].join("\n"),
    reply_markup: { inline_keyboard: [[knopf(unklar ? "🔎 In Postiz prüfen" : "▶️ Fehlende Teile erneut versuchen", a, unklar ? "pruefen" : "weiter")]] },
  };
}

async function entwuerfeMenue(chatId, archiviert = false, seite = 0) {
  const alle = auftraege.liste(chatId, archiviert);
  const max = Math.max(0, Math.ceil(alle.length / 8) - 1);
  seite = Math.max(0, Math.min(Number(seite) || 0, max));
  const liste = alle.slice(seite * 8, seite * 8 + 8);
  const zeilen = liste.map((a) => [{
    text: `${a.postizUnklar || a.postiz ? "⚠️" : "📝"} ${String(a.caption || a.grafikQuelleText || a.id).replace(/\s+/g, " ").slice(0, 45)} · ${a.id}`,
    callback_data: `d:${archiviert ? "wieder" : "open"}:${a.id}`,
  }]);
  const navigation = [];
  if (seite > 0) navigation.push({ text: "←", callback_data: `d:list:${Number(archiviert)}:${seite - 1}` });
  if (seite < max) navigation.push({ text: "→", callback_data: `d:list:${Number(archiviert)}:${seite + 1}` });
  if (navigation.length) zeilen.push(navigation);
  zeilen.push([{ text: archiviert ? "📝 Aktive Entwürfe" : "🗃️ Archiv", callback_data: `d:list:${Number(!archiviert)}:0` }]);
  return tg.senden(chatId, `<b>${archiviert ? "Archiv" : "Entwürfe"}</b> – ${alle.length} gespeichert, Seite ${seite + 1}/${max + 1}.\n` +
    (archiviert ? "Antippen stellt den vollständigen Entwurf wieder her." : "Antippen öffnet den gespeicherten Stand mit Medien, Kunde und Kanälen."),
  { reply_markup: { inline_keyboard: zeilen } });
}

async function entwurfsKnopf(cq) {
  const [, aktion, id, seite] = cq.data.split(":");
  const chatId = cq.message.chat.id;
  const antwort = (text) => tg.aufruf("answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {});
  if (aktion === "list") {
    await antwort();
    return entwuerfeMenue(chatId, id === "1", seite);
  }
  let a = auftraege.get(id);
  if (!a || a.chatId !== chatId || a.status !== "vorschau") return antwort("Entwurf nicht verfügbar.");
  if (aktion === "wieder" && a.archiviert) a = auftraege.archivieren(id, false);
  else if (aktion !== "open" || a.archiviert) return antwort("Bitte die aktuelle Entwurfsliste öffnen.");
  a = auftraege.oeffnen(id);
  await antwort("Entwurf geöffnet");
  if (!a.postiz && !a.postizUnklar && art(a) !== "text") {
    try {
      const medien = a.nurStory && a.storyDatei ? [a.storyDatei] : a.medien ?? [];
      if (art(a) === "foto" && medien.length) await tg.fotos(chatId, medien, "Gespeicherter Entwurf – Vorschau");
      else if (medien.length) {
        let video = medien[0];
        if (!tg.lokal && (await fs.stat(video)).size > 49 * MB) {
          // Nur die zur aktuellen Datei gehörende Vorschau verwenden.
          const klein = datei(a, "vorschau.mp4");
          const [original, vorschauStand] = await Promise.all([fs.stat(video), fs.stat(klein)]);
          if (vorschauStand.mtimeMs < original.mtimeMs) throw new Error("Bitte die große Videovorschau im bisherigen Chat prüfen.");
          video = klein;
        }
        await tg.datei(chatId, "sendVideo", "video", video, { caption: "Gespeicherter Entwurf – Vorschau", supports_streaming: "true" });
      }
    } catch (e) {
      await tg.senden(chatId, `⚠️ Gespeicherte Medienvorschau nicht verfügbar: ${html(e.message.slice(0, 200))}`);
    }
  }
  return neuesMenue(a);
}

function quellenInhalt(a) {
  const passage = a.antragVarianten?.[a.antragIndex ?? 0];
  const zeilen = quellenZeilen(a.quellenkarte, passage);
  return {
    text: "<b>Quelle und Verfahrensstand</b>\n" + (zeilen.length ? zeilen.map(html).join("\n") : "Noch keine Quelle hinterlegt.") +
      (passage ? `\n\nOriginalauszug:\n<blockquote>${html(passage.text)}</blockquote>` : "") +
      "\n\nDer Stand wird manuell belegt; der Bot prüft keine Beschlüsse. Die Quellenkarte wird nicht automatisch in Caption oder Grafik übernommen.",
    reply_markup: { inline_keyboard: [[knopf("✏️ Quelle bearbeiten", a, "quelltext"), knopf("↩️ Zur Vorschau", a, "zurueck")]] },
  };
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
  zeilen.push([knopf("↩️ Zur Vorschau", auftrag, "zurueck")]);
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
  const unten = [knopf("↩️ Zur Vorschau", auftrag, "zurueck")];
  if (kundenAus(alle).length) unten.unshift(knopf("👤 Kunde wechseln", auftrag, "kunde"));
  zeilen.push(unten);
  const titel = auftrag.nurStory ? "<b>Story-Kanäle (Instagram/Facebook)</b>" : kunde ? `<b>Kanäle von ${html(kunde.name)}</b>` : "<b>Auf welchen Kanälen posten?</b>";
  await zeigeMenue(auftrag, { text: titel, reply_markup: { inline_keyboard: zeilen } });
}

async function kundeMenue(auftrag) {
  const kunden = kundenAus(await alleKanaele());
  const zeilen = kunden.map((k, i) => [knopf(`${auftrag.kunde === k.id ? "🔘" : "⚪"} ${k.name}`, auftrag, `ku:${i}`)]);
  zeilen.push([knopf(`${auftrag.kunde ? "⚪" : "🔘"} Alle Kanäle`, auftrag, "ku:alle")]);
  zeilen.push([knopf("↩️ Zur Vorschau", auftrag, "zurueck")]);
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
  zeilen.push([knopf("↩️ Zur Vorschau", auftrag, "zurueck")]);
  await zeigeMenue(auftrag, {
    text: "<b>Welche Konten sollen den Beitrag reposten?</b>\nGeht bei Postiz nur auf X und LinkedIn: Die gewählten Konten teilen den Beitrag, nachdem er erschienen ist. Ein Konto repostet sich nicht selbst.",
    reply_markup: { inline_keyboard: zeilen },
  });
}

async function bestaetigung(auftrag, typ, zeit) {
  const kanaele = await gewaehlteKanaele(auftrag);
  const coverFehler = await thumbnailPruefen(auftrag, kanaele);
  if (coverFehler) return { fehler: coverFehler };
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
  if (zuLang.length) return { fehler: `Zu lang für ${zuLang.map((l) => `${l.kanal.name} (${zahlText(l)})`).join(", ")} – bitte unter „✂️ Text je Kanal“ anpassen.` };
  const eigen = liste.filter((l) => l.eigen).map((l) => html(l.kanal.name));
  const limit = limitFehler(auftrag, kanaele);
  if (limit) return { fehler: limit };
  auftraege.aendern(auftrag.id, { plan: { typ, zeit: zeit.toISOString() } });
  const wann = typ === "now" ? "<b>jetzt</b>" : `am <b>${zeitText(zeit)}</b>`;
  return {
    text: [
      `Wirklich ${wann} ${auftrag.nurStory ? "nur die Story" : "den Beitrag"} auf ${kanaele.map((k) => `<b>${html(k.name)}</b>`).join(", ")} posten?`,
      ...details(auftrag, await alleKanaele()),
      ...(auftrag.thumbnail && !auftrag.nurStory && art(auftrag) === "video" ? kanaele.map((k) => {
        const z = thumbnailZiel(k, auftrag.thumbnail, config.postiz.mastodonThumbnails);
        return z.hinweis ? `🖼️ ${html(k.name)}: ${html(z.hinweis)}` : `🖼️ ${html(k.name)}: eigenes Titelbild`;
      }) : []),
      ...(eigen.length ? [`✂️ Eigene Fassung für ${eigen.join(", ")} (über „Weiter bearbeiten → Text je Kanal“ ansehen)`] : []),
      ...(!auftrag.nurStory ? [`<blockquote expandable>${html(auftrag.caption)}</blockquote>`] : []),
    ].join("\n"),
    reply_markup: { inline_keyboard: [[knopf(typ === "now" ? "✅ Jetzt veröffentlichen" : "✅ Termin bestätigen", auftrag, "ja")], [knopf("✏️ Weiter bearbeiten", auftrag, "zurueck")]] },
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

    // Gesichtsdaten auch bei Querformat sichern: die 9:16-Fassung kann damit das Logo
    // am Gesicht vorbeisetzen. Für Untertitel bleibt die bisherige Hochkant-Logik.
    await schritt(auftrag, "🙂 Prüfe die Gesichtsposition …");
    const funde = await gesichtSuchen(original, config.gesicht);
    const zuverlaessig = funde?.gesichter?.length >= Math.max(2, funde.bilder * 0.4);
    auftrag = auftraege.aendern(id, { gesichter: zuverlaessig ? funde.gesichter : [] });
    if (masse.hoehe > masse.breite && funde) {
      const wahl = lageWaehlen(funde, { masse, layout: config.layout });
      auftrag = auftraege.aendern(id, {
        untertitelLage: wahl.lage === "unten" ? null : wahl.lage,
        lageAutomatisch: wahl.lage !== "unten", gesichtHinweise: wahl.hinweise,
      });
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

    await schritt(auftrag, "✍️ Schreibe Beitragstext-Vorschlag …");
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
  if (auftrag.grafikStoryDatei) return true;
  if (art(auftrag) === "video") return querAn(auftrag) || !istStoryFormat(auftrag.masse);
  return art(auftrag) === "foto";
}

/** Querformat-Video, das sich für Instagram/TikTok in 9:16 umbauen lässt? */
const querAn = (a) => art(a) === "video" && Boolean(a.quer) && a.masse?.hoehe > a.masse?.breite;
const feedMasse = (a) => querAn(a) ? { ...a.masse, breite: 1920, hoehe: 1080 } : a.masse;
const hochkantMoeglich = (auftrag) => art(auftrag) === "video" && Boolean(auftrag.masse) && (querAn(auftrag) || !istStoryFormat(auftrag.masse));
const hochkantAn = (auftrag) => !auftrag.nurStory && Boolean(auftrag.hochkant) && hochkantMoeglich(auftrag);

/**
 * Baut die eigene 9:16-Fassung im selben Layout wie den Beitrag – für die Story und, bei Videos,
 * für Instagram/TikTok („📲 9:16“); null, wenn keine nötig ist.
 */
async function storyFassung(auftrag) {
  if (!(auftrag.story || hochkantAn(auftrag)) || !(await storyNoetig(auftrag))) return null;
  if (auftrag.grafikStoryDatei) return auftrag.grafikStoryDatei;
  if (art(auftrag) === "foto") {
    // Kein Feed-Bild verwenden: sonst sitzt das Logo bereits im Motiv und wird mitgeblurrt.
    const ziel = datei(auftrag, "story.jpg");
    const meta = await storyFoto({
      eingabe: auftrag.originale?.[0] ?? auftrag.medien[0], ausgabe: ziel,
      layout: config.layout, mitLogo: auftrag.mitLogo,
      logoPosition: auftrag.storyLogoPosition ?? "auto",
    });
    if (!auftrag.storyText?.trim()) return ziel;
    // Auch bei einzelnen Fotos die bereits vorhandene lokale OpenCV-Suche nutzen.
    // Fällt sie aus oder findet nichts, bleibt die bisherige Textposition erhalten.
    const funde = await gesichtSuchen(auftrag.originale?.[0] ?? auftrag.medien[0], config.gesicht, 1);
    const gesichter = (funde?.gesichter ?? []).map((g) => ({
      x: (meta.bild.links + g.x * meta.bild.breite) / STORY_MASSE.breite,
      y: (meta.bild.oben + g.y * meta.bild.hoehe) / STORY_MASSE.hoehe,
      w: (g.w * meta.bild.breite) / STORY_MASSE.breite,
      h: (g.h * meta.bild.hoehe) / STORY_MASSE.hoehe,
    }));
    const mitText = datei(auftrag, "story-text.jpg");
    await storyFotoText({
      eingabe: ziel, ausgabe: mitText, text: auftrag.storyText,
      layout: { ...config.layout, bild: meta.bild, logoBereich: meta.logoBereich, gesichter, storyTextPosition: auftrag.storyTextPosition },
    });
    return mitText;
  }
  // Ein vorhandenes 9:16-Video behält beim zusätzlichen Querformat sein normales Layout,
  // einschließlich Logo-Variante und Untertitelposition. Kein Story-Logo-Wechsel.
  const nativ = querAn(auftrag) && istStoryFormat(auftrag.masse);
  const masse = nativ ? auftrag.masse : { ...STORY_MASSE, dauer: auftrag.masse.dauer };
  const layout = nativ ? layoutFuer(auftrag) : storyLayout(layoutFuer(auftrag), auftrag.masse, masse);
  const cues = parseSrt(await fs.readFile(datei(auftrag, "untertitel.srt"), "utf8"));
  let ass = null;
  if (cues.length) {
    ass = datei(auftrag, "story.ass");
    await fs.writeFile(ass, zuAss(cues, { ...masse, ...layout }));
  }
  const ziel = datei(auftrag, "story.mp4");
  await rendern({
    eingabe: auftrag.original, ausgabe: ziel, ass, masse, layout, video: config.video,
    bauchbinde: auftrag.bauchbinde, story: !nativ,
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
    if (auftrag.storyText?.trim() || (querAn(auftrag) && hochkantAn(auftrag))) throw e;
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
  const vorschauMasse = querAn(auftrag) && istStoryFormat(auftrag.masse) ? auftrag.masse : STORY_MASSE;
  await tg.datei(auftrag.chatId, "sendVideo", "video", senden, {
    caption: `9:16-Fassung für ${wofuer}`, supports_streaming: "true",
    width: String(vorschauMasse.breite), height: String(vorschauMasse.hoehe),
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
    const masse = feedMasse(auftrag);
    const layout = querAn(auftrag)
      ? querLayout(layoutFuer(auftrag), auftrag.masse, masse, { lageAutomatisch: auftrag.lageAutomatisch })
      : layoutFuer(auftrag);
    const cues = parseSrt(await fs.readFile(datei(auftrag, "untertitel.srt"), "utf8"));
    let ass = null;
    if (cues.length) {
      ass = datei(auftrag, "untertitel.ass");
      await fs.writeFile(ass, zuAss(cues, { ...masse, ...layout }));
    }
    const fertig = datei(auftrag, "fertig.mp4");
    await rendern({
      eingabe: auftrag.original, ausgabe: fertig, ass, masse, layout, video: config.video,
      bauchbinde: auftrag.bauchbinde, quer: querAn(auftrag),
    });
    auftraege.aendern(id, { medien: [fertig], hochgeladen: null, videoFormatFehler: false }); // neues Video → neu hochladen

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
      width: String(masse.breite),
      height: String(masse.hoehe),
    });
    auftrag = await storyAktualisieren(auftrag);
    await tg.aufruf("deleteMessage", { chat_id: auftrag.chatId, message_id: auftrag.statusNachricht }).catch(() => {});
    auftrag = auftraege.aendern(id, { status: "vorschau", statusNachricht: null, transkript: volltext(cues) });
    await neuesMenue(auftrag);
  } catch (e) {
    console.error(e);
    auftraege.aendern(id, { status: auftrag.menueNachricht ? "vorschau" : "fehler", statusNachricht: null, videoFormatFehler: true });
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
      await schritt(auftrag, "✍️ Schreibe Beitragstext-Vorschlag …");
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

async function textBeitrag(chatId, text, zusaetze = {}) {
  let auftrag = auftraege.neu(chatId);
  auftrag = auftraege.aendern(auftrag.id, {
    art: "text", notizen: text, caption: text.trim(), captionQuelle: "eigene",
    medien: [], status: "vorschau", ...zusaetze,
  });
  await neuesMenue(auftrag);
}

/** Bestehenden Textauftrag in eine echte Postiz-Bild- oder Storyveröffentlichung umwandeln. */
async function textZuGrafik(auftrag, format = "post", quelle = null) {
  const text = grafikText(auftrag, quelle);
  const vorlage = await textGrafiken({
    ordner: auftrag.ordner, text, layout: config.layout,
    ausAntrag: Boolean(auftrag.antragVarianten?.length),
  });
  const story = format === "story";
  auftrag = auftraege.aendern(auftrag.id, {
    art: "foto", grafikModus: format, grafikAnimation: false, grafikQuelleText: text,
    grafikStoryDatei: vorlage.story, medien: [vorlage.post], originale: [vorlage.post],
    storyDatei: vorlage.story, storyHochgeladen: null,
    mitLogo: false, hochgeladen: null, captions: {},
    story, nurStory: story, kanaele: null, status: "vorschau",
  });
  await tg.fotos(auftrag.chatId, [story ? vorlage.story : vorlage.post],
    story ? "Storygrafik – Vorschau" : "Sharepic – Vorschau");
  if (vorlage.gekuerzt) await tg.senden(auftrag.chatId,
    "ℹ️ Der Text wurde für die Grafik gekürzt. Bitte die Vorschau prüfen und gegebenenfalls „✏️ Grafiktext“ nutzen.");
  return auftrag;
}

function antragMenue(auftrag) {
  const zeilen = auftrag.antragVarianten.map((v, i) =>
    [knopf(`${i === (auftrag.antragIndex ?? 0) ? "🔘" : "⚪"} ${v.titel.slice(0, 48)}`, auftrag, `av:${i}`)]);
  zeilen.push([knopf("↩️ Zur Vorschau", auftrag, "zurueck")]);
  return {
    text: "<b>Textstellen aus deinem Antrag</b>\nKeine KI-Zusammenfassung: Die Texte werden aus dem PDF übernommen, längere Stellen mit […] gekennzeichnet. Bitte den Wortlaut und den Kontext prüfen.",
    reply_markup: { inline_keyboard: zeilen },
  };
}

async function veroeffentlichen(auftrag) {
  if (auftrag.status !== "vorschau" || !auftrag.plan) return;
  if (auftrag.postizUnklar) return neuesMenue(auftrag);
  auftrag = auftraege.aendern(auftrag.id, { status: "postet" });
  const { typ } = auftrag.plan;
  const zeit = typ === "now" ? new Date() : new Date(auftrag.plan.zeit);
  try {
    const kanaele = auftrag.sendeKanaele ?? await gewaehlteKanaele(auftrag);
    if (!auftrag.sendeKanaele) auftrag = auftraege.aendern(auftrag.id, { sendeKanaele: kanaele });
    const postizKanaele = kanaele.filter((k) => k.id !== DIREKT);
    const direkt = kanaele.find((k) => k.id === DIREKT);
    const medien = auftrag.medien ?? [datei(auftrag, "fertig.mp4")];
    const hinweise = [];

    if (postizKanaele.length && !auftrag.postizFertig) {
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
      const thumbnails = {};
      if (auftrag.thumbnail && !auftrag.nurStory && art(auftrag) === "video" && !auftrag.postiz?.post) {
        const fehler = await thumbnailPruefen(auftrag, postizKanaele);
        if (fehler) throw new Error(fehler);
        for (const k of postizKanaele) {
          const z = thumbnailZiel(k, auftrag.thumbnail, config.postiz.mastodonThumbnails);
          if (!z.bild) continue;
          if (!auftrag.thumbnail.hochgeladen[z.profil]) {
            const upload = await postiz.hochladen(auftrag.thumbnail.dateien[z.profil]);
            auftrag = auftraege.aendern(auftrag.id, { thumbnail: { ...auftrag.thumbnail,
              hochgeladen: { ...auftrag.thumbnail.hochgeladen, [z.profil]: upload } } });
          }
          thumbnails[k.id] = auftrag.thumbnail.hochgeladen[z.profil];
        }
      }
      const ergebnis = await postiz.beitrag({
        typ, zeit, caption: auftrag.caption, captions: auftrag.captions, medien: auftrag.hochgeladen ?? [], kanaele: postizKanaele,
        collabs: art(auftrag) === "text" || auftrag.nurStory ? [] : auftrag.collabs,
        repost: auftrag.nurStory ? null : auftrag.repost, story, nurStory: Boolean(auftrag.nurStory),
        storyMedium: story && auftrag.storyDatei ? auftrag.storyHochgeladen : null,
        hochkantMedium: hochkant && auftrag.storyDatei ? auftrag.storyHochgeladen : null, hochkantNetze: config.hochkant.netze,
        fortschritt: auftrag.postiz ?? {},
        vorAnlegen: async (teil) => { auftrag = auftraege.aendern(auftrag.id, { postizUnklar: teil }); },
        nachAnlegen: async (stand) => { auftrag = auftraege.aendern(auftrag.id, { postiz: stand, postizUnklar: null }); },
        beiAblehnung: async () => { auftrag = auftraege.aendern(auftrag.id, { postizUnklar: null }); },
        thumbnails, thumbnailTimestamp: art(auftrag) === "video" && !auftrag.nurStory && auftrag.thumbnail?.modus === "frame" ? auftrag.thumbnail.frameMs : null,
        mastodonThumbnails: config.postiz.mastodonThumbnails,
      });
      auftrag = auftraege.aendern(auftrag.id, { postiz: ergebnis, postizFertig: true });
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
    const namen = kanaele.filter((k) => k.id !== DIREKT || auftrag.mastodon)
      .map((k) => `${html(k.name)} (${html(k.identifier === DIREKT ? "Mastodon" : k.identifier)})`).join(", ");
    const text = typ === "now"
      ? `✅ <b>Wird jetzt ${auftrag.nurStory ? "als Story" : "gepostet"}</b> auf ${namen}.`
      : `📅 <b>${auftrag.nurStory ? "Story geplant" : "Geplant"} für ${zeitText(zeit)}</b> auf ${namen}.\nÄndern oder löschen kannst du den Eintrag im Postiz-Kalender${auftrag.mastodon ? " (Mastodon: in den geplanten Beiträgen dort)" : ""}.`;
    const kontrolle = postizKanaele.length ? "\nPostiz hat den Auftrag angenommen. Etwa 15 Minuten nach dem Termin prüfe ich den Veröffentlichungsstatus und melde Erfolg oder Probleme." : "";
    await zeigeMenue(auftrag, {
      text: `${text}${kontrolle}${auftrag.nurStory ? "" : `\n<blockquote expandable>${html(auftrag.caption)}</blockquote>`}`,
      reply_markup: { inline_keyboard: [] },
    });
    if (hinweise.length) await tg.senden(auftrag.chatId, html(hinweise.join("\n")));
  } catch (e) {
    console.error(e);
    auftrag = auftraege.aendern(auftrag.id, { status: "vorschau",
      ...(!auftrag.postiz && !auftrag.postizUnklar && !auftrag.mastodon ? { sendeKanaele: null } : {}),
    });
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
  if (auftrag.chatId !== cq.message?.chat.id) return antwort("Dieser Auftrag gehört zu einem anderen Chat.", true);
  if (auftrag.archiviert) return antwort("Bitte zuerst über /archiv wiederherstellen.", true);
  if (auftrag.status !== "vorschau") return antwort(`Nicht mehr änderbar (Status: ${auftrag.status}).`, true);
  if (aktion.startsWith("thumb") && (art(auftrag) !== "video" || auftrag.nurStory)) return antwort("Titelbilder sind nur für Feed-Videos vorgesehen.", true);
  if ((auftrag.postiz || auftrag.postizUnklar || auftrag.mastodon) && !["weiter", "pruefen", "nichtangelegt", "geprueft"].includes(aktion)) {
    await zeigeMenue(auftrag, fortsetzenMenue(auftrag));
    return antwort("Die Veröffentlichung wurde bereits begonnen.", true);
  }
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
    case "videoformat":
      if (art(auftrag) !== "video" || auftrag.nurStory || auftrag.grafikAnimation) return antwort("Videoformate sind hier nicht verfügbar.", true);
      await zeigeMenue(auftrag, await videoFormatMenue(auftrag));
      return antwort();
    case "thumb":
      if (art(auftrag) !== "video" || auftrag.nurStory) return antwort("Titelbilder sind für Feed-Videos vorgesehen.", true);
      await zeigeMenue(auftrag, await thumbnailMenue(auftrag));
      return antwort();
    case "thumbframe": {
      if (art(auftrag) !== "video") return antwort("Bitte zuerst ein Video auswählen.", true);
      const masse = await untersuche(coverVideo(auftrag));
      auftraege.aendern(id, { wartetAuf: "thumbnailFrame" });
      await antwort();
      return tg.senden(auftrag.chatId, `Zeit innerhalb des fertigen Videos schicken: Sekunden oder MM:SS, z. B. 3.5. Videolänge: ${masse.dauer.toFixed(1)} s. Mit „Text im Titelbild ändern“ kannst du danach eine Überschrift ergänzen.`);
    }
    case "thumbgrafik":
    case "thumbtext":
      auftraege.aendern(id, { wartetAuf: "thumbnailText", thumbnailTextModus: aktion === "thumbgrafik" ? "text" : null });
      await antwort();
      return tg.senden(auftrag.chatId, "Covertext schicken: erste Zeile Überschrift (max. 70 Zeichen), optional zweite Zeile Erklärung (max. 60). Der Text ist unabhängig von der Caption.\nVorschlag:\n<pre>" + html(auftrag.thumbnail?.text ?? kurzerTitel(grafikText(auftrag) ?? auftrag.caption, 60)) + "</pre>");
    case "thumbbild":
      auftraege.aendern(id, { wartetAuf: "thumbnailBild" });
      await antwort();
      return tg.senden(auftrag.chatId, "Schick ein JPG oder PNG als Foto oder Datei (max. 12 MB). Es wird als Titelbild verwendet, kein neuer Foto-Beitrag. Mit „Text im Titelbild ändern“ kannst du danach Text ergänzen.");
    case "thumbneu":
    case "thumbshort":
    case "thumbquer":
    case "thumbstil":
      if (!auftrag.thumbnail) return antwort("Bitte zuerst ein Titelbild auswählen.");
      await antwort();
      return thumbnailBauen(auftrag, { ...auftrag.thumbnail,
        quer: aktion === "thumbquer" ? !auftrag.thumbnail.quer : auftrag.thumbnail.quer,
        vorlage: aktion === "thumbstil" ? (auftrag.thumbnail.vorlage === "grafik" ? "foto" : "grafik") : auftrag.thumbnail.vorlage,
        youtubeShort: aktion === "thumbshort" ? !auftrag.thumbnail.youtubeShort : auftrag.thumbnail.youtubeShort });
    case "thumbtextpos": {
      if (!auftrag.thumbnail || auftrag.thumbnail.modus === "text") return antwort("Bitte zuerst ein Foto- oder Frame-Titelbild auswählen.");
      if (!arg) {
        await zeigeMenue(auftrag, {
          text: "<b>Textposition im Hochkant-Titelbild</b>\nAutomatisch nutzt die lokale Gesichtserkennung, soweit verfügbar; ohne Treffer sitzt der Text unten. Oben/Unten legt die bevorzugte Position fest. Das Foto bleibt vollflächig. Quercover behalten ihre getrennte Bild- und Textfläche.",
          reply_markup: { inline_keyboard: [
            ...[["auto", "Automatisch"], ["oben", "Text oben"], ["unten", "Text unten"]].map(([wert, name]) =>
              [knopf(`${(auftrag.thumbnail.textPosition ?? "auto") === wert ? "🔘" : "⚪"} ${name}`, auftrag, `thumbtextpos:${wert}`)]),
            [knopf("↩️ Zum Titelbild-Menü", auftrag, "thumb")],
          ] },
        });
        return antwort();
      }
      if (!["auto", "oben", "unten"].includes(arg)) return antwort("Ungültige Textposition.", true);
      await antwort();
      return thumbnailBauen(auftrag, { ...auftrag.thumbnail, textPosition: arg });
    }
    case "thumboff":
      auftraege.aendern(id, { thumbnail: null, plan: null });
      await zeigeMenue(auftrag);
      return antwort("Titelbild entfernt");
    case "thumbexport":
      if (!auftrag.thumbnail?.dateien) return antwort("Noch keine Cover vorhanden.");
      await antwort();
      {
        const gezeigt = new Set();
        for (const [key, bild] of Object.entries(auftrag.thumbnail.dateien)) {
          const m = await untersuche(bild);
          const groesse = `${m.breite}×${m.hoehe}`;
          if (gezeigt.has(groesse)) continue;
          gezeigt.add(groesse);
          await tg.datei(auftrag.chatId, "sendDocument", "document", bild, { caption: `Cover – ${key} (${groesse})` });
        }
      }
      return;
    case "weiter":
      await antwort("Setze die fehlenden Teile fort …");
      return veroeffentlichen(auftrag);
    case "pruefen":
      await antwort();
      await zeigeMenue(auftrag, {
        text: "Bitte im Postiz-Kalender den unklaren Teil prüfen. Falls vorhanden, dort fertigstellen und hier abschließen. Nur wenn der unklare Teil sicher NICHT angelegt wurde, darf er erneut angelegt werden.",
        reply_markup: { inline_keyboard: [[knopf("Ist vorhanden / extern erledigt", auftrag, "geprueft")],
          [knopf("Unklarer Teil fehlt sicher", auftrag, "nichtangelegt")]] },
      });
      return;
    case "nichtangelegt":
      if (!auftrag.postizUnklar) return antwort("Keine unklare Anfrage vorhanden.", true);
      auftrag = auftraege.aendern(id, { postizUnklar: null });
      await zeigeMenue(auftrag, fortsetzenMenue(auftrag));
      return antwort("Prüfung bestätigt. Fehlenden Teil jetzt bewusst erneut versuchen.");
    case "geprueft":
      if (!auftrag.postizUnklar) return antwort("Keine unklare Anfrage vorhanden.", true);
      auftraege.aendern(id, { status: "extern", wartetAuf: null, externErledigt: new Date().toISOString() });
      await zeigeMenue(auftrag, { text: "Extern abgeschlossen. Es wird nichts erneut angelegt. Für den unklaren Teil gibt es ohne Post-ID keine automatische Veröffentlichungskontrolle; bitte Feed und Story in Postiz prüfen.", reply_markup: { inline_keyboard: [] } });
      return antwort("Abgeschlossen");
    case "archiv":
      auftraege.archivieren(id);
      await zeigeMenue(auftrag, { text: "🗃️ Vollständiger Entwurf archiviert. Mit /archiv wiederherstellen.", reply_markup: { inline_keyboard: [] } });
      return antwort("Archiviert");
    case "undo": {
      const a = auftraege.rueckgaengig(id);
      if (!a) return antwort("Keine frühere Textfassung vorhanden.");
      await neuesMenue(a);
      return antwort("Beitragstext, Kanaltexte und Quelle zurückgesetzt. Bildtext und gerenderte Medien bleiben separat.", true);
    }
    case "quelle":
      await zeigeMenue(auftrag, quellenInhalt(auftrag));
      return antwort();
    case "quelltext":
      auftraege.aendern(id, { wartetAuf: "quelle" });
      await antwort();
      await tg.senden(auftrag.chatId, "Bitte diese Vorlage bearbeiten und zurückschicken. Datum als JJJJ-MM-TT, - leert ein Feld. Ein bestätigter Stand braucht Standdatum und Beleg. Wiedervorlage speichert nur eine Notiz.");
      return tg.senden(auftrag.chatId, `<pre>${html(quellenVorlage(auftrag.quellenkarte))}</pre>`);
    case "idee": {
      const gespeichert = ideen.speichern(auftrag.chatId, grafikText(auftrag) ?? "",
        auftrag.antragVarianten?.length ? "antrag" : "entwurf");
      return antwort(`Idee gespeichert (${gespeichert.id}).`);
    }
    case "antragmenu": {
      if (!auftrag.antragVarianten?.length) return antwort("Kein Antrag bei diesem Entwurf.", true);
      await zeigeMenue(auftrag, antragMenue(auftrag));
      return antwort();
    }
    case "av": {
      const index = Number(arg);
      if (!Number.isInteger(index) || !auftrag.antragVarianten?.[index]) return antwort("Unbekannte Textstelle.", true);
      const v = auftrag.antragVarianten[index];
      // Auf eine neue, überprüfbare Dokumentpassage zurückgehen, nicht blind ein altes Sharepic behalten.
      auftrag = auftraege.aendern(id, {
        art: "text", grafikModus: null, grafikStoryDatei: null, grafikQuelleText: null,
        medien: [], story: false, nurStory: false, storyDatei: null, storyHochgeladen: null,
        hochgeladen: null, caption: v.text, notizen: v.text, captionQuelle: "dokument",
        antragIndex: index, kanaele: null, captions: {},
      });
      await neuesMenue(auftrag);
      return antwort("Originaltext aus PDF gewählt. Bitte prüfen.");
    }
    case "anim": {
      if (!["post", "story"].includes(arg)) return antwort("Ungültiges Animationsformat.", true);
      await antwort("Erstelle MP4-Animation lokal …");
      auftrag = auftraege.aendern(id, { status: "arbeitet" });
      einreihen(async () => {
        try {
          let a = auftraege.get(id);
          const text = grafikText(a);
          const story = arg === "story";
          const ausgabe = datei(a, `redaktion-animation-${arg}.mp4`);
          await textAnimation({
            ausgabe, inhalt: (await import("./redaktion.mjs")).grafikInhalt(text, { ausAntrag: Boolean(a.antragVarianten?.length) }),
            layout: config.layout, format: arg,
          });
          a = auftraege.aendern(id, {
            art: "video", grafikAnimation: true, grafikModus: arg,
            grafikQuelleText: text, medien: [ausgabe], originale: [ausgabe],
            masse: { breite: 1080, hoehe: story ? 1920 : 1350, dauer: 5, hatTon: false },
            story, nurStory: story, storyDatei: null, grafikStoryDatei: null,
            hochgeladen: null, storyHochgeladen: null, captions: {}, kanaele: null,
            status: "vorschau",
          });
          await tg.datei(a.chatId, "sendVideo", "video", ausgabe, { caption: "🎞️ Animierte Textgrafik – Vorschau" });
          await neuesMenue(a);
        } catch (e) {
          console.error(e);
          await tg.senden(auftrag.chatId, `❌ Animation fehlgeschlagen: <pre>${html(e.message)}</pre>`);
          await neuesMenue(auftraege.aendern(id, { status: "vorschau" }));
        }
      });
      return;
    }
    case "grafik": {
      if (!["post", "story", "text"].includes(arg)) return antwort("Ungültiges Format.", true);
      if (arg === "text") {
        auftrag = auftraege.aendern(id, {
          art: "text", grafikModus: null, grafikAnimation: false, medien: [], originale: null,
          grafikStoryDatei: null, story: false, nurStory: false, storyDatei: null,
          storyHochgeladen: null, hochgeladen: null, kanaele: null, captions: {},
        });
        await neuesMenue(auftrag);
        return antwort("Wieder Textbeitrag.");
      }
      await antwort("Erstelle Grafik lokal …");
      auftrag = auftraege.aendern(id, { status: "arbeitet" });
      einreihen(async () => {
        try {
          const aktualisiert = await textZuGrafik(auftraege.get(id), arg);
          await neuesMenue(aktualisiert);
        } catch (e) {
          console.error(e);
          await tg.senden(auftrag.chatId, `❌ Grafik fehlgeschlagen: <pre>${html(e.message)}</pre>`);
          await neuesMenue(auftraege.aendern(id, { status: "vorschau" }));
        }
      });
      return;
    }
    case "grafiktext": {
      if (!auftrag.grafikModus) return antwort("Nur für Textgrafiken.", true);
      auftraege.aendern(id, { wartetAuf: "grafiktext" });
      await tg.senden(auftrag.chatId,
        "Schick mir den Text für die Grafik. Erste Zeile ist die Überschrift, weitere Zeilen sind der Erklärungstext. Bitte Aussagen aus Anträgen nur im belegten Wortlaut übernehmen.");
      return antwort();
    }
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
    case "slmenu":
      await zeigeMenue(auftrag, storyLayoutMenue(auftrag));
      return antwort();
    case "sl":
    case "stp": {
      if (art(auftrag) !== "foto" || !auftrag.story) return antwort("Nur für Fotostorys verfügbar.", true);
      if (aktion === "sl" && !STORY_LOGO_LAGEN.some(([wert]) => wert === arg)) return antwort("Ungültige Logoposition.", true);
      if (aktion === "stp" && !["auto", "oben", "mitte", "unten"].includes(arg)) return antwort("Ungültige Textposition.", true);
      const feld = aktion === "sl" ? "storyLogoPosition" : "storyTextPosition";
      if ((auftrag[feld] ?? "auto") === arg) {
        await zeigeMenue(auftrag, storyLayoutMenue(auftrag));
        return antwort("Bleibt unverändert.");
      }
      auftrag = auftraege.aendern(id, { [feld]: arg, status: "arbeitet", storyHochgeladen: null });
      await antwort("Erstelle die Story-Vorschau neu …");
      await tg.aufruf("editMessageReplyMarkup", {
        chat_id: auftrag.chatId, message_id: auftrag.menueNachricht,
      }).catch(() => {});
      einreihen(async () => {
        try { await storyAktualisieren(auftraege.get(id)); }
        catch (e) {
          console.error(e);
          auftraege.aendern(id, { storyDatei: null, storyHochgeladen: null });
          await tg.senden(auftrag.chatId, `❌ Story-Layout fehlgeschlagen: <pre>${html(e.message)}</pre>`);
        }
        await neuesMenue(auftraege.aendern(id, { status: "vorschau" }));
      });
      return;
    }
    case "storytext": {
      if (art(auftrag) !== "foto" || !auftrag.story) return antwort("Bildtext ist nur für Foto-Storys verfügbar.", true);
      auftraege.aendern(id, { wartetAuf: "storytext" });
      await tg.senden(auftrag.chatId,
        `Schick mir den Text, der direkt auf dem Story-Foto stehen soll (maximal 6 Zeilen).\n\n<b>Aktuell:</b> ${html(auftrag.storyText || "kein Text")}\n\nMit <code>-</code> entfernst du den Bildtext. Mit <code>abbrechen</code> kehrst du zurück.`);
      return antwort();
    }
    case "quer": {
      if (art(auftrag) !== "video" || auftrag.nurStory || !(auftrag.masse?.hoehe > auftrag.masse?.breite)) return antwort("16:9 ist hier für Hochkantvideos vorgesehen.", true);
      const aktiv = !auftrag.quer;
      auftrag = auftraege.aendern(id, { quer: aktiv, plan: null, hochgeladen: null,
        hochkantVorQuer: aktiv ? auftrag.hochkant : auftrag.hochkantVorQuer,
        hochkant: aktiv ? true : auftrag.hochkantVorQuer,
        storyDatei: null, storyHochgeladen: null, videoFormatFehler: true, status: "arbeitet" });
      await antwort(aktiv ? "Baue die 16:9-Fassung …" : "Stelle das ursprüngliche Format wieder her …");
      await tg.aufruf("editMessageReplyMarkup", { chat_id: auftrag.chatId, message_id: auftrag.menueNachricht }).catch(() => {});
      einreihen(() => renderUndVorschau(id));
      return;
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
      return antwort(auftrag.hochkant ? "Instagram/TikTok bekommen die 9:16-Fassung" : "Alle Kanäle bekommen das Feed-Format");
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
    case "thumbnailFrame": {
      let ms;
      try { ms = frameZeit(text, (await untersuche(coverVideo(auftrag))).dauer); }
      catch (e) { return tg.senden(auftrag.chatId, html(e.message)); }
      return thumbnailBauen(auftrag, { ...auftrag.thumbnail, modus: "frame", frameMs: ms, mitText: false });
    }
    case "thumbnailText": {
      const textNeu = text.trim();
      if (!textNeu) return tg.senden(auftrag.chatId, "Bitte einen Covertext eingeben.");
      const modus = auftrag.thumbnailTextModus ?? auftrag.thumbnail?.modus ?? "text";
      auftraege.aendern(auftrag.id, { thumbnailTextModus: null });
      return thumbnailBauen(auftrag, { ...auftrag.thumbnail, modus, text: textNeu, mitText: modus !== "text" });
    }
    case "quelle": {
      let q;
      try { q = quellenBearbeiten(text, auftrag.quellenkarte); }
      catch (e) { return tg.senden(auftrag.chatId, `❌ ${html(e.message)}`); }
      auftrag = auftraege.aendern(auftrag.id, { quellenkarte: q, wartetAuf: null });
      return neuesMenue(auftrag, quellenInhalt(auftrag));
    }
    case "grafiktext": {
      auftrag = auftraege.aendern(auftrag.id, { wartetAuf: null, status: "arbeitet" });
      await tg.senden(auftrag.chatId, "🖼️ Erstelle die Grafik mit deinem neuen Text …");
      einreihen(async () => {
        try {
          const a = await textZuGrafik(auftraege.get(auftrag.id), auftrag.grafikModus ?? "post", text.trim());
          await neuesMenue(a);
        } catch (e) {
          console.error(e);
          await tg.senden(auftrag.chatId, `❌ Grafik: <pre>${html(e.message)}</pre>`);
          await neuesMenue(auftraege.aendern(auftrag.id, { status: "vorschau" }));
        }
      });
      return;
    }
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
      auftrag = await captionsZuruecksetzen(auftrag, { caption: text.trim(), captionQuelle: "eigene", wartetAuf: null });
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
      auftrag = await captionsZuruecksetzen(auftrag, { caption: v.text, captionQuelle: v.quelle, wartetAuf: null });
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

/** Sprachnachricht lokal in einen bearbeitbaren Textentwurf umwandeln. */
async function sprachnachricht(msg, audio) {
  if (audio.file_size > 20 * MB && !tg.lokal) {
    return tg.senden(msg.chat.id, "Diese Sprachnachricht ist für die normale Telegram-Bot-API zu groß. Bitte kürzer aufnehmen.");
  }
  if (audio.duration > 240) return tg.senden(msg.chat.id, "Bitte Sprachnachrichten bis vier Minuten schicken. Längere Reden weiterhin als Video.");
  const a = auftraege.neu(msg.chat.id);
  await tg.senden(msg.chat.id, "🎙️ Ich transkribiere die Sprachnachricht lokal mit Whisper – ohne Cloud-KI …");
  einreihen(async () => {
    try {
      const original = datei(a, "sprache.ogg");
      const wav = datei(a, "sprache.wav");
      await tg.herunterladen(audio.file_id, original);
      await tonFuerWhisper(original, wav);
      const cues = await transkribiere(wav, config.whisper, config.glossar);
      const wortlaut = volltext(cues).trim();
      if (!wortlaut) throw new Error("Whisper hat keine verständliche Sprache erkannt.");
      const zuLang = wortlaut.length > 2800;
      const text = zuLang ? wortlaut.slice(0, 2750).trimEnd() + " […]" : wortlaut;
      const auftrag = auftraege.aendern(a.id, {
        art: "text", notizen: text, transkript: wortlaut, caption: text,
        captionQuelle: "transkript", medien: [], status: "vorschau",
      });
      await tg.senden(a.chatId, `🎙️ <b>Transkript (bitte prüfen)</b>\n${html(text.slice(0, 3500))}` +
        (zuLang ? "\n⚠️ Für den Entwurf gekürzt." : ""));
      await neuesMenue(auftrag);
    } catch (e) {
      console.error(e);
      auftraege.aendern(a.id, { status: "fehler" });
      await tg.senden(a.chatId, `❌ Spracherkennung: ${html(e.message)}`);
    }
  });
}

/** Digitalen Antrag lesen; keine OCR und keine unbelegten Zusammenfassungen. */
async function pdfAntrag(msg, dokument) {
  if (dokument.file_size > 12 * MB) return tg.senden(msg.chat.id, "Bitte ein Antrags-PDF unter 12 MB schicken.");
  const a = auftraege.neu(msg.chat.id);
  await tg.senden(msg.chat.id, "📄 Ich lese den Antrag lokal und suche Textstellen für Beitragsentwürfe …");
  einreihen(async () => {
    try {
      const pdf = datei(a, "antrag.pdf");
      await tg.herunterladen(dokument.file_id, pdf);
      const roh = await ausfuehren("pdftotext", ["-f", "1", "-l", "15", "-layout", pdf, "-"]);
      const varianten = antragVorschlaege(roh);
      const erste = varianten[0];
      const auftrag = auftraege.aendern(a.id, {
        art: "text", notizen: erste.text, caption: erste.text,
        captionQuelle: "dokument", antragVarianten: varianten, antragIndex: 0,
        quellenkarte: {
          dateiname: path.basename(dokument.file_name || "antrag.pdf").slice(0, 200),
          titel: varianten[0].text.slice(0, 300), stand: "ungeprüft",
          sha256: createHash("sha256").update(await fs.readFile(pdf)).digest("hex"),
          erfasst: new Date().toISOString(),
        },
        medien: [], status: "vorschau",
      });
      await tg.senden(a.chatId,
        `📄 <b>${varianten.length} Textstelle(n) im Antrag gefunden</b> (maximal erste 15 Seiten).\n` +
        "Das sind reine Auszüge, keine KI-Zusammenfassung. Der Bot prüft nicht, ob die Aussagen zutreffen oder was beschlossen wurde. Bitte Kontext, Überschrift und Inhalt vor dem Posten prüfen.");
      await neuesMenue(auftrag);
    } catch (e) {
      console.error(e);
      auftraege.aendern(a.id, { status: "fehler" });
      await tg.senden(a.chatId, `❌ Antrag: ${html(e.message)}`);
    }
  });
}

/** Gespeicherte Ideen nicht mit dem auf 14 Tage begrenzten Auftragsarchiv vermischen. */
async function ideenMenue(chatId) {
  const liste = ideen.liste(chatId);
  if (!liste.length) return tg.senden(chatId, "Noch keine Ideen gespeichert. Mit /idee und einem Gedanken dahinter kannst du anfangen.");
  return tg.senden(chatId,
    "<b>Deine gespeicherten Ideen</b> – antippen, um daraus wieder einen Entwurf zu machen:",
    { reply_markup: { inline_keyboard: liste.slice(0, 12).map((i) => [{
      text: `💡 ${i.text.replace(/\s+/g, " ").slice(0, 54)}`,
      callback_data: `idea:${i.id}`,
    }]) } });
}

async function ideenKnopf(cq) {
  const eintrag = ideen.holen(cq.message.chat.id, (cq.data ?? "").split(":")[1]);
  await tg.aufruf("answerCallbackQuery", {
    callback_query_id: cq.id, text: eintrag ? "Entwurf wird geöffnet" : "Idee nicht gefunden",
  }).catch(() => {});
  if (eintrag) await textBeitrag(cq.message.chat.id, eintrag.text,
    { captionQuelle: "eigene", quelle: "gespeicherte Idee" });
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

  const wartend = auftraege.wartend(chatId);
  if (wartend?.wartetAuf === "thumbnailBild" && (msg.photo || msg.document?.mime_type?.startsWith("image/"))) {
    const bild = msg.photo?.at(-1) ?? msg.document;
    if (bild.file_size > 12 * MB) return tg.senden(chatId, "Bitte ein Titelbild unter 12 MB schicken.");
    const ziel = datei(wartend, `cover-upload-${createHash("sha256").update(bild.file_id).digest("hex").slice(0, 12)}.jpg`);
    await tg.herunterladen(bild.file_id, ziel);
    return thumbnailBauen(wartend, { ...wartend.thumbnail, modus: "bild", bild: ziel, mitText: false });
  }
  const video = msg.video ?? (msg.document?.mime_type?.startsWith("video/") ? msg.document : null);
  if (video) return neuesVideo(msg, video);
  const foto = msg.photo?.at(-1) ?? (msg.document?.mime_type?.startsWith("image/") ? msg.document : null);
  if (foto) return fotoEingang(msg, foto);
  // Die Antwort auf einen laufenden Dialog hat Vorrang vor neuen Medientypen.
  if (!wartend && (msg.voice || msg.audio)) return sprachnachricht(msg, msg.voice || msg.audio);
  if (!wartend && msg.document && (msg.document.mime_type === "application/pdf" || /\.pdf$/i.test(msg.document.file_name ?? ""))) {
    return pdfAntrag(msg, msg.document);
  }
  if (msg.document && /\.srt$/i.test(msg.document.file_name ?? "") && wartend?.wartetAuf === "untertitel") {
    return srtDatei(wartend, msg.document);
  }

  const text = msg.text ?? "";
  if (/^\/(start|hilfe|help)\b/.test(text)) return tg.senden(chatId, HILFE);
  if (/^\/entwuerfe\b/.test(text)) return entwuerfeMenue(chatId);
  if (/^\/archiv\b/.test(text)) return entwuerfeMenue(chatId, true);
  if (/^\/antrag\b/.test(text)) return tg.senden(chatId,
    "Schick mir den Antrag direkt als PDF-Datei. Ich lese lokal bis zu 15 Seiten (digitaler Text, keine Scan-OCR) und zeige dir überprüfbare Textstellen für Post und Grafik.");
  if (/^\/ideen\b/.test(text)) return ideenMenue(chatId);
  if (/^\/idee(?:\s|$)/.test(text)) {
    const inhalt = text.replace(/^\/idee\s*/, "").trim();
    if (!inhalt) return tg.senden(chatId, "Schreib zum Beispiel <code>/idee Beitrag über den neuen Stadtratsantrag</code>.");
    const gespeichert = ideen.speichern(chatId, inhalt);
    return tg.senden(chatId, `💾 Idee ${gespeichert.id} gespeichert. Mit /ideen wieder aufrufen.`);
  }
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
          ? (u.callback_query.data?.startsWith("idea:") ? ideenKnopf(u.callback_query)
            : u.callback_query.data?.startsWith("d:") ? entwurfsKnopf(u.callback_query) : knopfGedrueckt(u.callback_query))
          : null;
      verarbeite?.catch((e) => fehlerMelden(u.message?.chat.id ?? u.callback_query?.message?.chat.id, e));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

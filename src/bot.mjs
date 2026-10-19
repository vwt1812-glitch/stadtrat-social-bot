// Telegram-Bot: Video, Fotos oder Text rein → Vorschau mit Logo, Untertiteln und
// Caption zurück → per Knopfdruck sofort oder geplant über Postiz veröffentlichen.

import fs from "node:fs/promises";
import path from "node:path";
import { ladeConfig } from "./config.mjs";
import { Telegram, html } from "./telegram.mjs";
import { Postiz, passendeKanaele, BRAUCHT_MEDIEN, NUR_VIDEO } from "./postiz.mjs";
import { Auftraege } from "./auftraege.mjs";
import { untersuche, tonFuerWhisper, rendern, vorschau, fotoRendern, fotoFuerClaude } from "./video.mjs";
import { transkribiere } from "./whisper.mjs";
import { captionVorschlag, einfacherVorschlag } from "./caption.mjs";
import { parseSrt, formatSrt, zuAss, parseKorrekturen, wendeKorrekturenAn, volltext } from "./untertitel.mjs";
import { parseZeit, zeitText, vorschlaege } from "./zeit.mjs";

const config = ladeConfig();
const tg = new Telegram(config.telegram);
const postiz = new Postiz(config.postiz);
const auftraege = new Auftraege(config.datenDir);
const MB = 1024 * 1024;

// ---------- Hilfsfunktionen ----------

let kanalCache = { zeit: 0, liste: [] };
async function alleKanaele() {
  if (Date.now() - kanalCache.zeit > 10 * 60e3) kanalCache = { zeit: Date.now(), liste: await postiz.kanaele() };
  return kanalCache.liste;
}

async function gewaehlteKanaele(auftrag) {
  const alle = await alleKanaele();
  if (!auftrag.kanaele) {
    const vorgabe = config.postiz.kanaele.length ? alle.filter((k) => config.postiz.kanaele.includes(k.id)) : alle;
    const standard = passendeKanaele(vorgabe, art(auftrag));
    auftraege.aendern(auftrag.id, { kanaele: standard.map((k) => k.id) });
  }
  return alle.filter((k) => auftrag.kanaele.includes(k.id));
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
• ein oder mehrere <b>Fotos</b> (als Album = Karussell). Ich setze das Logo drauf. Text in der Bildunterschrift wird zur Caption.
• einfach <b>Text</b> – daraus wird ein Textbeitrag (nicht für Instagram, TikTok, YouTube).

Danach kannst du Caption, Kanäle und Zeit anpassen und mit <b>Ja</b> posten.

/kanaele – verbundene Postiz-Kanäle anzeigen
/hilfe – diese Hilfe`;

// ---------- Menüs ----------

async function menueInhalt(auftrag) {
  let kanalText;
  try {
    const kanaele = await gewaehlteKanaele(auftrag);
    kanalText = kanaele.length ? kanaele.map((k) => html(k.name)).join(", ") : "<i>keine gewählt</i>";
  } catch (e) {
    kanalText = `<i>Postiz nicht erreichbar (${html(e.message.slice(0, 120))})</i>`;
  }
  const quelle = {
    transkript: "\n<i>(einfacher Vorschlag aus dem Transkript)</i>",
    hashtags: "\n<i>(noch ohne Text – über „Caption ändern“ ergänzen)</i>",
  }[auftrag.captionQuelle] ?? "";
  const titel = art(auftrag) === "text" ? "Textbeitrag" : "Caption-Vorschlag";
  const text = `<b>${titel}</b>${quelle}\n<blockquote expandable>${html(auftrag.caption)}</blockquote>\n📺 ${kanalText}`;
  const extra = {
    video: [knopf("📝 Untertitel", auftrag, "untertitel")],
    foto: [knopf(auftrag.mitLogo ? "🏷️ Logo entfernen" : "🏷️ Logo drauf", auftrag, "logo")],
    text: [],
  }[art(auftrag)];
  const zeilen = [
    [knopf("✅ Jetzt posten", auftrag, "jetzt"), knopf("🕐 Planen", auftrag, "planen")],
    [knopf(art(auftrag) === "text" ? "✏️ Text ändern" : "✏️ Caption ändern", auftrag, "caption"), ...(config.caption.anthropicKey ? [knopf("🔄 Neu formulieren", auftrag, "neu")] : [])],
    [...extra, knopf("📺 Kanäle", auftrag, "kanaele")],
    [knopf("🗑️ Verwerfen", auftrag, "verwerfen")],
  ];
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
  const zeilen = alle.map((k, i) => [
    knopf(`${auftrag.kanaele.includes(k.id) ? "✅" : "⬜"} ${k.name} (${k.identifier})`, auftrag, `k:${i}`),
  ]);
  zeilen.push([knopf("✔️ Fertig", auftrag, "zurueck")]);
  await zeigeMenue(auftrag, { text: "<b>Auf welchen Kanälen posten?</b>", reply_markup: { inline_keyboard: zeilen } });
}

async function bestaetigung(auftrag, typ, zeit) {
  const kanaele = await gewaehlteKanaele(auftrag);
  if (!kanaele.length) return { fehler: "Bitte zuerst mindestens einen Kanal wählen." };
  const unpassend = kanaele.filter((k) =>
    (art(auftrag) === "text" && BRAUCHT_MEDIEN.includes(k.identifier)) || (art(auftrag) === "foto" && NUR_VIDEO.includes(k.identifier)));
  if (unpassend.length) {
    const was = art(auftrag) === "text" ? "ein Bild oder Video" : "ein Video";
    return { fehler: `${unpassend.map((k) => k.name).join(", ")} braucht ${was} – bitte unter „Kanäle“ abwählen.` };
  }
  if (typ === "schedule" && zeit.getTime() < Date.now() + 60e3) return { fehler: "Die Zeit liegt in der Vergangenheit." };
  auftraege.aendern(auftrag.id, { plan: { typ, zeit: zeit.toISOString() } });
  const wann = typ === "now" ? "<b>jetzt</b>" : `am <b>${zeitText(zeit)}</b>`;
  return {
    text: `Wirklich ${wann} auf ${kanaele.map((k) => `<b>${html(k.name)}</b>`).join(", ")} posten?\n<blockquote expandable>${html(auftrag.caption)}</blockquote>`,
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
  auftraege.aendern(auftrag.id, { art: "video", statusNachricht: status.message_id, dateiName: video.file_name ?? "video.mp4" });
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
    if (vorschlag.fehler) await tg.senden(auftrag.chatId, `⚠️ Claude nicht erreichbar (${html(vorschlag.fehler)}) – einfacher Vorschlag stattdessen.`);
    auftraege.aendern(id, { caption: vorschlag.text, captionQuelle: vorschlag.quelle });

    await renderUndVorschau(id);
  } catch (e) {
    console.error(e);
    auftraege.aendern(id, { status: "fehler" });
    await schritt(auftraege.get(id), `❌ Fehler bei der Verarbeitung:\n<pre>${html(e.message)}</pre>`);
  }
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
      await fs.writeFile(ass, zuAss(cues, { ...auftrag.masse, ...config.layout }));
    }
    const fertig = datei(auftrag, "fertig.mp4");
    await rendern({ eingabe: auftrag.original, ausgabe: fertig, ass, masse: auftrag.masse, layout: config.layout, video: config.video });
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
    const fuerClaude = [];
    for (const [i, foto] of auftrag.fotos.entries()) {
      const original = datei(auftrag, `original-${i + 1}${path.extname(foto.name) || ".jpg"}`);
      await tg.herunterladen(foto.fileId, original);
      originale.push(original);
      if (config.caption.anthropicKey) {
        fuerClaude.push(datei(auftrag, `claude-${i + 1}.jpg`));
        await fotoFuerClaude(original, fuerClaude.at(-1));
      }
    }
    auftrag = auftraege.aendern(id, { originale, fuerClaude });

    // Eigener Text in der Bildunterschrift hat Vorrang vor einem Vorschlag
    let vorschlag = einfacherVorschlag({ notizen: auftrag.notizen }, config.caption.hashtags);
    if (vorschlag.quelle !== "eigene" && config.caption.anthropicKey) {
      await schritt(auftrag, "✍️ Schreibe Caption-Vorschlag …");
      vorschlag = await captionVorschlag({ art: "foto", bilder: fuerClaude }, config.caption);
      if (vorschlag.fehler) await tg.senden(auftrag.chatId, `⚠️ Claude nicht erreichbar (${html(vorschlag.fehler)}).`);
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
    const medien = auftrag.medien ?? [datei(auftrag, "fertig.mp4")];
    if (medien.length && !auftrag.hochgeladen) {
      await zeigeMenue(auftrag, { text: `⏫ Lade ${medien.length === 1 ? "Datei" : `${medien.length} Dateien`} zu Postiz hoch …`, reply_markup: { inline_keyboard: [] } });
      const hochgeladen = [];
      for (const d of medien) hochgeladen.push(await postiz.hochladen(d));
      auftrag = auftraege.aendern(auftrag.id, { hochgeladen });
    }
    await zeigeMenue(auftrag, { text: "📮 Lege Beitrag an …", reply_markup: { inline_keyboard: [] } });
    await postiz.beitrag({ typ, zeit, caption: auftrag.caption, medien: auftrag.hochgeladen ?? [], kanaele });
    auftraege.aendern(auftrag.id, { status: typ === "now" ? "gepostet" : "geplant" });
    const namen = kanaele.map((k) => html(k.name)).join(", ");
    const text = typ === "now"
      ? `✅ <b>Wird jetzt gepostet</b> auf ${namen}.`
      : `📅 <b>Geplant für ${zeitText(zeit)}</b> auf ${namen}.\nÄndern oder löschen kannst du ihn im Postiz-Kalender.`;
    await zeigeMenue(auftrag, { text: `${text}\n<blockquote expandable>${html(auftrag.caption)}</blockquote>`, reply_markup: { inline_keyboard: [] } });
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
  const [, id, aktion, arg] = (cq.data ?? "").split(":");
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
    case "untertitel":
      auftraege.aendern(id, { wartetAuf: "untertitel" });
      await tg.datei(auftrag.chatId, "sendDocument", "document", datei(auftrag, "untertitel.srt"), {
        caption: "Korrekturen als Text schicken, eine pro Zeile:\n<code>Kuffner => Küffner</code>\n\nOder die korrigierte .srt-Datei zurückschicken.",
        parse_mode: "HTML",
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
    case "k": {
      const kanal = (await alleKanaele())[Number(arg)];
      if (kanal) {
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
    case "caption":
      auftrag = auftraege.aendern(auftrag.id, { caption: text.trim(), captionQuelle: "eigene", wartetAuf: null });
      return neuesMenue(auftrag);
    case "hinweis": {
      await tg.senden(auftrag.chatId, "✍️ Formuliere neu …");
      const hinweis = text.trim() === "-" ? "" : text.trim();
      const material = { art: art(auftrag), transkript: auftrag.transkript, notizen: auftrag.notizen, bilder: auftrag.fuerClaude, bisher: auftrag.caption };
      const v = await captionVorschlag(material, config.caption, hinweis || "neu formulieren");
      if (v.fehler) await tg.senden(auftrag.chatId, `⚠️ ${html(v.fehler)}`);
      auftrag = auftraege.aendern(auftrag.id, { caption: v.text, captionQuelle: v.quelle, wartetAuf: null });
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
      const korrekturen = parseKorrekturen(text);
      if (!korrekturen.length) return tg.senden(auftrag.chatId, "Bitte so schicken: <code>falsch => richtig</code> (eine Korrektur pro Zeile).");
      const srt = datei(auftrag, "untertitel.srt");
      const cues = wendeKorrekturenAn(parseSrt(await fs.readFile(srt, "utf8")), korrekturen);
      await fs.writeFile(srt, formatSrt(cues));
      return untertitelNeu(auftrag, `${korrekturen.length} Korrektur(en) übernommen.`);
    }
  }
}

async function untertitelNeu(auftrag, info) {
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
  await untertitelNeu(auftrag, `Untertitel-Datei mit ${cues.length} Einträgen übernommen.`);
}

async function nachricht(msg) {
  const chatId = msg.chat.id;
  const nutzer = msg.from?.id;
  if (!config.telegram.erlaubt.includes(nutzer)) {
    await tg.senden(chatId, `Kein Zugriff. Deine Telegram-ID ist <code>${nutzer}</code> – zum Freischalten in <code>ERLAUBTE_NUTZER</code> eintragen.`);
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
    const kanaele = await alleKanaele();
    return tg.senden(chatId, kanaele.length
      ? kanaele.map((k) => `• <b>${html(k.name)}</b> (${k.identifier})\n  <code>${k.id}</code>`).join("\n")
      : "In Postiz sind noch keine Kanäle verbunden.");
  }
  if (wartend && text) return texteingabe(wartend, text);
  if (text && !text.startsWith("/")) return textBeitrag(chatId, text);
  return tg.senden(chatId, "Schick mir ein Video, Fotos oder einfach Text – oder /hilfe.");
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
        : u.callback_query && config.telegram.erlaubt.includes(u.callback_query.from.id)
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

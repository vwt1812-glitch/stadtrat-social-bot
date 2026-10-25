// Postiz Public API: https://docs.postiz.com/public-api
// Selbst gehostet: POSTIZ_URL = Postiz-Adresse, z. B. http://localhost:5000 (API unter /api/public/v1).
// Quelle: apps/backend/src/public-api/routes/v1/public.integrations.controller.ts in gitroomhq/postiz-app.

import fs from "node:fs";
import path from "node:path";
import twitter from "twitter-text";

/** Netzwerke, die ohne Bild oder Video nichts annehmen. */
export const BRAUCHT_MEDIEN = ["instagram", "instagram-standalone", "tiktok", "tiktok-business", "youtube", "pinterest"];
/** Netzwerke, die nur Videos nehmen. */
export const NUR_VIDEO = ["youtube"];

/** Kanäle, die zur Art des Beitrags passen. */
export function passendeKanaele(kanaele, art) {
  if (art === "text") return kanaele.filter((k) => !BRAUCHT_MEDIEN.includes(k.identifier));
  if (art === "foto") return kanaele.filter((k) => !NUR_VIDEO.includes(k.identifier));
  return kanaele;
}

/**
 * Zeichenlimits wie in Postiz (maxLength der Provider). In kanaele.json per „maxZeichen“ änderbar,
 * etwa für X Premium.
 */
export const ZEICHENLIMIT = {
  x: 280,
  bluesky: 300,
  threads: 500,
  mastodon: 500,
  pinterest: 500,
  discord: 1980,
  instagram: 2200,
  "instagram-standalone": 2200,
  tiktok: 2000,
  "tiktok-business": 2200,
  linkedin: 3000,
  "linkedin-page": 3000,
  telegram: 4096,
  youtube: 5000,
  facebook: 63206,
};

export function zeichenLimit(kanal, eigene = {}) {
  return kanal.maxZeichen ?? eigene[kanal.id]?.maxZeichen ?? eigene[kanal.identifier]?.maxZeichen ?? ZEICHENLIMIT[kanal.identifier] ?? null;
}

/**
 * Zeichen zählen wie Postiz (libraries/helpers/src/utils/count.length.ts): X gewichtet über
 * twitter-text (Emojis doppelt, Links 23), Threads in Bytes, alle anderen in JavaScript-Zeichen
 * (ein Emoji sind dort meist 2).
 */
export function zeichenZahl(text, identifier) {
  if (identifier === "x") return twitter.parseTweet(text).weightedLength;
  // Mastodon direkt (ohne Postiz): Codepoints, Links 23
  if (identifier === "mastodon-direkt") return [...text.replace(/https?:\/\/\S+/g, "x".repeat(23))].length;
  if (identifier === "threads") return new TextEncoder().encode(text).length;
  return text.length;
}

/** Postiz-Adresse in die Basis der Public API umrechnen – mit oder ohne /api angegeben. */
export function apiBasis(url) {
  const ohne = url.replace(/\/+$/, "");
  if (/\/public\/v1$/.test(ohne)) return ohne;
  if (/\/api$/.test(ohne)) return `${ohne}/public/v1`;
  return `${ohne}/api/public/v1`;
}

/** Kanal per ID, Name oder Profil/Handle finden (für POSTIZ_KANAELE). */
export function passtZu(kanal, eintrag) {
  const norm = (t) => String(t ?? "").trim().toLowerCase().replace(/^@/, "");
  return [kanal.id, kanal.name, kanal.profile].some((wert) => wert && norm(wert) === norm(eintrag));
}

/**
 * Postiz begrenzt die Public API pro Stunde (API_LIMIT in der Postiz-Konfiguration, Standard 30).
 * Zählt die eigenen Anfragen der letzten Stunde mit, auch über Neustarts hinweg.
 */
export class AnfragenZaehler {
  constructor(datei, max) {
    this.datei = datei;
    this.max = max;
    try {
      this.zeiten = JSON.parse(fs.readFileSync(datei, "utf8"));
    } catch {
      this.zeiten = [];
    }
  }

  #aufraeumen(jetzt) {
    this.zeiten = this.zeiten.filter((t) => jetzt - t < 3600e3);
  }

  zaehlen(jetzt = Date.now()) {
    this.#aufraeumen(jetzt);
    this.zeiten.push(jetzt);
    if (this.datei) fs.writeFileSync(this.datei, JSON.stringify(this.zeiten));
  }

  /** Anfragen in der letzten Stunde */
  anzahl(jetzt = Date.now()) {
    this.#aufraeumen(jetzt);
    return this.zeiten.length;
  }

  /** null, wenn `bedarf` Anfragen jetzt gehen, sonst der Zeitpunkt, ab dem sie gehen (Infinity: nie). */
  wiederFrei(bedarf, jetzt = Date.now()) {
    if (!this.max) return null;
    this.#aufraeumen(jetzt);
    const zuViel = this.zeiten.length + bedarf - this.max;
    if (zuViel <= 0) return null;
    if (bedarf > this.max) return Infinity;
    return new Date(this.zeiten[zuViel - 1] + 3600e3);
  }
}

/**
 * Netzwerke, die Videos im Hochformat zeigen (Instagram als Reel, TikTok). Auf Wunsch bekommen sie
 * statt eines Querformat-Videos die eigene 9:16-Fassung; per HOCHKANT_NETZE änderbar.
 */
export const HOCHKANT = ["instagram", "instagram-standalone", "tiktok", "tiktok-business"];

/** Netzwerke mit Stories und die Einstellung dafür. */
export const STORY = {
  instagram: { post_type: "story", collaborators: [] },
  "instagram-standalone": { post_type: "story", collaborators: [] },
  facebook: { post_type: "story" },
};

/** Kunden, wie sie an den Kanälen hängen: [{id, name}] nach Name sortiert. */
export function kundenAus(kanaele) {
  const kunden = new Map();
  for (const k of kanaele) if (k.customer) kunden.set(k.customer.id, k.customer);
  return [...kunden.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/** Kunde per Name oder ID finden (Groß-/Kleinschreibung egal). */
export function findeKunde(kanaele, suche) {
  if (!suche) return null;
  const s = suche.toLowerCase();
  return kundenAus(kanaele).find((k) => k.id === suche || k.name.toLowerCase() === s) ?? null;
}

/** Kanäle eines Kunden; kundeId null = alle. */
export function kanaeleVonKunde(kanaele, kundeId) {
  return kundeId ? kanaele.filter((k) => k.customer?.id === kundeId) : kanaele;
}

/** Postiz-„Re-poster“: Andere Konten teilen den Beitrag nach dem Posten. */
export const REPOST = {
  x: { plug: "x-repost-post-users", konten: ["x"] },
  linkedin: { plug: "linkedin-repost-post-users", konten: ["linkedin", "linkedin-page"] },
  "linkedin-page": { plug: "linkedin-repost-post-users", konten: ["linkedin", "linkedin-page"] },
};

/** Konten, die mindestens einen der gewählten Beiträge reposten können. */
export function repostKandidaten(alle, gewaehlte) {
  const arten = new Set(gewaehlte.flatMap((k) => REPOST[k.identifier]?.konten ?? []));
  return alle.filter((k) => arten.has(k.identifier));
}

/** Instagram erlaubt bis zu drei Collab-Partner; @ und Leerzeichen werden entfernt. */
export function parseCollabs(text) {
  return [...new Set(text.split(/[\s,;]+/).map((n) => n.replace(/^@/, "").trim()).filter(Boolean))];
}

export const REPOST_VERZOEGERUNG = [
  ["sofort", 0],
  ["nach 1 Std.", 3600e3],
  ["nach 2 Std.", 7200e3],
  ["nach 6 Std.", 6 * 3600e3],
  ["nach 1 Tag", 86400e3],
];

/**
 * Alle Einstellungen eines Kanals für Postiz.
 * @param {{id:string, identifier:string}} kanal
 * @param {object} o
 * @param {string} o.caption
 * @param {string[]} [o.collabs] Instagram-Namen
 * @param {{kanaele:string[], verzoegerung:number}} [o.repost]
 * @param {object} [o.eigene] Inhalt von kanaele.json
 */
export function einstellungenFuer(kanal, { caption, collabs = [], repost, eigene = {} }) {
  const settings = {
    ...standardEinstellungen(kanal.identifier, caption),
    ...eigene[kanal.identifier],
    ...eigene[kanal.id],
    __type: kanal.identifier,
  };
  delete settings.maxZeichen; // nur für den Bot, nicht für Postiz
  if (collabs.length && kanal.identifier.startsWith("instagram") && settings.post_type !== "story") {
    settings.collaborators = collabs.map((label) => ({ label }));
  }
  const plug = REPOST[kanal.identifier];
  const reposter = (repost?.kanaele ?? []).filter((id) => id !== kanal.id);
  if (plug && reposter.length) {
    settings[`plug--${plug.plug}--active`] = true;
    settings[`plug--${plug.plug}--integrations`] = reposter.map((id) => ({ id }));
    settings[`plug--${plug.plug}--delay`] = String(repost.verzoegerung ?? 0);
  }
  return settings;
}

const MEDIENTYP = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

/** Pflichtangaben je Netzwerk, damit Postiz den Beitrag annimmt. */
export function standardEinstellungen(identifier, caption) {
  const titel = caption.split("\n")[0].replace(/#\S+/g, "").trim();
  switch (identifier) {
    case "instagram":
    case "instagram-standalone":
      return { post_type: "post", collaborators: [] };
    case "facebook":
      return { post_type: "post" };
    case "x":
      return { who_can_reply_post: "everyone" };
    case "tiktok":
    case "tiktok-business":
      return {
        title: titel.slice(0, 90),
        privacy_level: "PUBLIC_TO_EVERYONE",
        duet: false,
        stitch: false,
        comment: true,
        autoAddMusic: "no",
        brand_content_toggle: false,
        brand_organic_toggle: false,
        content_posting_method: "DIRECT_POST",
      };
    case "youtube":
      return { title: (titel || "Aus dem Stadtrat").slice(0, 100).padEnd(2, "."), type: "public", selfDeclaredMadeForKids: "no", tags: [] };
    default:
      return {};
  }
}

/** Postiz speichert Beiträge als HTML – Absätze bleiben so erhalten. */
export function alsHtml(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.split("\n").map((z) => `<p>${esc(z)}</p>`).join("");
}

export class Postiz {
  constructor({ url, apiKey, einstellungen, zaehler = new AnfragenZaehler(null, 0) }) {
    this.url = apiBasis(url);
    this.apiKey = apiKey;
    this.einstellungenDatei = einstellungen;
    this.zaehler = zaehler;
  }

  async #anfrage(methode, pfad, body) {
    this.zaehler.zaehlen();
    const istForm = body instanceof FormData;
    const res = await fetch(this.url + pfad, {
      method: methode,
      // Postiz erwartet den Key ohne „Bearer“
      headers: { Authorization: this.apiKey, ...(body && !istForm ? { "Content-Type": "application/json" } : {}) },
      body: istForm ? body : body ? JSON.stringify(body) : undefined,
      ...(methode === "POST" && pfad === "/posts" ? { signal: AbortSignal.timeout(120000) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      const e = new Error(`Postiz ${methode} ${pfad}: ${res.status} ${text.slice(0, 500)}`);
      e.sicherAbgelehnt = [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(res.status);
      throw e;
    }
    return text ? JSON.parse(text) : null;
  }

  /** @returns {Promise<{id:string,name:string,identifier:string,disabled:boolean,customer?:{id:string,name:string}}[]>} */
  async kanaele() {
    const alle = await this.#anfrage("GET", "/integrations");
    return alle.filter((k) => !k.disabled);
  }

  /** Posts mit Termin im Zeitraum, samt state (QUEUE, PUBLISHED, ERROR, DRAFT) und error. */
  async posts(von, bis) {
    const query = new URLSearchParams({ startDate: von.toISOString(), endDate: bis.toISOString() });
    return (await this.#anfrage("GET", `/posts?${query}`))?.posts ?? [];
  }

  /** Nächster freier Termin laut Postiz-Zeitplan. */
  async freierSlot(kanalId) {
    const { date } = await this.#anfrage("GET", `/find-slot/${kanalId}`);
    return new Date(date);
  }

  async hochladen(datei) {
    const form = new FormData();
    const type = MEDIENTYP[path.extname(datei).toLowerCase()] ?? "application/octet-stream";
    form.append("file", await fs.openAsBlob(datei, { type }), path.basename(datei));
    const media = await this.#anfrage("POST", "/upload", form);
    return { id: media.id, path: media.path };
  }

  /** Inhalt von kanaele.json */
  eigeneEinstellungen() {
    try {
      return JSON.parse(fs.readFileSync(this.einstellungenDatei, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return {};
      throw new Error(`${this.einstellungenDatei} ist kein gültiges JSON: ${e.message}`);
    }
  }

  /**
   * @param {object} o
   * @param {"now"|"schedule"} o.typ
   * @param {Date} o.zeit
   * @param {string} o.caption Haupttext
   * @param {Record<string,string>} [o.captions] eigene Fassungen je Kanal-ID
   * @param {{id:string,path:string}[]} o.medien leer bei reinen Textbeiträgen
   * @param {{id:string,identifier:string}[]} o.kanaele
   * @param {string[]} [o.collabs]
   * @param {{kanaele:string[], verzoegerung:number}} [o.repost]
   * @param {boolean} [o.story] Story auf Instagram/Facebook (erstes Bild/Video)
   * @param {boolean} [o.nurStory] keinen normalen Feed-Beitrag anlegen
   * @param {{id:string,path:string}} [o.storyMedium] eigene Story-Fassung (9:16), sonst das erste Medium
   * @param {{id:string,path:string}} [o.hochkantMedium] 9:16-Fassung für die Hochformat-Netzwerke statt `medien`
   * @param {string[]} [o.hochkantNetze] welche Netzwerke die 9:16-Fassung bekommen
   * @param {object} [o.fortschritt] bereits bestätigte Feed-/Story-Ergebnisse
   * @param {Function} [o.vorAnlegen] persistiert vor dem Request den unklaren Teilschritt
   * @param {Function} [o.nachAnlegen] persistiert jedes bestätigte Teilergebnis
   * @param {Function} [o.beiAblehnung] löscht bei eindeutig abgelehnten Requests die Unklar-Markierung
   * @param {Record<string,{id:string,path:string}>} [o.thumbnails] Cover-Uploads pro Kanal-ID
   * @param {number|null} [o.thumbnailTimestamp] Framezeit in Millisekunden (reguläres TikTok)
   * @param {boolean} [o.mastodonThumbnails] nur für den optional angepassten Postiz-Provider
   * @returns {Promise<{post: {postId:string}[], story?: {postId:string}[]}>} IDs für die Kontrolle
   */
  async beitrag({
    typ, zeit, caption, captions = {}, medien, kanaele, collabs, repost, story = false, nurStory = false, storyMedium = null,
    hochkantMedium = null, hochkantNetze = HOCHKANT,
    fortschritt = {}, vorAnlegen = async () => {}, nachAnlegen = async () => {}, beiAblehnung = async () => {},
    thumbnails = {}, thumbnailTimestamp = null, mastodonThumbnails = false,
  }) {
    const eigene = this.eigeneEinstellungen();
    const feedPost = (k) => {
      const captionText = captions[k.id] ?? caption;
      const settings = einstellungenFuer(k, { caption: captionText, collabs, repost, eigene });
      const coverErlaubt = ["instagram", "instagram-standalone", "youtube", "tiktok-business"].includes(k.identifier) || (k.identifier === "mastodon" && mastodonThumbnails);
      const cover = coverErlaubt ? thumbnails[k.id] : null;
      const medienFuerKanal = hochkantMedium && hochkantNetze.includes(k.identifier) ? [hochkantMedium] : medien;
      const image = medienFuerKanal.map((m, i) => {
        // Nur Video, nur erstes Medium: nie Cover als zusätzliches Feedbild oder Storymedium senden.
        if (i || !/\.mp4(?:[?#]|$)/i.test(m.path)) return m;
        if (cover) return { ...m, thumbnail: cover.path };
        if (k.identifier === "tiktok" && settings.content_posting_method === "DIRECT_POST" &&
            settings.privacy_level === "PUBLIC_TO_EVERYONE" && Number.isSafeInteger(thumbnailTimestamp) && thumbnailTimestamp >= 0) {
          return { ...m, thumbnailTimestamp };
        }
        return m;
      });
      if (k.identifier === "youtube" && cover && image[0]?.thumbnail) settings.thumbnail = cover;
      return { integration: { id: k.id }, value: [{ content: alsHtml(captionText), image }], settings };
    };
    const body = {
      type: typ,
      date: zeit.toISOString(),
      shortLink: false,
      tags: [],
      posts: kanaele.map(feedPost),
    };
    const storyKanaele = kanaele.filter((k) => STORY[k.identifier]);
    if (nurStory && (!story || storyKanaele.length !== kanaele.length || !storyKanaele.length || (!storyMedium && !medien.length))) {
      throw new Error("Nur Story braucht mindestens einen Instagram-/Facebook-Kanal und ein Foto oder Video.");
    }
    const ergebnis = { ...fortschritt };
    const anlegen = async (teil, daten) => {
      await vorAnlegen(teil);
      let posts;
      try {
        posts = await this.#anfrage("POST", "/posts", daten);
      } catch (e) {
        if (e.sicherAbgelehnt) await beiAblehnung(teil);
        throw e;
      }
      // Auch eine unerwartete 2xx-Antwort darf keinen ungesicherten Wiederholungsversuch auslösen.
      if (!Array.isArray(posts) || posts.length !== daten.posts.length || posts.some((p) => !p?.postId)) {
        throw new Error("Postiz hat keine vollständigen Post-IDs bestätigt. Bitte den Kalender prüfen.");
      }
      ergebnis[teil] = posts;
      await nachAnlegen(structuredClone(ergebnis));
    };
    if (nurStory) ergebnis.post = [];
    else if (!Object.hasOwn(ergebnis, "post")) await anlegen("post", body);
    if (story && (medien.length || storyMedium) && storyKanaele.length && !Object.hasOwn(ergebnis, "story")) {
      await anlegen("story", {
        ...body,
        posts: storyKanaele.map((k) => ({
          integration: { id: k.id },
          value: [{ content: "", image: [storyMedium ?? medien[0]] }],
          settings: { __type: k.identifier, ...STORY[k.identifier] },
        })),
      });
    }
    return ergebnis;
  }

  /**
   * So viele Anfragen braucht ein Beitrag: Uploads + Post, ggf. Story-Post, und der Upload der
   * eigenen 9:16-Fassung (`storyUpload`), wenn Story oder Hochformat-Netzwerke sie brauchen.
   */
  static bedarf({ medien, hochgeladen, story, kanaele, storyUpload = false, storyBereit = false, nurStory = false, hochkant = false, hochkantNetze = HOCHKANT, fortschritt = {}, coverUploads = 0 }) {
    if (nurStory) return (fortschritt.story ? 0 : 1) + (storyUpload ? 1 : storyBereit || hochgeladen ? 0 : 1);
    const mitStory = story && medien && kanaele.some((k) => STORY[k.identifier]);
    const mitHochkant = hochkant && medien && kanaele.some((k) => hochkantNetze.includes(k.identifier));
    return (hochgeladen ? 0 : medien) + (fortschritt.post ? 0 : 1) + (mitStory && !fortschritt.story ? 1 : 0) + (storyUpload && (mitStory || mitHochkant) ? 1 : 0) + (fortschritt.post ? 0 : coverUploads);
  }
}

// Postiz Public API: https://docs.postiz.com/public-api
// Selbst gehostet: POSTIZ_URL = Backend-Adresse, z. B. http://localhost:5000/api

import fs from "node:fs";
import path from "node:path";

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
  constructor({ url, apiKey, einstellungen }) {
    this.url = `${url}/public/v1`;
    this.apiKey = apiKey;
    this.einstellungenDatei = einstellungen;
  }

  async #anfrage(methode, pfad, body) {
    const istForm = body instanceof FormData;
    const res = await fetch(this.url + pfad, {
      method: methode,
      headers: { Authorization: this.apiKey, ...(body && !istForm ? { "Content-Type": "application/json" } : {}) },
      body: istForm ? body : body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Postiz ${methode} ${pfad}: ${res.status} ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }

  /** @returns {Promise<{id:string,name:string,identifier:string,disabled:boolean,customer?:{id:string,name:string}}[]>} */
  async kanaele() {
    const alle = await this.#anfrage("GET", "/integrations");
    return alle.filter((k) => !k.disabled);
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

  #eigeneEinstellungen() {
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
   * @param {string} o.caption
   * @param {{id:string,path:string}[]} o.medien leer bei reinen Textbeiträgen
   * @param {{id:string,identifier:string}[]} o.kanaele
   * @param {string[]} [o.collabs]
   * @param {{kanaele:string[], verzoegerung:number}} [o.repost]
   */
  async beitrag({ typ, zeit, caption, medien, kanaele, collabs, repost }) {
    const eigene = this.#eigeneEinstellungen();
    const body = {
      type: typ,
      date: zeit.toISOString(),
      shortLink: false,
      tags: [],
      posts: kanaele.map((k) => ({
        integration: { id: k.id },
        value: [{ content: alsHtml(caption), image: medien }],
        settings: einstellungenFuer(k, { caption, collabs, repost, eigene }),
      })),
    };
    return this.#anfrage("POST", "/posts", body);
  }
}

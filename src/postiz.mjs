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

  /** @returns {Promise<{id:string,name:string,identifier:string,disabled:boolean}[]>} */
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
   */
  async beitrag({ typ, zeit, caption, medien, kanaele }) {
    const eigene = this.#eigeneEinstellungen();
    const body = {
      type: typ,
      date: zeit.toISOString(),
      shortLink: false,
      tags: [],
      posts: kanaele.map((k) => ({
        integration: { id: k.id },
        value: [{ content: alsHtml(caption), image: medien }],
        settings: {
          ...standardEinstellungen(k.identifier, caption),
          ...eigene[k.identifier],
          ...eigene[k.id],
          __type: k.identifier,
        },
      })),
    };
    return this.#anfrage("POST", "/posts", body);
  }
}

// Mastodon direkt statt über Postiz: Postiz postet dort immer „öffentlich“ und ohne Inhaltswarnung
// (mastodon.provider.ts: visibility 'public'). Viele Instanzen verlangen für automatisierte oder
// politische Accounts aber „ungelistet“ und Inhaltswarnungen.
//   MASTODON_URL    Adresse der Instanz, z. B. https://nrw.social
//   MASTODON_TOKEN  Zugriffstoken: Einstellungen → Entwicklung → Neue Anwendung
//                   (Berechtigungen read:accounts, write:media, write:statuses)

import fs from "node:fs";
import path from "node:path";

/** Kennung des Mastodon-Direktkanals in Menüs und Aufträgen (neben den Postiz-Kanälen). */
export const DIREKT = "mastodon-direkt";

/** Wie Mastodon zählt: Codepoints, jeder Link pauschal 23 Zeichen. */
export function mastodonLaenge(text) {
  return [...text.replace(/https?:\/\/\S+/g, "x".repeat(23))].length;
}

const MEDIENTYP = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

export class Mastodon {
  constructor({ url, token, sichtbarkeit = "unlisted", inhaltswarnung = "" }) {
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.sichtbarkeit = sichtbarkeit;
    this.inhaltswarnung = inhaltswarnung;
  }

  async #anfrage(pfad, optionen = {}) {
    const res = await fetch(this.url + pfad, {
      ...optionen,
      headers: { Authorization: `Bearer ${this.token}`, ...optionen.headers },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Mastodon ${optionen.method ?? "GET"} ${pfad}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return { status: res.status, daten: text ? JSON.parse(text) : null };
  }

  /** @returns {Promise<string>} Benutzername des Kontos */
  async konto() {
    return (await this.#anfrage("/api/v1/accounts/verify_credentials")).daten.username;
  }

  /** Bild oder Video hochladen; Videos verarbeitet Mastodon nachträglich, darauf wird gewartet. */
  async hochladen(datei, { alt = "", warten = 2000, versuche = 90 } = {}) {
    const form = new FormData();
    const type = MEDIENTYP[path.extname(datei).toLowerCase()] ?? "application/octet-stream";
    form.append("file", await fs.openAsBlob(datei, { type }), path.basename(datei));
    if (alt) form.append("description", alt.slice(0, 1500));
    let { status, daten } = await this.#anfrage("/api/v2/media", { method: "POST", body: form });
    for (let i = 0; status === 202 || !daten.url; i++) {
      if (i >= versuche) throw new Error("Mastodon verarbeitet das Video zu lange.");
      await new Promise((r) => setTimeout(r, warten));
      ({ status, daten } = await this.#anfrage(`/api/v1/media/${daten.id}`));
    }
    return daten.id;
  }

  /** Text, der für die Inhaltswarnung vom Limit abgeht. */
  get cwLaenge() {
    return this.inhaltswarnung ? mastodonLaenge(this.inhaltswarnung) : 0;
  }

  /** Body für POST /api/v1/statuses. Mastodon plant ab 5 Minuten Vorlauf selbst ein, sonst sofort. */
  statusBody({ text, mediaIds = [], zeit }) {
    const body = { status: text, media_ids: mediaIds, visibility: this.sichtbarkeit, language: "de" };
    if (this.inhaltswarnung) body.spoiler_text = this.inhaltswarnung;
    if (zeit && zeit.getTime() - Date.now() > 5 * 60e3) body.scheduled_at = zeit.toISOString();
    return body;
  }

  /**
   * Medien hochladen und Status anlegen. Der Idempotency-Key verhindert Doppelposts bei Wiederholung.
   * @returns {Promise<{id:string, geplant:boolean}>}
   */
  async posten({ text, medien = [], zeit, schluessel }) {
    const mediaIds = [];
    for (const datei of medien) mediaIds.push(await this.hochladen(datei));
    const body = this.statusBody({ text, mediaIds, zeit });
    const { daten } = await this.#anfrage("/api/v1/statuses", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(schluessel ? { "Idempotency-Key": schluessel } : {}) },
      body: JSON.stringify(body),
    });
    return { id: daten.id, geplant: Boolean(body.scheduled_at) };
  }
}

/** Mastodon nimmt bis zu 4 Bilder oder 1 Video. */
export function mastodonMedien(medien) {
  const video = medien.find((m) => m.endsWith(".mp4"));
  return video ? [video] : medien.slice(0, 4);
}

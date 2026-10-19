// Schlanker Client für die Telegram Bot API (https://core.telegram.org/bots/api).
// Mit eigenem Bot-API-Server (TELEGRAM_API_URL, Start mit --local) gehen Dateien
// bis 2 GB, über api.telegram.org nur 20 MB herunter und 50 MB hoch.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class Telegram {
  constructor({ token, api }) {
    this.token = token;
    this.api = api;
    this.lokal = !api.includes("api.telegram.org");
  }

  async aufruf(methode, params = {}) {
    const istForm = params instanceof FormData;
    const res = await fetch(`${this.api}/bot${this.token}/${methode}`, {
      method: "POST",
      headers: istForm ? {} : { "Content-Type": "application/json" },
      body: istForm ? params : JSON.stringify(params),
    });
    const json = await res.json();
    if (!json.ok) {
      const fehler = new Error(`Telegram ${methode}: ${json.description}`);
      fehler.code = json.error_code;
      throw fehler;
    }
    return json.result;
  }

  senden(chatId, text, extra = {}) {
    return this.aufruf("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
  }

  async bearbeiten(chatId, messageId, text, extra = {}) {
    try {
      return await this.aufruf("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
    } catch (e) {
      if (!/message is not modified/.test(e.message)) throw e;
    }
  }

  async datei(chatId, methode, feld, datei, extra = {}) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    for (const [k, v] of Object.entries(extra)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
    form.append(feld, await fs.openAsBlob(datei), path.basename(datei));
    return this.aufruf(methode, form);
  }

  async herunterladen(fileId, ziel) {
    const info = await this.aufruf("getFile", { file_id: fileId });
    // Lokaler Bot-API-Server liefert einen absoluten Pfad auf der Platte
    if (path.isAbsolute(info.file_path)) {
      await fsp.copyFile(info.file_path, ziel);
      return;
    }
    const res = await fetch(`${this.api}/file/bot${this.token}/${info.file_path}`);
    if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(ziel));
  }
}

export const html = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

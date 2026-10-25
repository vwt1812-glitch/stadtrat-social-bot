// Speichert den Stand jedes Videos in daten/auftraege.json,
// damit nach einem Neustart des Pi nichts verloren geht.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class Auftraege {
  constructor(datenDir) {
    this.dir = datenDir;
    this.datei = path.join(datenDir, "auftraege.json");
    fs.mkdirSync(datenDir, { recursive: true });
    this.alle = fs.existsSync(this.datei) ? JSON.parse(fs.readFileSync(this.datei, "utf8")) : {};
  }

  speichern() {
    const tmp = `${this.datei}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.alle, null, 2));
    fs.renameSync(tmp, this.datei);
  }

  neu(chatId) {
    const id = crypto.randomBytes(4).toString("hex");
    const ordner = path.join(this.dir, "auftraege", id);
    fs.mkdirSync(ordner, { recursive: true });
    this.alle[id] = { id, chatId, ordner, status: "neu", erstellt: new Date().toISOString() };
    this.speichern();
    return this.alle[id];
  }

  get(id) {
    return this.alle[id];
  }

  aendern(id, felder) {
    const a = this.alle[id];
    // Die nächste freie Textnachricht darf nur zu einem Dialog dieses Chats gehören.
    if (felder.wartetAuf) {
      for (const andere of Object.values(this.alle)) {
        if (andere.chatId === a.chatId && andere.id !== id) andere.wartetAuf = null;
      }
    }
    const textFelder = ["caption", "captionQuelle", "captions", "quellenkarte"];
    if (a.caption !== undefined && textFelder.some((k) => k in felder && JSON.stringify(a[k]) !== JSON.stringify(felder[k]))) {
      const stand = Object.fromEntries(textFelder.map((k) => [k, a[k] ?? null]));
      a.versionen = [...(a.versionen ?? []), { ...structuredClone(stand), zeit: new Date().toISOString() }].slice(-10);
    }
    Object.assign(a, felder, { geaendert: new Date().toISOString() });
    this.speichern();
    return a;
  }

  liste(chatId, archiviert = false) {
    return Object.values(this.alle).filter((a) => a.chatId === chatId && a.status === "vorschau" &&
      Boolean(a.archiviert) === archiviert).sort((a, b) => (b.geaendert ?? b.erstellt).localeCompare(a.geaendert ?? a.erstellt));
  }

  oeffnen(id) {
    const a = this.get(id);
    if (a.status !== "vorschau" || a.archiviert) throw new Error("Dieser Entwurf ist nicht verfügbar.");
    for (const andere of Object.values(this.alle)) {
      if (andere.chatId === a.chatId) andere.wartetAuf = null;
    }
    return this.aendern(id, { plan: a.postiz || a.postizUnklar || a.mastodon ? a.plan : null });
  }

  archivieren(id, archiviert = true) {
    const a = this.get(id);
    if (a.status !== "vorschau" || a.postiz || a.postizUnklar || a.mastodon) throw new Error("Dieser Auftrag kann nicht archiviert werden.");
    return this.aendern(id, { archiviert: archiviert ? new Date().toISOString() : null, wartetAuf: null, plan: null });
  }

  rueckgaengig(id) {
    const a = this.get(id);
    if (a.status !== "vorschau" || a.postiz || a.postizUnklar || a.mastodon || a.archiviert) throw new Error("Dieser Auftrag kann nicht zurückgesetzt werden.");
    const stand = a.versionen?.pop();
    if (!stand) return null;
    const { zeit, ...felder } = stand;
    Object.assign(a, felder, { plan: null, wartetAuf: null, geaendert: new Date().toISOString() });
    this.speichern();
    return a;
  }

  /** Auftrag in diesem Chat, der gerade auf eine Texteingabe wartet. */
  wartend(chatId) {
    return Object.values(this.alle).find((a) => a.chatId === chatId && a.status === "vorschau" && !a.archiviert && a.wartetAuf);
  }

  /** Fertige Aufträge nach einigen Tagen samt Videos löschen. */
  aufraeumen(tage = 14) {
    const grenze = Date.now() - tage * 86400e3;
    for (const a of Object.values(this.alle)) {
      if (!a.archiviert && ["gepostet", "geplant", "verworfen", "fehler"].includes(a.status) && Date.parse(a.erstellt) < grenze) {
        fs.rmSync(a.ordner, { recursive: true, force: true });
        delete this.alle[a.id];
      }
    }
    this.speichern();
  }
}

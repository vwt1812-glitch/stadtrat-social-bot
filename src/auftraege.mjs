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
    Object.assign(this.alle[id], felder);
    this.speichern();
    return this.alle[id];
  }

  /** Auftrag in diesem Chat, der gerade auf eine Texteingabe wartet. */
  wartend(chatId) {
    return Object.values(this.alle).find((a) => a.chatId === chatId && a.wartetAuf);
  }

  /** Fertige Aufträge nach einigen Tagen samt Videos löschen. */
  aufraeumen(tage = 14) {
    const grenze = Date.now() - tage * 86400e3;
    for (const a of Object.values(this.alle)) {
      if (["gepostet", "geplant", "verworfen", "fehler"].includes(a.status) && Date.parse(a.erstellt) < grenze) {
        fs.rmSync(a.ordner, { recursive: true, force: true });
        delete this.alle[a.id];
      }
    }
    this.speichern();
  }
}

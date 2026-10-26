// Echte Menünavigation ohne Rendern oder Veröffentlichen.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mock } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { Auftraege } from "../../src/auftraege.mjs";
import { Telegram } from "../../src/telegram.mjs";
import { Postiz } from "../../src/postiz.mjs";
import * as video from "../../src/video.mjs";

const [dir] = process.argv.slice(2);
Object.assign(process.env, { DATEN_DIR: dir, TELEGRAM_BOT_TOKEN: "test", ERLAUBTE_NUTZER: "123",
  POSTIZ_URL: "https://postiz.invalid", POSTIZ_API_KEY: "test", WHISPER_MODELL: "test",
  CAPTION_ANBIETER: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", MASTODON_TOKEN: "" });
const s = new Auftraege(dir), a = s.neu(123), medium = path.join(a.ordner, "video.mp4");
fs.writeFileSync(medium, "Video bleibt unverändert");
s.aendern(a.id, { art: "video", status: "vorschau", caption: "Beitragstext bleibt", medien: [medium],
  masse: { breite: 1080, hoehe: 1920, dauer: 5 }, quer: true, hochkant: true,
  storyDatei: medium, story: false, kanaele: ["ig", "ma"], menueNachricht: 1,
  thumbnail: { modus: "frame", frameMs: 0, mitText: true, text: "Titel", vorlage: "foto", quer: true, dateien: {} } });
const stand = () => JSON.parse(fs.readFileSync(path.join(dir, "auftraege.json"), "utf8"))[a.id];
let renderAufrufe = 0;
mock.module("../../src/video.mjs", { namedExports: { ...video, rendern: async () => {
  renderAufrufe++;
  throw new Error("Menünavigation darf nicht rendern");
} } });
mock.method(Postiz.prototype, "kanaele", async () => [
  { id: "ig", identifier: "instagram", name: "Instagram" }, { id: "ma", identifier: "mastodon", name: "Mastodon" },
]);
mock.method(globalThis, "fetch", async () => { throw new Error("Menünavigation darf nicht veröffentlichen"); });
let schritt = 0, nachricht = 1, menue;
const aktion = (wert) => ({ callback_query: { id: String(schritt), from: { id: 123 },
  message: { chat: { id: 123 } }, data: `a:${a.id}:${wert}` } });
const tasten = () => menue.reply_markup.inline_keyboard.flat();
const taste = (wert) => tasten().find((t) => t.callback_data === `a:${a.id}:${wert}`);
mock.method(Telegram.prototype, "aufruf", async (methode, params = {}) => {
  if (methode === "getMe") return { username: "test" };
  if (methode !== "getUpdates") {
    if (params.reply_markup?.inline_keyboard) menue = params;
    return { message_id: ++nachricht };
  }
  for (;;) {
    await pause(10);
    const b = stand();
    let update;
    if (schritt === 0) update = aktion("zurueck");
    if (schritt === 1 && menue) {
      assert.ok(taste("videoformat"));
      assert.equal(taste("quer"), undefined);
      assert.equal(taste("hochkant"), undefined);
      assert.ok(menue.reply_markup.inline_keyboard.every((r) => r.length <= 2));
      update = aktion("videoformat");
    }
    if (schritt === 2 && taste("quer")) {
      assert.match(taste("quer").text, /Originalformat/);
      assert.match(taste("hochkant").text, /Feedformat nutzen/);
      assert.match(menue.text, /Videoformat/);
      assert.equal(b.quer, true);
      assert.equal(b.hochkant, true);
      update = aktion("zurueck");
    }
    if (schritt === 3 && taste("thumb")) update = aktion("thumb");
    if (schritt === 4 && taste("thumbgrafik")) {
      assert.equal(taste("thumbshort"), undefined); // Kein YouTube-Kanal ausgewählt.
      assert.match(taste("thumbquer").text, /entfernen/);
      assert.match(taste("thumbstil").text, /Zur Textgrafik wechseln/);
      assert.match(menue.text, /Bild aus dem Video/);
      assert.ok(menue.reply_markup.inline_keyboard.every((r) => r.length === 1));
      update = aktion("thumbgrafik");
    }
    if (schritt === 5 && b.wartetAuf === "thumbnailText") {
      assert.equal(b.thumbnailTextModus, "text");
      update = aktion("zurueck");
    }
    if (schritt === 6 && !b.wartetAuf) update = aktion("thumboff");
    if (schritt === 7 && !b.thumbnail) update = aktion(`z:${Math.floor(Date.now() / 1000) + 3600}`);
    if (schritt === 8 && b.plan?.typ === "schedule") {
      assert.match(taste("ja").text, /Termin bestätigen/);
      update = aktion("zurueck");
    }
    if (schritt === 9 && !b.plan) update = aktion("jetzt");
    if (schritt === 10 && b.plan?.typ === "now") {
      assert.match(taste("ja").text, /Jetzt veröffentlichen/);
      assert.equal(b.caption, "Beitragstext bleibt");
      assert.equal(b.status, "vorschau");
      assert.equal(b.quer, true);
      assert.equal(renderAufrufe, 0);
      assert.equal(fs.readFileSync(medium, "utf8"), "Video bleibt unverändert");
      process.exit(0);
    }
    if (update) return [{ update_id: ++schritt, ...update }];
  }
});
setTimeout(() => { console.error("Menünavigation hängt", schritt, stand()); process.exit(1); }, 15000).unref();
await import("../../src/bot.mjs");

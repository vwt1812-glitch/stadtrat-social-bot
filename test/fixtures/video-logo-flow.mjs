import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mock } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { Auftraege } from "../../src/auftraege.mjs";
import { Telegram } from "../../src/telegram.mjs";
import { Postiz } from "../../src/postiz.mjs";
import * as video from "../../src/video.mjs";
import * as gesicht from "../../src/gesicht.mjs";

const [dir, modus] = process.argv.slice(2);
Object.assign(process.env, { DATEN_DIR: dir, TELEGRAM_BOT_TOKEN: "test", ERLAUBTE_NUTZER: "123",
  POSTIZ_URL: "https://postiz.invalid", POSTIZ_API_KEY: "test", WHISPER_MODELL: "test",
  CAPTION_ANBIETER: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", MASTODON_TOKEN: "" });
const s = new Auftraege(dir), a = s.neu(123);
const original = path.join(a.ordner, "original.mp4");
const srt = "1\n00:00:00,000 --> 00:00:01,000\nMein korrigierter Text\n";
fs.writeFileSync(original, "Originalvideo");
fs.writeFileSync(path.join(a.ordner, "untertitel.srt"), srt);
s.aendern(a.id, { art: "video", status: "vorschau", caption: "Caption bleibt", original,
  medien: [original], masse: { breite: 1080, hoehe: modus === "story" ? 1440 : 1920, dauer: 5 },
  hochkant: false, quer: modus === "quer", nurStory: modus === "story", story: true,
  kanaele: ["ig"], menueNachricht: 1, untertitelLage: "mitte", lageAutomatisch: false,
  hochgeladen: ["alt"], storyHochgeladen: "alt", plan: { typ: "now" } });
const stand = () => JSON.parse(fs.readFileSync(path.join(dir, "auftraege.json"), "utf8"))[a.id];
let scans = 0;
mock.module("../../src/gesicht.mjs", { namedExports: { ...gesicht,
  gesichtSuchen: async (quelle) => {
    assert.equal(quelle, original);
    scans++;
    return modus === "ohne-opencv" ? null : { bilder: 12,
      gesichter: Array.from({ length: 12 }, (_, t) => ({ t, x: 0.3, y: 0.28, w: 0.4, h: 0.44 })) };
  },
} });
const renders = [];
mock.module("../../src/video.mjs", { namedExports: { ...video,
  rendern: async (o) => {
    renders.push(o);
    if (modus === "fehler") throw new Error("Renderer ausgefallen");
    fs.writeFileSync(o.ausgabe, "Neue Fassung");
    assert.equal(o.eingabe, original);
    assert.match(fs.readFileSync(o.ass, "utf8"), /Mein korrigierter Text/);
  },
} });
mock.method(Postiz.prototype, "kanaele", async () => [{ id: "ig", identifier: "instagram", name: "Insta" }]);
mock.method(Telegram.prototype, "datei", async () => ({}));
mock.method(globalThis, "fetch", async () => { throw new Error("Kein Netzwerk im Test"); });
let schritt = 0, nachricht = 1, blockiert = false, menue = "";
const callback = (aktion) => ({ callback_query: { id: String(schritt), from: { id: 123 },
  message: { chat: { id: 123 } }, data: `a:${a.id}:${aktion}` } });
mock.method(Telegram.prototype, "aufruf", async (methode, params = {}) => {
  if (methode === "getMe") return { username: "test" };
  if (methode !== "getUpdates") {
    if (/Videofassung konnte/.test(params.text ?? "")) blockiert = true;
    if (params.reply_markup?.inline_keyboard) menue = JSON.stringify(params.reply_markup);
    return { message_id: ++nachricht };
  }
  for (;;) {
    await pause(10);
    const b = stand();
    let update;
    if (schritt === 0) update = callback("logo"); // alter Entwurf ohne mitLogo
    if (schritt === 1 && b.status === "vorschau") {
      assert.equal(b.mitLogo, false);
      assert.equal(scans, 1);
      assert.equal(b.plan, null);
      assert.equal(b.hochgeladen, null);
      assert.equal(b.storyHochgeladen, null);
      assert.equal(b.caption, "Caption bleibt");
      assert.ok(renders.every((r) => r.layout.logo === null));
      if (modus === "fehler") {
        assert.equal(b.videoFormatFehler, true);
        update = callback("jetzt");
      } else {
        assert.equal(b.videoFormatFehler, false);
        assert.match(menue, /Logo hinzufügen/);
        assert.equal(b.untertitelLage, modus === "ohne-opencv" ? null : "logobereich");
        if (modus !== "nativ" && modus !== "ohne-opencv") assert.ok(b.storyDatei);
        update = callback("logo");
      }
    }
    if (schritt === 2 && modus === "fehler" && blockiert) process.exit(0);
    if (schritt === 2 && modus !== "fehler" && b.status === "vorschau") {
      assert.equal(b.mitLogo, true);
      assert.equal(scans, 2);
      assert.notEqual(b.untertitelLage, "logobereich");
      assert.ok(renders.at(-1).layout.logo);
      assert.match(menue, /Logo entfernen/);
      assert.equal(fs.readFileSync(original, "utf8"), "Originalvideo");
      assert.equal(fs.readFileSync(path.join(a.ordner, "untertitel.srt"), "utf8"), srt);
      process.exit(0);
    }
    if (update) return [{ update_id: ++schritt, ...update }];
  }
});
setTimeout(() => { console.error("Logoworkflow hängt", schritt, stand()); process.exit(1); }, 15000).unref();
await import("../../src/bot.mjs");

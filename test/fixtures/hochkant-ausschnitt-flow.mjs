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

const [dir] = process.argv.slice(2);
Object.assign(process.env, { DATEN_DIR: dir, TELEGRAM_BOT_TOKEN: "test", ERLAUBTE_NUTZER: "123",
  POSTIZ_URL: "https://postiz.invalid", POSTIZ_API_KEY: "test", WHISPER_MODELL: "test",
  CAPTION_ANBIETER: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", MASTODON_TOKEN: "" });
const s = new Auftraege(dir), a = s.neu(123);
const original = path.join(a.ordner, "original.mp4");
fs.writeFileSync(original, "Originalvideo");
fs.writeFileSync(path.join(a.ordner, "untertitel.srt"), "");
s.aendern(a.id, { art: "video", status: "vorschau", caption: "Caption bleibt", original,
  medien: [original], masse: { breite: 1920, hoehe: 1080, dauer: 5 }, hochkant: false,
  story: false, kanaele: ["ig"], menueNachricht: 1, untertitelAuto: true,
  hochkantFunde: { bilder: 24, alleGesichter: true, gesichter: [] } });
const stand = () => JSON.parse(fs.readFileSync(path.join(dir, "auftraege.json"), "utf8"))[a.id];
const renders = [], captions = [];
let pruefungen = 0;
mock.module("../../src/video.mjs", { namedExports: { ...video,
  rendern: async (o) => { renders.push(o); fs.writeFileSync(o.ausgabe, "Neue Fassung"); },
} });
mock.module("../../src/gesicht.mjs", { namedExports: { ...gesicht,
  gesichtSuchen: async (datei, optionen, bilder) => {
    assert.equal(datei, original);
    assert.equal(optionen.alleGesichter, true);
    assert.equal(bilder, 24);
    pruefungen++;
    const zeiten = Array.from({ length: bilder }, (_, i) => Math.round(i * 5 / 23 * 10000) / 10000);
    return { bilder, version: 2, zeiten, alleGesichter: true, gesichter: zeiten.map((t) =>
      ({ t, x: 0.65, y: 0.25, w: 0.09, h: 0.17 })) };
  },
} });
mock.method(Postiz.prototype, "kanaele", async () => [{ id: "ig", identifier: "instagram", name: "Insta" }]);
mock.method(Telegram.prototype, "datei", async (...args) => { captions.push(args[4]?.caption); return {}; });
mock.method(globalThis, "fetch", async () => { throw new Error("Kein Netzwerk im Test"); });
let schritt = 0;
mock.method(Telegram.prototype, "aufruf", async (methode) => {
  if (methode === "getMe") return { username: "test" };
  if (methode !== "getUpdates") return { message_id: 1 };
  for (;;) {
    await pause(10);
    const b = stand();
    if (schritt > 0 && (b.status !== "vorschau" || renders.length < schritt)) continue;
    if (schritt > 0) {
      const crop = schritt !== 2;
      assert.equal(Boolean(renders.at(-1).layout.ausschnitt), crop);
      assert.equal(Boolean(b.hochkantAusschnitt), crop);
      assert.match(captions.at(-1), crop ? /automatischer Ausschnitt/i : /vollständiges Bild/i);
      assert.equal(b.caption, "Caption bleibt");
      assert.equal(pruefungen, 1);
      assert.equal(fs.readFileSync(original, "utf8"), "Originalvideo");
    }
    if (schritt === 3) process.exit(0);
    const aktion = schritt++ === 0 ? "hochkant" : "ausschnitt";
    return [{ update_id: schritt, callback_query: { id: String(schritt), from: { id: 123 },
      message: { chat: { id: 123 } }, data: `a:${a.id}:${aktion}` } }];
  }
});
setTimeout(() => { console.error("Ausschnittworkflow hängt", schritt, stand()); process.exit(1); }, 15000).unref();
await import("../../src/bot.mjs");

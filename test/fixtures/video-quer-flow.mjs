import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mock } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { Auftraege } from "../../src/auftraege.mjs";
import { Telegram } from "../../src/telegram.mjs";
import { Postiz } from "../../src/postiz.mjs";
import * as video from "../../src/video.mjs";

const [dir, modus] = process.argv.slice(2);
Object.assign(process.env, { DATEN_DIR: dir, TELEGRAM_BOT_TOKEN: "test", ERLAUBTE_NUTZER: "123",
  POSTIZ_URL: "https://postiz.invalid", POSTIZ_API_KEY: "test", WHISPER_MODELL: "test",
  CAPTION_ANBIETER: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", MASTODON_TOKEN: "" });
const s = new Auftraege(dir), a = s.neu(123);
const original = path.join(a.ordner, "original.mp4");
fs.writeFileSync(original, "Originalvideo");
fs.writeFileSync(path.join(a.ordner, "untertitel.srt"), "");
s.aendern(a.id, { art: "video", status: "vorschau", caption: "Caption bleibt", original,
  medien: [original], masse: { breite: 1080, hoehe: 1920, dauer: 5 }, hochkant: false,
  story: false, kanaele: ["ig", "yt"], menueNachricht: 1,
  untertitelLage: "oben", lageAutomatisch: true,
  plan: { typ: "now", zeit: new Date().toISOString() } });
const stand = () => JSON.parse(fs.readFileSync(path.join(dir, "auftraege.json"), "utf8"))[a.id];
const renders = [];
mock.module("../../src/video.mjs", { namedExports: { ...video,
  rendern: async (o) => {
    renders.push(o);
    if (modus === "fehler") throw new Error("Test: Renderer ausgefallen");
    fs.writeFileSync(o.ausgabe, "Neue Fassung");
  },
} });
mock.method(Postiz.prototype, "kanaele", async () => [
  { id: "ig", identifier: "instagram", name: "Insta" }, { id: "yt", identifier: "youtube", name: "YouTube" },
]);
const vorschauen = [];
mock.method(Telegram.prototype, "datei", async (...args) => { vorschauen.push(args); return {}; });
mock.method(globalThis, "fetch", async () => { throw new Error("Kein Netzwerk im Test"); });
let schritt = 0, nachricht = 1, blockiert = false;
const callback = (aktion) => ({ callback_query: { id: String(schritt), from: { id: 123 },
  message: { chat: { id: 123 } }, data: `a:${a.id}:${aktion}` } });
mock.method(Telegram.prototype, "aufruf", async (methode, params = {}) => {
  if (methode === "getMe") return { username: "test" };
  if (methode !== "getUpdates") {
    if (/Videofassung konnte/.test(params.text ?? "")) blockiert = true;
    return { message_id: ++nachricht };
  }
  for (;;) {
    await pause(10);
    const b = stand();
    let update;
    if (schritt === 0) update = callback("quer");
    if (schritt === 1 && b.status === "vorschau") {
      assert.equal(b.quer, true);
      assert.equal(b.plan, null);
      assert.equal(b.caption, "Caption bleibt");
      assert.equal(fs.readFileSync(original, "utf8"), "Originalvideo");
      if (modus === "fehler") {
        assert.equal(b.videoFormatFehler, true);
        update = callback("jetzt");
      } else {
        assert.equal(b.videoFormatFehler, false);
        assert.equal(renders[0].quer, true);
        assert.deepEqual([renders[0].masse.breite, renders[0].masse.hoehe], [1920, 1080]);
        const hochkant = renders.find((r) => r.masse.hoehe === 1920);
        assert.ok(hochkant);
        assert.equal(hochkant.story, false);
        assert.equal(hochkant.layout.logo, renders[0].layout.logo);
        assert.equal(hochkant.layout.lage, "oben");
        assert.equal(renders[0].layout.lage, null);
        assert.equal(b.untertitelLage, "oben");
        assert.equal(b.lageAutomatisch, true);
        assert.ok(b.storyDatei);
        assert.ok(vorschauen.some((v) => v[4]?.width === "1920" && v[4]?.height === "1080"));
        update = callback("quer");
      }
    }
    if (schritt === 2 && modus === "fehler" && blockiert) { assert.equal(b.plan, null); process.exit(0); }
    if (schritt === 2 && modus !== "fehler" && b.status === "vorschau" && !b.quer) {
      assert.equal(b.hochkant, false);
      assert.equal(b.storyDatei, null);
      assert.deepEqual([renders.at(-1).masse.breite, renders.at(-1).masse.hoehe], [1080, 1920]);
      process.exit(0);
    }
    if (update) return [{ update_id: ++schritt, ...update }];
  }
});
setTimeout(() => { console.error("Formatworkflow hängt", schritt, stand()); process.exit(1); }, 15000).unref();
await import("../../src/bot.mjs");

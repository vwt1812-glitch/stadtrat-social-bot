// Echte Telegram-Handler und Dateispeicherung, sämtliche externen Aufrufe simuliert.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mock } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { Auftraege } from "../../src/auftraege.mjs";
import { Telegram } from "../../src/telegram.mjs";
import { Postiz } from "../../src/postiz.mjs";
import * as thumbnailOriginal from "../../src/thumbnail.mjs";
import * as videoOriginal from "../../src/video.mjs";

const [dir, szenario] = process.argv.slice(2);
Object.assign(process.env, {
  DATEN_DIR: dir, TELEGRAM_BOT_TOKEN: "test", ERLAUBTE_NUTZER: "123",
  POSTIZ_URL: "https://postiz.invalid", POSTIZ_API_KEY: "test", WHISPER_MODELL: "test",
  CAPTION_ANBIETER: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", MASTODON_TOKEN: "",
});
const s = new Auftraege(dir), a = s.neu(123);
const foto = path.join(a.ordner, "foto.jpg");
fs.writeFileSync(foto, "test");
s.aendern(a.id, { art: szenario === "thumbnail" ? "video" : "foto", status: "vorschau", caption: "Original", captions: { ig: "Eigene Fassung" },
  medien: [foto], originale: [foto], hochgeladen: [{ id: "m", path: "/foto.jpg" }],
  story: szenario !== "archiv", kunde: "kunde", kanaele: ["ig"], menueNachricht: 1,
  quellenkarte: { sha256: "hash", stand: "ungeprüft" },
  ...(szenario === "thumbnail" ? { plan: { typ: "now", zeit: new Date().toISOString() } } : {}),
});
const stand = () => JSON.parse(fs.readFileSync(path.join(dir, "auftraege.json"), "utf8"))[a.id];
if (szenario === "thumbnail") mock.module("../../src/video.mjs", { namedExports: {
  ...videoOriginal, untersuche: async () => ({ breite: 1080, hoehe: 1920, dauer: 10 }),
} });
mock.module("../../src/thumbnail.mjs", { namedExports: {
  ...thumbnailOriginal,
  thumbnailsErstellen: async ({ optionen }) => ({ ...optionen, dateien: { original: foto, hochkant: foto }, hochgeladen: {},
    videoStand: await thumbnailOriginal.videoStand(foto) }),
} });
mock.method(Telegram.prototype, "herunterladen", async (_, ziel) => { fs.writeFileSync(ziel, "neues Cover"); });
const callback = (aktion, prefix = "a") => ({ callback_query: {
  id: String(schritt), from: { id: 123 }, message: { chat: { id: 123 } },
  data: prefix === "a" ? `a:${a.id}:${aktion}` : `d:${aktion}:${a.id}`,
} });
const text = (inhalt) => ({ message: { from: { id: 123 }, chat: { id: 123, type: "private" }, text: inhalt } });
mock.method(Postiz.prototype, "kanaele", async () => [{ id: "ig", identifier: "instagram", name: "Insta", customer: { id: "kunde", name: "Kunde" } }]);
const teile = [];
mock.method(globalThis, "fetch", async (url, o) => {
  assert.equal(String(url), "https://postiz.invalid/api/public/v1/posts");
  const body = JSON.parse(o.body);
  const teil = body.posts[0].settings.post_type === "story" ? "story" : "post";
  teile.push(teil);
  if (szenario === "unklar") throw new Error("Verbindung abgebrochen");
  if (teile.length === 2) return new Response("Story ungültig", { status: 422 });
  return new Response(JSON.stringify([{ postId: teil }]));
});
let schritt = 0, nachrichten = 1, blockiert = false;
mock.method(Telegram.prototype, "aufruf", async (methode, params = {}) => {
  if (methode === "getMe") return { username: "test" };
  if (methode !== "getUpdates") {
    if (methode === "answerCallbackQuery" && /bereits begonnen/.test(params.text ?? "")) blockiert = true;
    return { message_id: ++nachrichten };
  }
  for (;;) {
    await pause(10);
    const b = stand();
    let update;
    if (szenario === "thumbnail") {
      if (schritt === 0) update = callback("thumbtext");
      if (schritt === 1 && b.wartetAuf === "thumbnailText") update = text("Eigener Titel");
      if (schritt === 2 && b.thumbnail?.text === "Eigener Titel" && b.status === "vorschau") update = callback("thumbbild");
      if (schritt === 3 && b.wartetAuf === "thumbnailBild") update = { message: { from: { id: 123 }, chat: { id: 123, type: "private" },
        photo: [{ file_id: "cover-bild", file_size: 100 }] } };
      if (schritt === 4 && b.thumbnail?.modus === "bild" && b.status === "vorschau") {
        assert.equal(b.caption, "Original");
        assert.equal(b.plan, null);
        assert.equal(b.art, "video");
        assert.deepEqual(b.medien, [foto]);
        assert.equal(Object.keys(new Auftraege(dir).alle).length, 1);
        assert.ok(b.thumbnail.bild.endsWith(".jpg"));
        assert.equal(teile.length, 0);
        process.exit(0);
      }
    } else if (szenario === "archiv") {
      if (schritt === 0) update = callback("quelltext");
      if (schritt === 1 && b.wartetAuf === "quelle") update = text("Titel: Testquelle\nStand: eingereicht\nStanddatum: 2026-10-25\nBeleg: Eingangsnachweis");
      if (schritt === 2 && b.quellenkarte.titel === "Testquelle" && !b.wartetAuf) update = callback("caption");
      if (schritt === 3 && b.wartetAuf === "caption") update = text("Bearbeitet");
      if (schritt === 4 && b.caption === "Bearbeitet" && !b.wartetAuf) update = callback("undo");
      if (schritt === 5 && b.caption === "Original") {
        assert.deepEqual(b.captions, { ig: "Eigene Fassung" });
        update = callback("archiv");
      }
      if (schritt === 6 && b.archiviert) update = callback("wieder", "d");
      if (schritt === 7 && !b.archiviert) {
        const nachNeustart = new Auftraege(dir).get(a.id);
        assert.equal(nachNeustart.caption, "Original");
        assert.equal(nachNeustart.quellenkarte.titel, "Testquelle");
        assert.equal(nachNeustart.quellenkarte.sha256, "hash");
        assert.deepEqual(nachNeustart.medien, [foto]);
        assert.equal(nachNeustart.kunde, "kunde");
        assert.equal(nachNeustart.plan, null);
        assert.equal(teile.length, 0);
        process.exit(0);
      }
    } else {
      if (schritt === 0) update = callback("jetzt");
      if (schritt === 1 && b.plan) update = callback("ja");
      if (schritt === 2 && b.status === "vorschau" && (b.postiz?.post || b.postizUnklar)) update = callback("ja");
      if (schritt === 3 && blockiert) {
        assert.deepEqual(teile, szenario === "unklar" ? ["post"] : ["post", "story"]);
        if (szenario === "unklar") {
          assert.equal(new Auftraege(dir).get(a.id).postizUnklar, "post");
          // Ein Klick auf Weiter ist ebenfalls wirkungslos, solange die Antwort unklar ist.
          update = callback("weiter");
        } else update = callback("weiter");
      }
      if (schritt === 4 && szenario === "unklar" && b.status === "vorschau") {
        assert.deepEqual(teile, ["post"]);
        process.exit(0);
      }
      if (schritt === 4 && szenario !== "unklar" && b.status === "gepostet") {
        assert.deepEqual(teile, ["post", "story", "story"]);
        assert.deepEqual(b.postiz, { post: [{ postId: "post" }], story: [{ postId: "story" }] });
        assert.equal(b.postizFertig, true);
        process.exit(0);
      }
    }
    if (update) return [{ update_id: ++schritt, ...update }];
  }
});
setTimeout(() => { console.error("Workflow timed out", szenario, schritt, stand()); process.exit(1); }, 12000).unref();
await import("../../src/bot.mjs");

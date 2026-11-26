// Isolated bot process: real Telegram handlers and persisted jobs, mocked external I/O.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mock } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { Auftraege } from "../../src/auftraege.mjs";
import { Telegram } from "../../src/telegram.mjs";
import { Postiz } from "../../src/postiz.mjs";
import { ausgewogeneZeilen, logoFuerGrafik } from "../../src/grafik-text.mjs";

const [datenDir, aktion, format] = process.argv.slice(2);
Object.assign(process.env, {
  DATEN_DIR: datenDir, TELEGRAM_BOT_TOKEN: "test", ERLAUBTE_NUTZER: "123",
  POSTIZ_URL: "https://postiz.invalid", POSTIZ_API_KEY: "test", WHISPER_MODELL: "test",
  CAPTION_ANBIETER: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", MASTODON_TOKEN: "",
});
const original = "Wieder macht die CSU sehr dumme Dinge.";
const bearbeitet = "Mal wieder macht die CSU sehr dumme Dinge.";
const speicher = new Auftraege(datenDir);
const auftrag = speicher.neu(123);
speicher.aendern(auftrag.id, {
  art: "text", status: "vorschau", medien: [], menueNachricht: 1,
  transkript: original, notizen: original, caption: original, captionQuelle: "transkript",
});
const stand = () => JSON.parse(fs.readFileSync(path.join(datenDir, "auftraege.json"), "utf8"))[auftrag.id];
let gerendert = false;
mock.module("../../src/grafik-text.mjs", { namedExports: {
  ausgewogeneZeilen, logoFuerGrafik,
  textGrafik: async () => { throw new Error("Unexpected thumbnail rendering"); },
  textAnimation: async ({ inhalt, format: ziel, layout }) => {
    if (stand().mitLogo) assert.ok(layout.logo);
    else assert.equal(layout.logo, null);
    assert.equal(aktion, "anim");
    assert.equal(ziel, format);
    assert.equal(inhalt.titel, bearbeitet);
    gerendert = true;
  },
  textGrafiken: async ({ text, layout }) => {
    if (stand().mitLogo) assert.ok(layout.logo);
    else assert.equal(layout.logo, null);
    assert.equal(aktion, "grafik");
    assert.equal(text, bearbeitet);
    gerendert = true;
    return { post: "post.jpg", story: "story.jpg", gekuerzt: false };
  },
} });
mock.method(Postiz.prototype, "kanaele", async () => [{ id: "test", name: "Test", identifier: "facebook" }]);
mock.method(Telegram.prototype, "datei", async () => ({}));
mock.method(Telegram.prototype, "fotos", async () => ({}));
let schritt = 0;
let nachrichten = 1;
const callback = (aktion) => ({ callback_query: {
  id: String(schritt), from: { id: 123 }, message: { chat: { id: 123 } },
  data: `a:${auftrag.id}:${aktion}`,
} });
mock.method(Telegram.prototype, "aufruf", async (methode) => {
  if (methode === "getMe") return { username: "test" };
  if (methode !== "getUpdates") return { message_id: ++nachrichten };
  for (;;) {
    const a = stand();
    let update;
    if (schritt === 0) update = callback("caption");
    if (schritt === 1 && a.wartetAuf === "caption") update = {
      message: { from: { id: 123 }, chat: { id: 123, type: "private" }, text: bearbeitet },
    };
    if (schritt === 2 && a.caption === bearbeitet && !a.wartetAuf) update = callback(`${aktion}:${format}`);
    if (schritt === 3 && a.grafikModus === format && a.status === "vorschau") {
      assert.ok(gerendert);
      assert.equal(a.grafikQuelleText, bearbeitet);
      assert.equal(a.caption, bearbeitet);
      assert.equal(a.transkript, original);
      assert.equal(a.notizen, original);
      assert.equal(a.nurStory, format === "story");
      assert.equal(a.grafikAnimation, aktion === "anim");
      assert.equal(a.mitLogo, false);
      update = callback("logo");
    }
    if (schritt === 4 && a.status === "vorschau") {
      assert.equal(a.mitLogo, true);
      assert.deepEqual(a.kanaele, ["test"]);
      assert.deepEqual(a.captions, {});
      assert.equal(a.caption, bearbeitet);
      update = callback("logo");
    }
    if (schritt === 5 && a.status === "vorschau") {
      assert.equal(a.mitLogo, false);
      process.exit(0);
    }
    if (schritt === 3 && aktion === "idee") {
      const ideenDatei = path.join(datenDir, "ideen.json");
      if (fs.existsSync(ideenDatei)) {
        const ideen = JSON.parse(fs.readFileSync(ideenDatei, "utf8"));
        assert.equal(ideen[0].text, bearbeitet);
        process.exit(0);
      }
    }
    if (update) return [{ update_id: ++schritt, ...update }];
    await pause(5);
  }
});
// Any unexpected request must fail instead of contacting a service.
mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
setTimeout(() => { console.error("Bot workflow timed out", stand()); process.exit(1); }, 8000).unref();
await import("../../src/bot.mjs");

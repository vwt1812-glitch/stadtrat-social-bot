import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mock } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { Telegram } from "../../src/telegram.mjs";
import { Postiz } from "../../src/postiz.mjs";
import * as video from "../../src/video.mjs";
import * as gesicht from "../../src/gesicht.mjs";
const [dir, modus] = process.argv.slice(2);
Object.assign(process.env, { DATEN_DIR: dir, TELEGRAM_BOT_TOKEN: "test", ERLAUBTE_NUTZER: "123",
  POSTIZ_URL: "https://postiz.invalid", POSTIZ_API_KEY: "test", WHISPER_MODELL: "test",
  CAPTION_ANBIETER: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", MASTODON_TOKEN: "",
  LOGO_AUF_FOTOS: "ja" });
const renders = [];
mock.module("../../src/video.mjs", { namedExports: { ...video,
  untersuche: async () => ({ breite: 1080, hoehe: 1920, dauer: 5, hatTon: false }),
  rendern: async (o) => { renders.push(Boolean(o.layout.logo)); fs.writeFileSync(o.ausgabe, "Video"); },
  fotoRendern: async (o) => { renders.push(o.mitLogo); fs.writeFileSync(o.ausgabe, "Foto"); },
} });
mock.module("../../src/gesicht.mjs", { namedExports: { ...gesicht, gesichtSuchen: async () => null } });
mock.method(Postiz.prototype, "kanaele", async () => []);
mock.method(Telegram.prototype, "herunterladen", async (_, ziel) => fs.writeFileSync(ziel, "Original"));
mock.method(Telegram.prototype, "datei", async () => ({}));
mock.method(Telegram.prototype, "fotos", async () => ({}));
let schritt = 0, nachricht = 0;
const stand = () => {
  const datei = path.join(dir, "auftraege.json");
  return fs.existsSync(datei) ? Object.values(JSON.parse(fs.readFileSync(datei, "utf8"))).at(-1) : null;
};
mock.method(Telegram.prototype, "aufruf", async (methode) => {
  if (methode === "getMe") return { username: "test" };
  if (methode !== "getUpdates") return { message_id: ++nachricht };
  for (;;) {
    const a = stand();
    if (schritt === 0) {
      schritt++;
      const msg = { from: { id: 123 }, chat: { id: 123 }, message_id: 1, caption: "Eigener Beitrag" };
      if (modus === "video") msg.video = { file_id: "video", file_size: 10 };
      else msg.photo = [{ file_id: "foto", file_size: 10, width: 100, height: 100 }];
      if (modus === "album") return [1, 2].map((i) => ({ update_id: i, message: { ...msg, message_id: i, media_group_id: "album" } }));
      return [{ update_id: 1, message: msg }];
    }
    if (schritt === 1 && a?.status === "vorschau") {
      assert.equal(a.mitLogo, false);
      assert.ok(renders.length && renders.every((v) => v === false));
      schritt++;
      return [{ update_id: 3, callback_query: { id: "logo", from: { id: 123 },
        message: { chat: { id: 123 } }, data: `a:${a.id}:logo` } }];
    }
    if (schritt === 2 && a?.status === "vorschau" && a.mitLogo === true && renders.at(-1) === true) process.exit(0);
    await pause(10);
  }
});
setTimeout(() => { console.error("Neuer Logoentwurf hängt", stand()); process.exit(1); }, 20000).unref();
await import("../../src/bot.mjs");

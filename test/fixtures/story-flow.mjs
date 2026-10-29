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
const original = path.join(a.ordner, "fertig.mp4");
const facebook = modus.startsWith("facebook");
const gemischt = modus.startsWith("gemischt");
const nurStory = modus !== "feed";
const storyDatei = modus === "feed" || modus.endsWith("fassung") ? path.join(a.ordner, "story.mp4") : null;
fs.writeFileSync(original, "Video");
if (storyDatei) fs.writeFileSync(storyDatei, "Story-Fassung");
s.aendern(a.id, { art: "video", status: "vorschau", caption: "Caption", medien: [original],
  masse: { breite: 1920, hoehe: 1080, dauer: 125 }, hochkant: modus === "feed", story: true,
  nurStory, storyDatei, kanaele: facebook ? ["fb"] : gemischt ? ["ig", "fb"] : ["ig"], menueNachricht: 1,
  plan: { typ: "now", zeit: new Date().toISOString() } });
const stand = () => JSON.parse(fs.readFileSync(path.join(dir, "auftraege.json"), "utf8"))[a.id];
const uploads = [], bodies = [];
mock.module("../../src/video.mjs", { namedExports: { ...video,
  untersuche: async (datei) => ({ breite: 1080, hoehe: 1920, dauer: /story-teil/.test(datei) ? 59 : 125 }),
  ausfuehren: async (_, args) => { fs.writeFileSync(args.at(-1), "Clip"); },
} });
mock.method(Postiz.prototype, "kanaele", async () => [{ id: "ig", identifier: "instagram", name: "Insta" }, { id: "fb", identifier: "facebook", name: "Facebook" }]);
mock.method(Postiz.prototype, "hochladen", async (datei) => {
  uploads.push(path.basename(datei));
  return { id: path.basename(datei), path: `/${path.basename(datei)}` };
});
mock.method(globalThis, "fetch", async (_, o) => {
  const body = JSON.parse(o.body); bodies.push(body);
  return new Response(JSON.stringify(body.posts.map((_, i) => ({ postId: `p${bodies.length}-${i}` }))));
});
let gestartet = false, nachricht = 1;
mock.method(Telegram.prototype, "aufruf", async (methode) => {
  if (methode === "getMe") return { username: "test" };
  if (methode !== "getUpdates") return { message_id: ++nachricht };
  if (!gestartet) {
    gestartet = true;
    return [{ update_id: 1, callback_query: { id: "1", from: { id: 123 },
      message: { chat: { id: 123 } }, data: `a:${a.id}:ja` } }];
  }
  for (;;) {
    await pause(10);
    const b = stand();
    if (b.status !== "gepostet") continue;
    const storyBodies = bodies.filter((body) => body.posts[0].settings.post_type === "story");
    const facebookPosts = storyBodies.flatMap((body) => body.posts.filter((p) => p.integration.id === "fb"));
    const instagramPosts = storyBodies.flatMap((body) => body.posts.filter((p) => p.integration.id === "ig"));
    if (facebook || gemischt) {
      assert.equal(facebookPosts.length, 1);
      assert.equal(facebookPosts[0].value[0].image[0].id, storyDatei ? "story.mp4" : "fertig.mp4");
    }
    if (facebook) {
      assert.equal(b.storyClips, undefined);
      assert.deepEqual(uploads, [storyDatei ? "story.mp4" : "fertig.mp4"]);
      assert.equal(bodies.length, 1);
      assert.equal(instagramPosts.length, 0);
    } else {
      assert.equal(b.storyClips.hochgeladen.length, 3);
      assert.equal(bodies.length, nurStory ? 3 : 4);
      assert.deepEqual(instagramPosts.map((p) => p.value[0].image[0].id),
        ["story-teil-1.mp4", "story-teil-2.mp4", "story-teil-3.mp4"]);
      assert.equal(uploads.length, nurStory ? (gemischt ? 4 : 3) : 5);
      if (!nurStory) assert.equal(bodies[0].posts[0].value[0].image[0].id, "story.mp4");
      assert.ok(b.postiz.story3[0].postId);
    }
    process.exit(0);
  }
});
setTimeout(() => { console.error("Story-Workflow hängt", stand()); process.exit(1); }, 10000).unref();
await import("../../src/bot.mjs");

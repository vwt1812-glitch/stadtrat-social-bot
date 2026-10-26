import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { THUMBNAIL_PROFILE, originalProfil, thumbnailZiel, frameZeit, coverBedarf, thumbnailsErstellen, jpegProfil } from "../src/thumbnail.mjs";
import { untersuche, ausfuehren } from "../src/video.mjs";
import { Postiz } from "../src/postiz.mjs";
import { ladeConfig } from "../src/config.mjs";
import { grafikGeometrie } from "../src/grafik-text.mjs";

test("Mobile Cover behalten Titel und Logo auch im mittigen Quadrat", () => {
  assert.equal(THUMBNAIL_PROFILE.hochkant.format, "cover-hochkant");
  assert.equal(THUMBNAIL_PROFILE["youtube-short"].format, "cover-hochkant");
  assert.equal(originalProfil({ breite: 1080, hoehe: 1920 }).format, "cover-hochkant");
  for (const titelHoehe of [230, 460, 600]) {
    const p = grafikGeometrie({ format: "cover-hochkant", titelHoehe, textHoehe: 136, logoHoehe: 92 });
    assert.ok(p.titelY >= 420);
    assert.ok(p.logoUnten <= 1500);
    assert.ok(p.logoY > p.titelY + titelHoehe + 136);
  }
  assert.equal(grafikGeometrie({ format: "cover-hochkant", titelHoehe: 900, textHoehe: 136, logoHoehe: 92 }), null);
});

test("Mastodon bleibt trotz alter Direkt-Tokens standardmäßig bei Postiz", (t) => {
  const werte = { TELEGRAM_BOT_TOKEN: "test", POSTIZ_URL: "https://postiz.invalid", POSTIZ_API_KEY: "test",
    WHISPER_MODELL: "test", CAPTION_ANBIETER: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "",
    MASTODON_URL: "https://mastodon.invalid", MASTODON_TOKEN: "test", MASTODON_ANBINDUNG: "", POSTIZ_MASTODON_THUMBNAILS: "nein" };
  const vorher = Object.fromEntries(Object.keys(werte).map((k) => [k, process.env[k]]));
  t.after(() => { for (const [k, v] of Object.entries(vorher)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  Object.assign(process.env, werte);
  assert.equal(ladeConfig().mastodon, null);
  assert.equal(ladeConfig().postiz.mastodonThumbnails, false);
  process.env.MASTODON_ANBINDUNG = "direkt";
  assert.equal(ladeConfig().mastodon.url, werte.MASTODON_URL);
  process.env.MASTODON_ANBINDUNG = "falsch";
  assert.throws(() => ladeConfig(), /MASTODON_ANBINDUNG/);
});

test("Coverprofile unterscheiden Empfehlung, konservatives Dateilimit und natives Seitenverhältnis", () => {
  assert.deepEqual([THUMBNAIL_PROFILE.hochkant.breite, THUMBNAIL_PROFILE.hochkant.hoehe], [1080, 1920]);
  assert.deepEqual([THUMBNAIL_PROFILE.youtube.breite, THUMBNAIL_PROFILE.youtube.hoehe], [3840, 2160]);
  assert.deepEqual([THUMBNAIL_PROFILE["youtube-short"].breite, THUMBNAIL_PROFILE["youtube-short"].hoehe], [2160, 3840]);
  assert.deepEqual([originalProfil({ breite: 640, hoehe: 360 }).breite, originalProfil({ breite: 640, hoehe: 360 }).hoehe], [1920, 1080]);
  assert.equal(originalProfil({ breite: 1080, hoehe: 1080 }).hoehe, 1920);
  for (const p of Object.values(THUMBNAIL_PROFILE)) assert.equal(p.maxBytes, 2 * 1024 ** 2);
});

test("Unbestätigte Kanäle bleiben Export; Mastodon verlangt expliziten Postiz-Patch", () => {
  for (const identifier of ["facebook", "x", "bluesky", "mastodon", "mastodon-direkt"]) {
    assert.equal(thumbnailZiel({ identifier }, { modus: "text" }).bild, false);
  }
  assert.equal(thumbnailZiel({ identifier: "mastodon" }, {}, true).bild, true);
  assert.equal(thumbnailZiel({ identifier: "youtube" }, { youtubeShort: true }).bild, false);
  assert.equal(thumbnailZiel({ identifier: "tiktok" }, { modus: "frame" }).zeit, true);
  assert.equal(thumbnailZiel({ identifier: "tiktok" }, { modus: "bild" }).zeit, false);
});

test("Framezeiten validieren auch Null, Dezimalkomma und Videoende", () => {
  assert.equal(frameZeit("0", 10), 0);
  assert.equal(frameZeit("01:02.5", 90), 62500);
  assert.equal(frameZeit("3,5", 90), 3500);
  for (const s of ["-1", "10", "00:60", "Infinity", "3; rm", "0.0001"]) assert.throws(() => frameZeit(s, 10));
});

test("Coveruploads werden pro Profil geteilt und nach Bestätigung nicht neu gezählt", () => {
  const kanaele = ["instagram", "instagram-standalone", "youtube", "mastodon"].map((identifier) => ({ identifier }));
  const t = { dateien: { hochkant: "ig.jpg", youtube: "yt.jpg", original: "native.jpg" }, hochgeladen: {} };
  assert.equal(coverBedarf(t, kanaele), 2);
  assert.equal(coverBedarf(t, kanaele, true), 3);
  assert.equal(coverBedarf({ ...t, hochgeladen: { hochkant: { id: "m" } } }, kanaele), 1);
});

test("Postiz erhält Cover nur am passenden Feedvideo, nie als Bildanhang oder Story", async (t) => {
  const gesendet = [];
  t.mock.method(globalThis, "fetch", async (_, o) => {
    const b = JSON.parse(o.body); gesendet.push(b);
    return new Response(JSON.stringify(b.posts.map((p) => ({ postId: p.integration.id }))));
  });
  const kanaele = ["instagram", "youtube", "facebook", "x", "bluesky", "mastodon", "tiktok"].map((identifier) => ({ id: identifier, identifier }));
  const cover = { id: "cover", path: "https://postiz/cover.jpg" };
  const p = new Postiz({ url: "https://postiz", apiKey: "test", einstellungen: "nicht-da.json" });
  const video = { id: "video", path: "https://postiz/video.mp4" };
  await p.beitrag({ typ: "now", zeit: new Date(), caption: "Caption", medien: [video], kanaele,
    thumbnails: Object.fromEntries(kanaele.map((k) => [k.id, cover])), thumbnailTimestamp: 0, story: true });
  const nachKanal = Object.fromEntries(gesendet[0].posts.map((p) => [p.integration.id, p]));
  assert.equal(nachKanal.instagram.value[0].image[0].thumbnail, cover.path);
  assert.deepEqual(nachKanal.youtube.settings.thumbnail, cover);
  for (const k of ["facebook", "x", "bluesky", "mastodon"]) assert.deepEqual(nachKanal[k].value[0].image, [video]);
  assert.equal(nachKanal.tiktok.value[0].image[0].thumbnailTimestamp, 0);
  assert.deepEqual(gesendet[1].posts[0].value[0].image, [video]);
  await p.beitrag({ typ: "now", zeit: new Date(), caption: "Foto", medien: [{ id: "foto", path: "/foto.jpg" }], kanaele: [kanaele[0]], thumbnails: { instagram: cover } });
  assert.equal(gesendet[2].posts[0].value[0].image[0].thumbnail, undefined);
});

test("Angepasster Postiz-Mastodon-Provider kann explizit Cover bekommen", async (t) => {
  let body;
  t.mock.method(globalThis, "fetch", async (_, o) => { body = JSON.parse(o.body); return new Response('[{"postId":"m"}]'); });
  const p = new Postiz({ url: "https://postiz", apiKey: "test", einstellungen: "nicht-da.json" });
  await p.beitrag({ typ: "now", zeit: new Date(), caption: "Text", medien: [{ id: "v", path: "/video.mp4" }],
    kanaele: [{ id: "m", identifier: "mastodon" }], thumbnails: { m: { id: "c", path: "https://postiz/c.jpg" } }, mastodonThumbnails: true });
  assert.equal(body.posts[0].value[0].image[0].thumbnail, "https://postiz/c.jpg");
});

const ffmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("Titelgrafik rendert eigene Hoch-/Querprofile und belässt Caption und Video unverändert", { skip: !ffmpeg }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cover-render-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const video = path.join(dir, "video.mp4");
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  const original = await fs.readFile(video);
  const layout = { logo: path.resolve("assets/logos/quer-dunkel.png"), logoBreite: 0.4, schriftOrdner: path.resolve("assets/fonts") };
  const cover = await thumbnailsErstellen({ ordner: dir, video, layout,
    optionen: { modus: "text", text: "Mehr Transparenz\nÖffentliche Sitzungen verständlich erklären" },
    kanaele: [{ identifier: "instagram" }, { identifier: "youtube" }] });
  for (const [key, datei] of Object.entries(cover.dateien)) {
    const profil = key === "original" ? originalProfil({ breite: 320, hoehe: 180 }) : THUMBNAIL_PROFILE[key];
    const m = await untersuche(datei);
    assert.deepEqual([m.breite, m.hoehe], [profil.breite, profil.hoehe]);
    assert.ok((await fs.stat(datei)).size < profil.maxBytes);
    const bytes = await fs.readFile(datei);
    assert.deepEqual([...bytes.subarray(0, 3)], [255, 216, 255]);
  }
  assert.deepEqual(await fs.readFile(video), original);
  const frame = await thumbnailsErstellen({ ordner: dir, video, layout, optionen: { modus: "frame", frameMs: 0 }, kanaele: [] });
  assert.equal(frame.frameMs, 0);
  assert.ok(frame.dateien.original);
  await assert.rejects(jpegProfil(cover.dateien.original, path.join(dir, "zu-gross.jpg"), { breite: 320, hoehe: 180, maxBytes: 1 }), /2 MiB/);
});

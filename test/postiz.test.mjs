import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {
  standardEinstellungen, alsHtml, passendeKanaele, kundenAus, findeKunde, kanaeleVonKunde, parseCollabs, einstellungenFuer, repostKandidaten,
  zeichenZahl, zeichenLimit, Postiz, apiBasis, passtZu, AnfragenZaehler,
} from "../src/postiz.mjs";

test("Pflichtfelder je Netzwerk", () => {
  const caption = "Neuer Radweg am Plärrer 🚲 #Nürnberg\n\nMehr dazu …";
  assert.deepEqual(standardEinstellungen("instagram", caption), { post_type: "post", collaborators: [] });
  assert.equal(standardEinstellungen("tiktok", caption).title, "Neuer Radweg am Plärrer 🚲");
  assert.equal(standardEinstellungen("youtube", caption).type, "public");
  assert.equal(standardEinstellungen("x", caption).who_can_reply_post, "everyone");
  assert.deepEqual(standardEinstellungen("mastodon", caption), {});
});

test("Caption als HTML mit Absätzen", () => {
  assert.equal(alsHtml("A & B\n\n<C>"), "<p>A &amp; B</p><p></p><p>&lt;C&gt;</p>");
});

test("passende Kanäle je Beitragsart", () => {
  const kanaele = ["instagram", "tiktok", "youtube", "facebook", "mastodon"].map((identifier) => ({ id: identifier, identifier }));
  const ids = (art) => passendeKanaele(kanaele, art).map((k) => k.id);
  assert.deepEqual(ids("video"), ["instagram", "tiktok", "youtube", "facebook", "mastodon"]);
  assert.deepEqual(ids("foto"), ["instagram", "tiktok", "facebook", "mastodon"]);
  assert.deepEqual(ids("text"), ["facebook", "mastodon"]);
});

const LUKAS = { id: "c1", name: "Lukas Küffner" };
const PARTEI = { id: "c2", name: "Piraten Nürnberg" };
const KANAELE = [
  { id: "ig1", identifier: "instagram", customer: LUKAS },
  { id: "x1", identifier: "x", customer: LUKAS },
  { id: "x2", identifier: "x", customer: PARTEI },
  { id: "li2", identifier: "linkedin-page", customer: PARTEI },
  { id: "ma", identifier: "mastodon" },
];

test("Kunden aus den Kanälen", () => {
  assert.deepEqual(kundenAus(KANAELE), [LUKAS, PARTEI]);
  assert.equal(findeKunde(KANAELE, "lukas küffner"), LUKAS);
  assert.equal(findeKunde(KANAELE, "c2"), PARTEI);
  assert.equal(findeKunde(KANAELE, "Niemand"), null);
  assert.deepEqual(kanaeleVonKunde(KANAELE, "c1").map((k) => k.id), ["ig1", "x1"]);
  assert.equal(kanaeleVonKunde(KANAELE, null).length, 5);
});

test("Collab-Namen", () => {
  assert.deepEqual(parseCollabs("@piraten_nbg, humanisten  @piraten_nbg"), ["piraten_nbg", "humanisten"]);
});

test("Collab nur bei Instagram-Beiträgen, nicht bei Storys", () => {
  const ig = einstellungenFuer(KANAELE[0], { caption: "Hallo", collabs: ["a", "b"] });
  assert.deepEqual(ig.collaborators, [{ label: "a" }, { label: "b" }]);
  const story = einstellungenFuer(KANAELE[0], { caption: "Hallo", collabs: ["a"], eigene: { instagram: { post_type: "story" } } });
  assert.deepEqual(story.collaborators, []);
  assert.equal(einstellungenFuer(KANAELE[1], { caption: "Hallo", collabs: ["a"] }).collaborators, undefined);
});

test("Repost über Postiz-Re-poster", () => {
  assert.deepEqual(repostKandidaten(KANAELE, [KANAELE[1]]).map((k) => k.id), ["x1", "x2"]);
  assert.deepEqual(repostKandidaten(KANAELE, [KANAELE[0]]), []);
  const x = einstellungenFuer(KANAELE[1], { caption: "Hallo", repost: { kanaele: ["x1", "x2"], verzoegerung: 3600e3 } });
  assert.equal(x["plug--x-repost-post-users--active"], true);
  assert.deepEqual(x["plug--x-repost-post-users--integrations"], [{ id: "x2" }]);
  assert.equal(x.__type, "x");
  assert.equal(x["plug--x-repost-post-users--delay"], "3600000");
  const ig = einstellungenFuer(KANAELE[0], { caption: "Hallo", repost: { kanaele: ["x2"], verzoegerung: 0 } });
  assert.equal(Object.keys(ig).some((k) => k.startsWith("plug--")), false);
  const allein = einstellungenFuer(KANAELE[1], { caption: "Hallo", repost: { kanaele: ["x1"], verzoegerung: 0 } });
  assert.equal(Object.keys(allein).some((k) => k.startsWith("plug--")), false);
});

test("Zeichen zählen wie Postiz", () => {
  // JavaScript-Zeichen: ein Emoji zählt 2
  assert.equal(zeichenZahl("Grüße 🚲", "mastodon"), 8);
  assert.equal(zeichenZahl("Grüße 🚲", "facebook"), 8);
  // X über twitter-text: Emojis doppelt, Links 23
  assert.equal(zeichenZahl("Grüße 🚲", "x"), 8);
  assert.equal(zeichenZahl("Mehr: https://example.org/ein/sehr/langer/pfad?mit=parametern", "x"), 29);
  // Threads in Bytes: Umlaute 2, Emoji 4
  assert.equal(zeichenZahl("Grüße 🚲", "threads"), 12);
  assert.equal(zeichenZahl("Grüße 🚲 https://example.org/lang/lang/lang", "mastodon-direkt"), 31);
});

test("Postiz-Adresse mit oder ohne /api", () => {
  assert.equal(apiBasis("https://postiz.example.org"), "https://postiz.example.org/api/public/v1");
  assert.equal(apiBasis("http://localhost:5000/api/"), "http://localhost:5000/api/public/v1");
  assert.equal(apiBasis("https://p.example/api/public/v1"), "https://p.example/api/public/v1");
});

test("Kanal per ID, Name oder Handle", () => {
  const k = { id: "cm1", name: "Lukas Küffner", profile: "lukas_kueffner" };
  assert.ok(passtZu(k, "cm1") && passtZu(k, " lukas küffner ") && passtZu(k, "@Lukas_Kueffner"));
  assert.equal(passtZu(k, "piraten"), false);
});

test("Postiz-Anfragen pro Stunde mitzählen", () => {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zaehler-")), "anfragen.json");
  const z = new AnfragenZaehler(datei, 5);
  const t0 = Date.parse("2026-10-19T10:00:00Z");
  for (let i = 0; i < 4; i++) z.zaehlen(t0 + i * 60e3);
  assert.equal(z.wiederFrei(1, t0 + 5 * 60e3), null);
  // 3 weitere gehen erst, wenn die ersten 2 älter als eine Stunde sind
  assert.equal(z.wiederFrei(3, t0 + 5 * 60e3).getTime(), t0 + 60e3 + 3600e3);
  assert.equal(z.wiederFrei(9, t0), Infinity);
  // übersteht einen Neustart
  assert.equal(new AnfragenZaehler(datei, 5).anzahl(t0 + 10 * 60e3), 4);
  assert.equal(new AnfragenZaehler(null, 0).wiederFrei(100), null);
  assert.equal(Postiz.bedarf({ medien: 3, hochgeladen: false, story: true, kanaele: [{ identifier: "instagram" }] }), 5);
  assert.equal(Postiz.bedarf({ medien: 3, hochgeladen: true, story: true, kanaele: [{ identifier: "x" }] }), 1);
  // eigene Story-Fassung (9:16) braucht einen Upload mehr – aber nur, wenn es Story-Kanäle gibt
  assert.equal(Postiz.bedarf({ medien: 1, hochgeladen: false, story: true, storyUpload: true, kanaele: [{ identifier: "instagram" }] }), 4);
  assert.equal(Postiz.bedarf({ medien: 1, hochgeladen: false, story: true, storyUpload: true, kanaele: [{ identifier: "x" }] }), 2);
  // 9:16-Fassung für Instagram/TikTok: ein Upload mehr, aber nur wenn so ein Kanal dabei ist
  assert.equal(Postiz.bedarf({ medien: 1, hochgeladen: false, storyUpload: true, hochkant: true, kanaele: [{ identifier: "instagram" }, { identifier: "x" }] }), 3);
  assert.equal(Postiz.bedarf({ medien: 1, hochgeladen: false, storyUpload: true, hochkant: true, kanaele: [{ identifier: "x" }] }), 2);
  // Story und Hochformat teilen sich die Fassung: nur ein zusätzlicher Upload
  assert.equal(Postiz.bedarf({ medien: 1, hochgeladen: false, story: true, storyUpload: true, hochkant: true, kanaele: [{ identifier: "instagram" }] }), 4);
});

test("Zeichenlimit mit eigener Vorgabe", () => {
  assert.equal(zeichenLimit({ id: "x1", identifier: "x" }), 280);
  assert.equal(zeichenLimit({ id: "x1", identifier: "x" }, { x: { maxZeichen: 25000 } }), 25000);
  assert.equal(zeichenLimit({ id: "ma", identifier: "mastodon" }, { ma: { maxZeichen: 1000 } }), 1000);
  assert.equal(zeichenLimit({ id: "w", identifier: "wordpress" }), null);
  const s = einstellungenFuer({ id: "x1", identifier: "x" }, { caption: "Hi", eigene: { x: { maxZeichen: 25000 } } });
  assert.equal("maxZeichen" in s, false);
});

test("Story als eigener Beitrag für Instagram und Facebook", async () => {
  const gesendet = [];
  const altesFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    gesendet.push(JSON.parse(o.body));
    return new Response(JSON.stringify([{ postId: `p${gesendet.length}` }]), { status: 200 });
  };
  let ergebnis;
  try {
    const postiz = new Postiz({ url: "http://postiz", apiKey: "k", einstellungen: "/gibt/es/nicht.json" });
    ergebnis = await postiz.beitrag({
      typ: "schedule", zeit: new Date(0), caption: "Hallo", story: true,
      medien: [{ id: "m1", path: "http://postiz/u/1.jpg" }, { id: "m2", path: "http://postiz/u/2.jpg" }],
      kanaele: [{ id: "ig", identifier: "instagram" }, { id: "x1", identifier: "x" }, { id: "fb", identifier: "facebook" }],
    });
  } finally {
    globalThis.fetch = altesFetch;
  }
  assert.deepEqual(ergebnis, { post: [{ postId: "p1" }], story: [{ postId: "p2" }] });
  const story = gesendet[1];
  assert.deepEqual(story.posts.map((p) => p.integration.id), ["ig", "fb"]);
  assert.deepEqual(story.posts[0].value[0].image, [{ id: "m1", path: "http://postiz/u/1.jpg" }]);
  assert.equal(story.posts[0].settings.post_type, "story");
  assert.equal(story.date, "1970-01-01T00:00:00.000Z");
});

test("eigene Fassung je Kanal in der Postiz-Anfrage", async () => {
  const gesendet = [];
  const altesFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    gesendet.push(JSON.parse(o.body));
    return new Response("[]", { status: 200 });
  };
  try {
    const postiz = new Postiz({ url: "http://postiz/api", apiKey: "k", einstellungen: "/gibt/es/nicht.json" });
    await postiz.beitrag({
      typ: "now", zeit: new Date(0), caption: "Langer Haupttext", captions: { x1: "Kurz für X" }, medien: [],
      kanaele: [{ id: "x1", identifier: "x" }, { id: "fb", identifier: "facebook" }],
    });
  } finally {
    globalThis.fetch = altesFetch;
  }
  const [x, fb] = gesendet[0].posts;
  assert.equal(x.value[0].content, "<p>Kurz für X</p>");
  assert.equal(fb.value[0].content, "<p>Langer Haupttext</p>");
});

test("9:16-Fassung nur für die Hochformat-Netzwerke", async () => {
  const gesendet = [];
  const altesFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    gesendet.push(JSON.parse(o.body));
    return new Response(JSON.stringify([{ postId: "p" }]), { status: 200 });
  };
  try {
    const postiz = new Postiz({ url: "http://postiz", apiKey: "k", einstellungen: "/gibt/es/nicht.json" });
    await postiz.beitrag({
      typ: "now", zeit: new Date(0), caption: "Hallo",
      medien: [{ id: "quer", path: "http://postiz/u/quer.mp4" }],
      hochkantMedium: { id: "hoch", path: "http://postiz/u/hoch.mp4" },
      kanaele: [{ id: "ig", identifier: "instagram" }, { id: "tt", identifier: "tiktok" }, { id: "x1", identifier: "x" }, { id: "yt", identifier: "youtube" }],
    });
  } finally {
    globalThis.fetch = altesFetch;
  }
  const medium = Object.fromEntries(gesendet[0].posts.map((p) => [p.integration.id, p.value[0].image.map((i) => i.id).join()]));
  assert.deepEqual(medium, { ig: "hoch", tt: "hoch", x1: "quer", yt: "quer" });
});

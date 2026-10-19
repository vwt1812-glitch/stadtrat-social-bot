import { test } from "node:test";
import assert from "node:assert/strict";
import {
  standardEinstellungen, alsHtml, passendeKanaele, kundenAus, findeKunde, kanaeleVonKunde, parseCollabs, einstellungenFuer, repostKandidaten,
  zeichenZahl, zeichenLimit, Postiz,
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

test("Zeichen zählen wie das Netzwerk", () => {
  assert.equal(zeichenZahl("Grüße 🚲", "mastodon"), 7);
  assert.equal(zeichenZahl("Grüße 🚲", "x"), 8);
  assert.equal(zeichenZahl("Mehr: https://example.org/ein/sehr/langer/pfad?mit=parametern", "x"), 29);
});

test("Zeichenlimit mit eigener Vorgabe", () => {
  assert.equal(zeichenLimit({ id: "x1", identifier: "x" }), 280);
  assert.equal(zeichenLimit({ id: "x1", identifier: "x" }, { x: { maxZeichen: 25000 } }), 25000);
  assert.equal(zeichenLimit({ id: "ma", identifier: "mastodon" }, { ma: { maxZeichen: 1000 } }), 1000);
  assert.equal(zeichenLimit({ id: "w", identifier: "wordpress" }), null);
  const s = einstellungenFuer({ id: "x1", identifier: "x" }, { caption: "Hi", eigene: { x: { maxZeichen: 25000 } } });
  assert.equal("maxZeichen" in s, false);
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

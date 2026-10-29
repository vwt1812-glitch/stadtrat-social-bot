import { test } from "node:test";
import assert from "node:assert/strict";
import { Postiz } from "../src/postiz.mjs";
import { erwartetePosts } from "../src/kontrolle.mjs";

const kanaele = [{ id: "ig", identifier: "instagram" }, { id: "ig2", identifier: "instagram-standalone" },
  { id: "fb", identifier: "facebook" }, { id: "yt", identifier: "youtube" }];
const storyMedien = [1, 2, 3].map((i) => ({ id: `clip${i}`, path: `/clip${i}.mp4` }));
const optionen = () => ({ typ: "schedule", zeit: new Date(Date.now() + 3600e3), caption: "Text",
  story: true, medien: [{ id: "voll", path: "/voll.mp4" }], storyMedien, kanaele });
const client = () => new Postiz({ url: "http://postiz", apiKey: "test", einstellungen: "fehlt.json" });

test("Feed bleibt vollständig; Story-Clips gehen einzeln an alle Story-Kanäle mit versetzten Terminen", async (t) => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_, o) => {
    const body = JSON.parse(o.body); bodies.push(body);
    return new Response(JSON.stringify(body.posts.map((_, i) => ({ postId: `${bodies.length}-${i}` }))));
  });
  const o = optionen();
  const stand = await client().beitrag(o);
  assert.equal(bodies.length, 4);
  assert.ok(bodies[0].posts.every((p) => p.value[0].image[0].id === "voll"));
  for (const [i, body] of bodies.slice(1).entries()) {
    assert.deepEqual(body.posts.map((p) => p.integration.id), ["ig", "ig2", "fb"]);
    assert.ok(body.posts.every((p) => p.settings.post_type === "story" && p.value[0].image.length === 1 &&
      p.value[0].image[0].id === `clip${i + 1}`));
    assert.equal(Date.parse(body.date), o.zeit.getTime() + i * 120e3);
  }
  const erwartet = erwartetePosts([{ id: "a", status: "geplant", plan: { zeit: o.zeit.toISOString() }, postiz: stand }]);
  assert.equal(erwartet.size, 13);
  assert.equal(erwartet.get("4-0").art, "Story-Teil 3");
  assert.equal(Date.parse(erwartet.get("4-0").zeitpunkt), o.zeit.getTime() + 240e3);
});

test("Fehler im zweiten Clip: Fortsetzen wiederholt weder Feed noch ersten Clip", async (t) => {
  let stand = {}, unklar = null, fehler = true;
  const gesendet = [];
  t.mock.method(globalThis, "fetch", async (_, o) => {
    const body = JSON.parse(o.body);
    const id = body.posts[0].value[0].image[0].id;
    gesendet.push(id);
    if (id === "clip2" && fehler) { fehler = false; return new Response("Ungültig", { status: 422 }); }
    return new Response(JSON.stringify(body.posts.map((_, i) => ({ postId: `${id}-${i}` }))));
  });
  const senden = () => client().beitrag({ ...optionen(), fortschritt: stand,
    vorAnlegen: async (teil) => { unklar = teil; }, beiAblehnung: async () => { unklar = null; },
    nachAnlegen: async (neu) => { stand = neu; unklar = null; } });
  await assert.rejects(senden(), /422/);
  assert.equal(unklar, null);
  assert.deepEqual(Object.keys(stand), ["post", "story"]);
  await senden();
  assert.deepEqual(gesendet, ["voll", "clip1", "clip2", "clip2", "clip3"]);
  assert.deepEqual(Object.keys(stand), ["post", "story", "story2", "story3"]);
});

test("Nur Story funktioniert ohne vollständigen Video-Upload; Verbindungsabbruch markiert exakten Clip", async (t) => {
  let aufrufe = 0, unklar;
  t.mock.method(globalThis, "fetch", async (_, o) => {
    const body = JSON.parse(o.body); aufrufe++;
    assert.equal(body.posts[0].settings.post_type, "story");
    if (aufrufe === 2) throw new Error("Verbindung weg");
    return new Response(JSON.stringify([{ postId: "eins" }]));
  });
  await assert.rejects(client().beitrag({ ...optionen(), typ: "now", nurStory: true, medien: [], kanaele: [kanaele[0]],
    vorAnlegen: async (teil) => { unklar = teil; }, nachAnlegen: async () => { unklar = null; } }), /Verbindung weg/);
  assert.equal(unklar, "story2");
});

test("Anfragenlimit zählt Clips, Uploads und fehlende Teilergebnisse", () => {
  const o = { medien: 1, hochgeladen: false, story: true, kanaele, storyAnzahl: 3, storyUploads: 3 };
  assert.equal(Postiz.bedarf(o), 8);
  assert.equal(Postiz.bedarf({ ...o, nurStory: true }), 6);
  assert.equal(Postiz.bedarf({ ...o, hochgeladen: true, storyUploads: 1,
    fortschritt: { post: [{}], story: [{}] } }), 3);
  assert.equal(Postiz.bedarf({ ...o, hochkant: true, storyUpload: true }), 9);
  assert.equal(Postiz.bedarf({ ...o, kanaele: [kanaele[3]] }), 2);
});

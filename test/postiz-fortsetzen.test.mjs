import { test } from "node:test";
import assert from "node:assert/strict";
import { Postiz } from "../src/postiz.mjs";
import { erwartetePosts } from "../src/kontrolle.mjs";

const optionen = () => ({ typ: "now", zeit: new Date(), caption: "Entwurf", story: true,
  medien: [{ id: "m", path: "/foto.jpg" }], kanaele: [{ id: "ig", identifier: "instagram" }] });

test("Feed-Erfolg wird vor Story-Fehler gesichert; Neustart wiederholt nur die Story", async (t) => {
  let stand = {}, unklar = null, aufrufe = [];
  t.mock.method(globalThis, "fetch", async (_, o) => {
    const body = JSON.parse(o.body);
    const teil = body.posts[0].settings.post_type === "story" ? "story" : "post";
    aufrufe.push(teil);
    if (aufrufe.length === 2) return new Response("Ungültig", { status: 422 });
    return new Response(JSON.stringify([{ postId: teil }]));
  });
  const callbacks = () => ({
    fortschritt: structuredClone(stand),
    vorAnlegen: async (teil) => { unklar = teil; },
    nachAnlegen: async (neu) => { stand = neu; unklar = null; },
    beiAblehnung: async () => { unklar = null; },
  });
  const client = () => new Postiz({ url: "http://postiz", apiKey: "test", einstellungen: "nicht-vorhanden.json" });
  await assert.rejects(client().beitrag({ ...optionen(), ...callbacks() }), /422/);
  assert.deepEqual(stand, { post: [{ postId: "post" }] });
  assert.equal(unklar, null);
  assert.equal(erwartetePosts([{ id: "a", status: "vorschau", postiz: stand }]).size, 1);
  await client().beitrag({ ...optionen(), ...callbacks() });
  assert.deepEqual(aufrufe, ["post", "story", "story"]);
  assert.deepEqual(stand.story, [{ postId: "story" }]);
  assert.equal(Postiz.bedarf({ medien: 1, hochgeladen: true, story: true, kanaele: optionen().kanaele,
    fortschritt: { post: [{ postId: "post" }] } }), 1);
});

test("Verbindungsabbruch und unvollständige Erfolgsmeldung bleiben als unklar markiert", async (t) => {
  let unklar;
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Verbindung weg"); });
  const p = new Postiz({ url: "http://postiz", apiKey: "test", einstellungen: "nicht-vorhanden.json" });
  const o = { ...optionen(), vorAnlegen: async (teil) => { unklar = teil; },
    nachAnlegen: async () => { unklar = null; }, beiAblehnung: async () => { unklar = null; } };
  await assert.rejects(p.beitrag(o), /Verbindung weg/);
  assert.equal(unklar, "post");
  mock.mock.mockImplementation(async () => new Response("[]"));
  await assert.rejects(p.beitrag(o), /vollständigen Post-IDs/);
  assert.equal(unklar, "post");
});

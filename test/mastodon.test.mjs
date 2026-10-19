import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Mastodon, mastodonLaenge, mastodonMedien } from "../src/mastodon.mjs";

test("Mastodon zählt Codepoints und Links als 23", () => {
  assert.equal(mastodonLaenge("Grüße 🚲"), 7);
  assert.equal(mastodonLaenge("Mehr: https://example.org/ein/sehr/langer/pfad"), 29);
});

test("Status: ungelistet, Inhaltswarnung, Termin erst ab 5 Minuten Vorlauf", () => {
  const m = new Mastodon({ url: "https://social.example/", token: "t", inhaltswarnung: "Kommunalpolitik" });
  assert.equal(m.cwLaenge, 15);
  const sofort = m.statusBody({ text: "Hallo", mediaIds: ["1"], zeit: new Date(Date.now() + 60e3) });
  assert.deepEqual(sofort, { status: "Hallo", media_ids: ["1"], visibility: "unlisted", language: "de", spoiler_text: "Kommunalpolitik" });
  const spaeter = new Date(Date.now() + 3600e3);
  assert.equal(m.statusBody({ text: "Hallo", zeit: spaeter }).scheduled_at, spaeter.toISOString());
  assert.equal("spoiler_text" in new Mastodon({ url: "u", token: "t" }).statusBody({ text: "x" }), false);
});

test("bis zu 4 Bilder oder 1 Video", () => {
  assert.deepEqual(mastodonMedien(["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"]), ["1.jpg", "2.jpg", "3.jpg", "4.jpg"]);
  assert.deepEqual(mastodonMedien(["fertig.mp4"]), ["fertig.mp4"]);
});

test("Video: wartet, bis Mastodon es verarbeitet hat, und postet mit Idempotency-Key", async () => {
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "masto-")), "fertig.mp4");
  fs.writeFileSync(datei, "video");
  const aufrufe = [];
  let abfragen = 0;
  const altesFetch = globalThis.fetch;
  globalThis.fetch = async (url, o = {}) => {
    aufrufe.push({ url, methode: o.method ?? "GET", key: o.headers?.["Idempotency-Key"], auth: o.headers?.Authorization });
    if (url.endsWith("/api/v2/media")) return new Response(JSON.stringify({ id: "m1", url: null }), { status: 202 });
    if (url.endsWith("/api/v1/media/m1")) return ++abfragen < 2 ? new Response(JSON.stringify({ id: "m1", url: null }), { status: 206 }) : new Response(JSON.stringify({ id: "m1", url: "https://x/v.mp4" }));
    if (url.endsWith("/api/v1/statuses")) return new Response(JSON.stringify({ id: "s1", body: JSON.parse(o.body) }));
    return new Response("?", { status: 404 });
  };
  try {
    const m = new Mastodon({ url: "https://social.example", token: "t" });
    const ergebnis = await m.posten({ text: "Hallo", medien: [datei], schluessel: "stadtrat-1" });
    assert.deepEqual(ergebnis, { id: "s1", geplant: false });
  } finally {
    globalThis.fetch = altesFetch;
  }
  assert.deepEqual(aufrufe.map((a) => `${a.methode} ${a.url.replace("https://social.example", "")}`), [
    "POST /api/v2/media", "GET /api/v1/media/m1", "GET /api/v1/media/m1", "POST /api/v1/statuses",
  ]);
  assert.equal(aufrufe.at(-1).key, "stadtrat-1");
  assert.equal(aufrufe[0].auth, "Bearer t");
});

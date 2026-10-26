import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { mastodonProviderAnpassen } from "../scripts/postiz-mastodon-thumbnail.mjs";

const quelle = await fs.readFile(new URL("../postiz-patches/mastodon.thumbnail.ts", import.meta.url), "utf8");
const helper = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(quelle)).toString("base64")}`);
const jpeg = new Uint8Array([255, 216, 255, 0, 1]);

test("Postiz-Helfer lädt nur begrenzte JPEGs und reicht den sicheren Dispatcher weiter", async () => {
  const dispatcher = {};
  let optionen;
  const bild = await helper.loadMastodonThumbnail("https://uploads/cover.jpg", dispatcher, async (_, o) => {
    optionen = o;
    return new Response(jpeg, { headers: { "content-type": "image/jpeg", "content-length": String(jpeg.length) } });
  });
  assert.deepEqual(bild, Buffer.from(jpeg));
  assert.equal(optionen.dispatcher, dispatcher);
  assert.ok(optionen.signal instanceof AbortSignal);
  assert.equal(await helper.loadMastodonThumbnail(undefined, dispatcher, () => { throw new Error("Darf nicht laden"); }), undefined);
});

test("Postiz-Helfer lehnt Übergröße auch ohne Content-Length und falsche Dateitypen ab", async () => {
  for (const res of [
    new Response(jpeg, { headers: { "content-type": "image/jpeg", "content-length": String(3 * 1024 ** 2) } }),
    new Response(new Uint8Array(2 * 1024 ** 2 + 1), { headers: { "content-type": "image/jpeg" } }),
    new Response("kein jpeg", { headers: { "content-type": "image/jpeg" } }),
    new Response(jpeg, { headers: { "content-type": "text/html" } }),
    new Response("Fehler", { status: 500 }),
  ]) await assert.rejects(helper.loadMastodonThumbnail("https://uploads/cover.jpg", {}, async () => res));
});

test("Postiz-Anpassung prüft alle Anker vor dem Schreiben und ist nicht doppelt anwendbar", () => {
  const original = [
    "import { PassThrough, Readable } from 'stream';",
    "    alt?: string\n  ) {",
    "    const media = await this.runStreamedUpload<{ id: string }>(async () => {",
    "      if (alt) {\n        form.append('description', alt);\n      }",
    "this.uploadFile(url, media.path, accessToken, media.alt)",
    "this.uploadFile(url, media.path, accessToken, media.alt)",
  ].join("\n");
  const neu = mastodonProviderAnpassen(original);
  assert.match(neu, /media\.alt, media\.thumbnail/);
  assert.match(neu, /form\.append\('thumbnail', thumbnail/);
  assert.throws(() => mastodonProviderAnpassen(neu), /bereits vorhanden/);
  assert.throws(() => mastodonProviderAnpassen(original.replace("alt?:", "description?:")), /passt nicht/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { standardEinstellungen, alsHtml } from "../src/postiz.mjs";

test("Pflichtfelder je Netzwerk", () => {
  const caption = "Neuer Radweg am Plärrer 🚲 #Nürnberg\n\nMehr dazu …";
  assert.deepEqual(standardEinstellungen("instagram", caption), { post_type: "post", collaborators: [] });
  assert.equal(standardEinstellungen("tiktok", caption).title, "Neuer Radweg am Plärrer 🚲");
  assert.equal(standardEinstellungen("youtube", caption).type, "public");
  assert.deepEqual(standardEinstellungen("mastodon", caption), {});
});

test("Caption als HTML mit Absätzen", () => {
  assert.equal(alsHtml("A & B\n\n<C>"), "<p>A &amp; B</p><p></p><p>&lt;C&gt;</p>");
});

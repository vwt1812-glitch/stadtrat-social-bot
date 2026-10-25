import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { grafikText } from "../src/redaktion.mjs";

for (const aktion of ["anim", "grafik"]) {
  for (const format of ["post", "story"]) {
    test(`Telegram: Transkript bearbeiten → ${aktion}:${format} verwendet den neuen Text`, (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "redaktion-flow-"));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      execFileSync(process.execPath, [
        "--experimental-test-module-mocks",
        fileURLToPath(new URL("./fixtures/edit-then-graphic.mjs", import.meta.url)), dir, aktion, format,
      ], { timeout: 15000, stdio: "pipe" });
    });
  }
}

test("Formatwechsel erhalten separaten Grafiktext und ändern keine Feed-Caption", () => {
  for (const art of ["foto", "video"]) {
    const a = { art, grafikQuelleText: "Eigener Bildtext", caption: "Feed-Caption", notizen: "Original" };
    assert.equal(grafikText(a), "Eigener Bildtext");
    assert.equal(grafikText(a, "Neuer Grafiktext"), "Neuer Grafiktext");
    assert.equal(a.caption, "Feed-Caption");
    // Nach „Zurück zum Text“ zählt der aktuelle Textentwurf, auch bei altem Grafiktext.
    assert.equal(grafikText({ ...a, art: "text", caption: "Bearbeiteter Entwurf" }), "Bearbeiteter Entwurf");
  }
});

test("Alte Entwürfe ohne Caption behalten ihren bisherigen Grafiktext oder ihre Notizen", () => {
  assert.equal(grafikText({ art: "text", notizen: "Original" }), "Original");
  assert.equal(grafikText({ grafikQuelleText: "Bildtext", notizen: "Original" }), "Bildtext");
  assert.equal(grafikText({ art: "text", caption: "", notizen: "Original" }), "");
  assert.equal(grafikText({ caption: "Entwurf" }, ""), "");
});

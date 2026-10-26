import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const szenario of ["archiv", "teilfehler", "unklar", "thumbnail"]) {
  test(`Telegram: ${szenario} bleibt nach erneutem Öffnen sicher`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entwuerfe-flow-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    execFileSync(process.execPath, ["--experimental-test-module-mocks",
      fileURLToPath(new URL("./fixtures/entwuerfe-flow.mjs", import.meta.url)), dir, szenario],
    { timeout: 18000, stdio: "pipe" });
  });
}

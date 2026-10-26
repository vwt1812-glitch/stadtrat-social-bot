import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Telegram: Format- und Titelbildmenüs öffnen ohne Änderungen; Termin und Sofortpost getrennt bestätigen", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "menues-flow-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, ["--experimental-test-module-mocks",
    fileURLToPath(new URL("./fixtures/menues-flow.mjs", import.meta.url)), dir], { timeout: 22000, stdio: "pipe" });
});

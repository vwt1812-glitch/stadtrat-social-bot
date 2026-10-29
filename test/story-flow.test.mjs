import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const modus of ["nur", "feed"]) {
  test(`Telegram veröffentlicht lange Story mit allen Clips (${modus})`, async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "story-flow-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    execFileSync(process.execPath, ["--experimental-test-module-mocks",
      fileURLToPath(new URL("./fixtures/story-flow.mjs", import.meta.url)), dir, modus],
    { timeout: 15000, stdio: "pipe" });
  });
}

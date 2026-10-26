import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ausfuehren, untersuche } from "../src/video.mjs";
import { fotoCover, fotoCoverBereiche, coverFotoAusschnitt, QUER_COVER } from "../src/cover-foto.mjs";

test("Passendes Hochkantfoto bleibt unbeschnitten; fremde Seitenverhältnisse werden gefüllt", () => {
  assert.deepEqual(coverFotoAusschnitt({ breite: 1080, hoehe: 1920 }, { breite: 1080, hoehe: 1920 }),
    { x: 0, y: 0, breite: 1080, hoehe: 1920 });
  const g = { x: 0.05, y: 0.3, w: 0.2, h: 0.3 };
  const c = coverFotoAusschnitt({ breite: 1920, hoehe: 1080 }, { breite: 1080, hoehe: 1920 }, [g]);
  assert.equal(c.x, 0);
  assert.ok(c.breite < 1920);
  assert.equal(c.hoehe, 1080);
  assert.ok(c.x + c.breite >= (g.x + g.w) * 1920);
});

test("Hochkant-Balken weicht erkanntem Gesicht aus; manuelle Position bleibt wählbar", () => {
  const p = fotoCoverBereiche({ balkenHoehe: 288, logoHoehe: 128, gesichter: [{ y: 800, h: 600 }] });
  assert.ok(p.balkenY + 288 <= 776);
  assert.ok(p.logoY + 128 <= 776 || p.logoY >= 1424);
  for (const position of ["oben", "unten"]) {
    assert.equal(fotoCoverBereiche({ balkenHoehe: 288, logoHoehe: 128, textPosition: position }).position, position);
  }
  assert.ok(QUER_COVER.textX > QUER_COVER.bildBreite);
  assert.ok(QUER_COVER.textX + QUER_COVER.textBreite <= 1080);
});

const ffmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("Echte Fotocover behalten native Bildränder und lassen Quer-Motiv frei von Text und Logo", { skip: !ffmpeg }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cover-foto-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  for (const name of ["Inter-Bold.otf", "Inter-Medium.otf"]) await fs.copyFile(path.resolve("assets/fonts", name), path.join(dir, name));
  const bild = path.join(dir, "motiv.png");
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i",
    "color=c=blue:s=1080x1920,drawbox=x=0:y=0:w=iw:h=50:color=red:t=fill,drawbox=x=0:y=1870:w=iw:h=50:color=red:t=fill,drawbox=x=0:y=0:w=50:h=ih:color=green:t=fill,drawbox=x=1030:y=0:w=50:h=ih:color=green:t=fill,drawbox=x=350:y=800:w=400:h=600:color=white:t=fill",
    "-frames:v", "1", bild]);
  const original = await fs.readFile(bild);
  const layout = { schriftOrdner: ".", logo: path.resolve("assets/logos/quer-hell.png") };
  for (const quer of [false, true]) {
    const datei = path.join(dir, quer ? "quer.jpg" : "hochkant.jpg");
    await fotoCover({ ausgabe: datei, bild, layout, quer, inhalt: { titel: "Neues aus dem Rathaus!", beschreibung: "" } });
    const m = await untersuche(datei);
    assert.deepEqual([m.breite, m.hoehe], [1080, quer ? 608 : 1920]);
    const rgb = await ausfuehren("ffmpeg", ["-v", "error", "-i", datei, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { binaer: true });
    const pixel = (x, y) => [...rgb.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)];
    if (quer) {
      assert.ok(pixel(250, 400).every((v) => v > 230), pixel(250, 400).join(","));
    } else {
      for (const [x, y] of [[20, 960], [1060, 960]]) {
        const [r, g, b] = pixel(x, y);
        assert.ok(g > r + 70 && g > b + 70, pixel(x, y).join(","));
      }
      for (const y of [20, 1900]) {
        const [r, g, b] = pixel(540, y);
        assert.ok(r > g + 180 && r > b + 180, pixel(540, y).join(","));
      }
    }
  }
  assert.deepEqual(await fs.readFile(bild), original);
});

// Optionale Anpassung einer vorhandenen Postiz-Quellkopie. Kein Docker-Neustart/Deployment.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function mastodonProviderAnpassen(quelle) {
  if (quelle.includes("loadMastodonThumbnail")) throw new Error("Der Thumbnail-Patch ist bereits vorhanden. Bitte den Stand prüfen.");
  const stellen = [
    ["import { PassThrough, Readable } from 'stream';", "import { PassThrough, Readable } from 'stream';\nimport { loadMastodonThumbnail } from './mastodon.thumbnail';"],
    ["    alt?: string\n  ) {", "    alt?: string,\n    thumbnailUrl?: string\n  ) {"],
    ["    const media = await this.runStreamedUpload<{ id: string }>(async () => {", "    const media = await this.runStreamedUpload<{ id: string }>(async () => {\n      const thumbnail = await loadMastodonThumbnail(thumbnailUrl, getSsrfSafeDispatcher());"],
    ["      if (alt) {\n        form.append('description', alt);\n      }", "      if (alt) {\n        form.append('description', alt);\n      }\n      if (thumbnail) {\n        form.append('thumbnail', thumbnail, { filename: 'thumbnail.jpg', contentType: 'image/jpeg', knownLength: thumbnail.length });\n      }"],
    ["this.uploadFile(url, media.path, accessToken, media.alt)", "this.uploadFile(url, media.path, accessToken, media.alt, media.thumbnail)"],
  ];
  let neu = quelle.replace(/\r\n/g, "\n");
  for (const [alt, ersatz] of stellen) {
    const anzahl = neu.split(alt).length - 1;
    const erwartet = alt.startsWith("this.uploadFile") ? 2 : 1;
    if (anzahl !== erwartet) throw new Error("Postiz-Quellstand passt nicht zum Patch. Keine Dateien geändert.");
    neu = neu.replaceAll(alt, ersatz);
  }
  return neu;
}

async function main() {
  const [ziel, modus = "--check"] = process.argv.slice(2);
  if (!ziel || !["--check", "--apply"].includes(modus)) throw new Error("Aufruf: node scripts/postiz-mastodon-thumbnail.mjs /pfad/zu/postiz-app [--check|--apply]");
  const root = await fs.realpath(path.resolve(ziel));
  const ordner = path.join(root, "libraries/nestjs-libraries/src/integrations/social");
  const realOrdner = await fs.realpath(ordner);
  if (realOrdner !== ordner) throw new Error("Der Zielordner darf keine abweichende Symlink-Umleitung enthalten.");
  const datei = path.join(ordner, "mastodon.provider.ts");
  const bisher = await fs.readFile(datei, "utf8");
  const neu = mastodonProviderAnpassen(bisher);
  const helper = path.join(ordner, "mastodon.thumbnail.ts");
  try { await fs.access(helper); throw new Error("Der Ziel-Helfer existiert bereits. Keine Dateien geändert."); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  if (modus === "--check") { console.log("Patch passt. Es wurden keine Dateien geändert."); return; }
  const hier = path.dirname(fileURLToPath(import.meta.url));
  const quelle = await fs.readFile(path.join(hier, "../postiz-patches/mastodon.thumbnail.ts"), "utf8");
  // Exklusive Sicherung verhindert das Überschreiben einer älteren lokalen Anpassung.
  await fs.writeFile(`${datei}.vor-thumbnail`, bisher, { flag: "wx" });
  await fs.writeFile(helper, quelle, { flag: "wx" });
  try { await fs.writeFile(datei, neu); }
  catch (e) { await fs.writeFile(datei, bisher); await fs.unlink(helper); throw e; }
  console.log("Postiz-Quellcode angepasst. Build, Tests und Deployment müssen separat erfolgen. Erst danach POSTIZ_MASTODON_THUMBNAILS=ja im Bot setzen.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}

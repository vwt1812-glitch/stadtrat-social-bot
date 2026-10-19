// Alles, was ffmpeg/ffprobe macht: Video untersuchen, Ton für Whisper
// herauslösen, Logo + Untertitel einbrennen.

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export function ausfuehren(befehl, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(befehl, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-8000)));
    p.on("error", (e) => reject(new Error(`${befehl} nicht gefunden oder nicht startbar: ${e.message}`)));
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${befehl} ist fehlgeschlagen (Code ${code}):\n${err.trim().split("\n").slice(-6).join("\n")}`)),
    );
  });
}

/** Maße so, wie das Video angezeigt wird (Drehung von Handyvideos berücksichtigt). */
export async function untersuche(datei) {
  const json = JSON.parse(
    await ausfuehren("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", datei]),
  );
  const video = json.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("Die Datei enthält keine Videospur.");
  const drehung = Math.abs(
    Number(video.tags?.rotate ?? video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0),
  );
  const gedreht = drehung === 90 || drehung === 270;
  return {
    breite: gedreht ? video.height : video.width,
    hoehe: gedreht ? video.width : video.height,
    dauer: Number(json.format.duration ?? video.duration ?? 0),
    hatTon: json.streams.some((s) => s.codec_type === "audio"),
  };
}

export async function tonFuerWhisper(video, wav) {
  await ausfuehren("ffmpeg", ["-y", "-v", "error", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
}

function logoPosition(position, rand) {
  const x = position.includes("links") ? `${rand}` : `W-w-${rand}`;
  const y = position.includes("unten") ? `H-h-${rand}` : `${rand}`;
  return `${x}:${y}`;
}

/** Filterkette für das Logo; hängt an `letzte` an und gibt das neue Label zurück. */
async function logoFilter(filter, letzte, masse, layout) {
  try {
    await fs.access(layout.logo);
  } catch {
    throw new Error(`Logo nicht gefunden: ${layout.logo}`);
  }
  const kurz = Math.min(masse.breite, masse.hoehe);
  const rand = Math.round(kurz * 0.045);
  const logoBreite = Math.round(masse.breite * layout.logoBreite / 2) * 2;
  const innen = Math.round(logoBreite * 0.06);
  const hintergrund = layout.logoHintergrund
    ? `,pad=iw+${innen * 2}:ih+${innen * 2}:${innen}:${innen}:color=black@0.45`
    : "";
  filter.push(`[1:v]format=rgba,scale=${logoBreite}:-1${hintergrund}[logo]`);
  filter.push(`[${letzte}][logo]overlay=${logoPosition(layout.logoPosition, rand)}:format=auto[mitlogo]`);
  return "mitlogo";
}

/**
 * @param {object} o
 * @param {string} o.eingabe Originalvideo
 * @param {string} o.ausgabe fertiges MP4
 * @param {string|null} o.ass ASS-Datei (im selben Ordner wie die Ausgabe) oder null
 * @param {{breite:number,hoehe:number}} o.masse
 * @param {object} o.layout siehe config.layout
 * @param {object} o.video siehe config.video
 */
export async function rendern({ eingabe, ausgabe, ass, masse, layout, video }) {
  const filter = [];
  let letzte = "0:v";
  if (ass) {
    const fonts = layout.schriftOrdner ? `:fontsdir=${layout.schriftOrdner.replace(/[\\:']/g, "\\$&")}` : "";
    filter.push(`[${letzte}]ass=${path.basename(ass)}${fonts}[sub]`);
    letzte = "sub";
  }
  if (layout.logo) letzte = await logoFilter(filter, letzte, masse, layout);
  filter.push(`[${letzte}]format=yuv420p[v]`);

  const args = ["-y", "-v", "error", "-i", eingabe];
  if (layout.logo) args.push("-i", layout.logo);
  args.push(
    "-filter_complex", filter.join(";"),
    "-map", "[v]", "-map", "0:a?",
    "-c:v", video.encoder,
  );
  if (video.encoder === "libx264") args.push("-preset", video.preset, "-crf", video.crf, "-profile:v", "high");
  else args.push("-b:v", "8M");
  args.push("-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", ausgabe);

  await ausfuehren("ffmpeg", args, { cwd: path.dirname(ausgabe) });
}

/**
 * Foto als JPEG speichern, lange Seite höchstens 2048 px (Instagram nimmt max. 8 MB,
 * Telegram zeigt Fotos bis 10 MB), auf Wunsch mit Logo.
 */
export async function fotoRendern({ eingabe, ausgabe, layout, mitLogo }) {
  const original = await untersuche(eingabe);
  const faktor = Math.min(1, 2048 / Math.max(original.breite, original.hoehe));
  const masse = { breite: Math.round(original.breite * faktor / 2) * 2, hoehe: Math.round(original.hoehe * faktor / 2) * 2 };
  const filter = [`[0:v]scale=${masse.breite}:${masse.hoehe}[klein]`];
  let letzte = "klein";
  const args = ["-y", "-v", "error", "-i", eingabe];
  if (mitLogo && layout.logo) {
    letzte = await logoFilter(filter, letzte, masse, layout);
    args.push("-i", layout.logo);
  }
  filter.push(`[${letzte}]format=yuvj420p[bild]`);
  args.push("-filter_complex", filter.join(";"), "-map", "[bild]", "-frames:v", "1", "-q:v", "3", ausgabe);
  await ausfuehren("ffmpeg", args);
}

/** Verkleinerte Kopie, die die KI für den Caption-Vorschlag ansieht. */
export async function fotoFuerKi(eingabe, ausgabe) {
  await ausfuehren("ffmpeg", [
    "-y", "-v", "error", "-i", eingabe,
    "-vf", "scale='min(1568,iw)':'min(1568,ih)':force_original_aspect_ratio=decrease",
    "-frames:v", "1", "-q:v", "4", ausgabe,
  ]);
}

/** Kleinere Fassung nur für die Telegram-Vorschau (Bot-API: max. 50 MB). */
export async function vorschau(eingabe, ausgabe) {
  await ausfuehren("ffmpeg", [
    "-y", "-v", "error", "-i", eingabe,
    "-vf", "scale='if(gt(iw,ih),-2,540)':'if(gt(iw,ih),540,-2)'",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart", ausgabe,
  ]);
}

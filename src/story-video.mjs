import fs from "node:fs/promises";
import path from "node:path";
import { ausfuehren, untersuche } from "./video.mjs";

// Eine Sekunde Reserve für Bildraten und Rundungen beim Verarbeiten durch Meta.
export const STORY_CLIP_SEKUNDEN = 59;
export const storyAnzahl = (dauer) => dauer > 60 ? Math.ceil(dauer / STORY_CLIP_SEKUNDEN) : 1;

/** Fertige Fassung teilen: Logo, Untertitel und Ton sind bereits enthalten.
 * Jeden Clip neu codieren, damit Schnitte nicht von Keyframes abhängen.
 * Cache und einzelne Uploads werden sofort persistiert (auch vor einem Neustart).
 */
export async function storyClipsVorbereiten(eingabe, cache, speichern) {
  const stat = await fs.stat(eingabe);
  const quelle = JSON.stringify([eingabe, stat.size, stat.mtimeMs]);
  const { dauer } = await untersuche(eingabe);
  if (!Number.isFinite(dauer) || dauer <= 0) throw new Error("Story-Videolänge konnte nicht ermittelt werden.");
  if (dauer <= 60) return null;
  if (cache?.quelle === quelle && cache.dateien?.length === storyAnzahl(dauer)) {
    try {
      await Promise.all(cache.dateien.map((datei) => fs.access(datei)));
      return cache;
    } catch { /* Fehlende Clips neu erzeugen. */ }
  }
  const dateien = [];
  for (let i = 0; i < storyAnzahl(dauer); i++) {
    const ziel = path.join(path.dirname(eingabe), `story-teil-${i + 1}.mp4`);
    await ausfuehren("ffmpeg", [
      "-y", "-v", "error", "-ss", String(i * STORY_CLIP_SEKUNDEN), "-i", eingabe,
      "-t", String(Math.min(STORY_CLIP_SEKUNDEN, dauer - i * STORY_CLIP_SEKUNDEN)),
      "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", ziel,
    ]);
    const clip = await untersuche(ziel);
    if (!(clip.dauer > 0 && clip.dauer <= 60)) throw new Error(`Story-Teil ${i + 1} hat eine ungültige Länge.`);
    dateien.push(ziel);
  }
  const neu = { quelle, dateien, hochgeladen: [] };
  await speichern(neu);
  return neu;
}

export async function storyClipsHochladen(cache, hochladen, speichern) {
  const neu = { ...cache, hochgeladen: [...cache.hochgeladen] };
  for (let i = 0; i < neu.dateien.length; i++) {
    if (neu.hochgeladen[i]) continue;
    neu.hochgeladen[i] = await hochladen(neu.dateien[i]);
    await speichern(structuredClone(neu));
  }
  return neu.hochgeladen;
}

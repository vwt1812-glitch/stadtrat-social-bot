import fs from "node:fs/promises";
import path from "node:path";
import { ausfuehren, untersuche } from "./video.mjs";

// Eine Sekunde Reserve für Bildraten und Rundungen beim Verarbeiten durch Meta.
export const STORY_CLIP_SEKUNDEN = 59;
export const storyAnzahl = (dauer) => dauer > 60 ? Math.ceil(dauer / STORY_CLIP_SEKUNDEN) : 1;

/** Fertige Fassung teilen: Logo, Untertitel und Ton sind bereits enthalten.
 * Vorbereitete Keyframes erlauben verlustfreies Kopieren; alte Videos fallen bei
 * ungeeigneten Schnittpunkten auf exaktes Neucodieren zurück.
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
  // Das Rendern setzt alle 59 Sekunden einen Keyframe. Nur umverpacken,
  // statt den fertigen Film auf dem Pi ein zweites Mal zu komprimieren.
  const tmp = await fs.mkdtemp(path.join(path.dirname(eingabe), "story-schnitt-"));
  try {
    const anzahl = storyAnzahl(dauer);
    const grenzen = Array.from({ length: anzahl - 1 }, (_, i) => (i + 1) * STORY_CLIP_SEKUNDEN);
    await ausfuehren("ffmpeg", ["-y", "-v", "error", "-i", eingabe,
      "-map", "0:v:0", "-map", "0:a?", "-c", "copy", "-f", "segment",
      "-segment_times", grenzen.join(","), "-reset_timestamps", "1",
      "-segment_format_options", "movflags=+faststart", path.join(tmp, "%03d.mp4")]);
    const namen = (await fs.readdir(tmp)).filter((n) => n.endsWith(".mp4")).sort();
    const clips = await Promise.all(namen.map((n) => untersuche(path.join(tmp, n))));
    // Kurze Abweichungen durch Audio-Pakete sind normal; große Abweichungen
    // oder zu lange Clips bedeuten ungeeignete Keyframes in einer alten Fassung.
    if (namen.length === anzahl && clips.every((c) => c.dauer > 0 && c.dauer <= 60) &&
        Math.abs(clips.reduce((sum, c) => sum + c.dauer, 0) - dauer) < 0.5 &&
        clips.slice(0, -1).every((c) => Math.abs(c.dauer - STORY_CLIP_SEKUNDEN) < 0.15)) {
      const dateien = [];
      for (const [i, name] of namen.entries()) {
        const ziel = path.join(path.dirname(eingabe), `story-teil-${i + 1}.mp4`);
        await fs.rename(path.join(tmp, name), ziel);
        dateien.push(ziel);
      }
      const neu = { quelle, dateien, hochgeladen: [] };
      await speichern(neu);
      return neu;
    }
  } catch (e) {
    console.info("Story-Schnellaufteilung nicht möglich; verwende exakte Schnitte.");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
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

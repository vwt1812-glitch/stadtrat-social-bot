import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ausfuehren, untersuche } from "./video.mjs";
import { textGrafik } from "./grafik-text.mjs";
import { grafikInhalt } from "./redaktion.mjs";
import { fotoCover } from "./cover-foto.mjs";

// Feste Ausgabeprofile sind unsere Defaults, nicht die Mindestgrößen aller Plattformen.
// Unter 2 MiB hält die JPEGs auch für konservativ konfigurierte Uploads klein.
export const THUMBNAIL_PROFILE = {
  quer: { breite: 1920, hoehe: 1080, maxBytes: 2 * 1024 ** 2, format: "quer" },
  hochkant: { breite: 1080, hoehe: 1920, maxBytes: 2 * 1024 ** 2, format: "cover-hochkant" },
  youtube: { breite: 3840, hoehe: 2160, maxBytes: 2 * 1024 ** 2, format: "quer" },
  "youtube-short": { breite: 2160, hoehe: 3840, maxBytes: 2 * 1024 ** 2, format: "cover-hochkant" },
};

export function originalProfil(masse) {
  const faktor = 1920 / Math.max(masse.breite, masse.hoehe);
  return { breite: Math.max(2, Math.round(masse.breite * faktor / 2) * 2),
    hoehe: Math.max(2, Math.round(masse.hoehe * faktor / 2) * 2), maxBytes: 2 * 1024 ** 2,
    format: masse.breite > masse.hoehe ? "quer" : masse.breite === masse.hoehe ? "story" : "cover-hochkant" };
}

export function thumbnailZiel(kanal, { modus, youtubeShort = false } = {}, mastodonPatch = false) {
  switch (kanal.identifier) {
    case "instagram": case "instagram-standalone": case "tiktok-business":
      return { profil: "hochkant", bild: true };
    case "youtube":
      return { profil: youtubeShort ? "youtube-short" : "youtube", bild: !youtubeShort,
        hinweis: youtubeShort ? "Shorts-Cover: für YouTube Studio exportiert; automatische Übernahme nicht bestätigt." : "" };
    case "tiktok":
      return { profil: "hochkant", zeit: modus === "frame", hinweis: modus === "frame"
        ? "TikTok: Frame-Auswahl nur bei öffentlichem Direct Post; nicht beim Inbox-Upload."
        : "TikTok: eigene Bildcover benötigen den Business-Anschluss; regulär nur Videoframes." };
    case "mastodon":
      return { profil: "original", bild: mastodonPatch,
        hinweis: mastodonPatch ? "Mastodon: Cover-Weitergabe für angepassten Postiz-Provider aktiviert."
          : "Mastodon über Postiz: Standard-Provider ignoriert eigene Cover. Bild wird nur exportiert." };
    default:
      return { profil: "original", bild: false, hinweis: `${kanal.identifier}: Cover nur zum Herunterladen; keine bestätigte automatische Übertragung.` };
  }
}

export function frameZeit(text, dauer) {
  const s = String(text).trim().replace(",", ".");
  if (!/^(?:\d+:)?\d+(?:\.\d{1,3})?$/.test(s)) throw new Error("Zeit als Sekunden oder MM:SS eingeben, z. B. 3.5 oder 01:12.");
  const teile = s.split(":").map(Number);
  if (teile.length === 2 && teile[1] >= 60) throw new Error("Sekunden nach dem Doppelpunkt müssen unter 60 liegen.");
  const ms = Math.round((teile.length === 2 ? teile[0] * 60 + teile[1] : teile[0]) * 1000);
  if (!Number.isSafeInteger(ms) || ms < 0 || !Number.isFinite(dauer) || dauer <= 0 || ms >= dauer * 1000) {
    throw new Error("Der Zeitpunkt muss innerhalb des Videos liegen.");
  }
  return ms;
}

export async function videoStand(datei) {
  const stat = await fs.stat(datei);
  return { datei, groesse: stat.size, geaendert: stat.mtimeMs };
}

export async function jpegProfil(eingabe, ausgabe, profil) {
  for (const q of [3, 6, 10, 16, 24, 31]) {
    await ausfuehren("ffmpeg", ["-y", "-v", "error", "-i", eingabe, "-vf",
      `scale=${profil.breite}:${profil.hoehe}:force_original_aspect_ratio=decrease,pad=${profil.breite}:${profil.hoehe}:(ow-iw)/2:(oh-ih)/2:color=0x1D1D1B,setsar=1,format=yuvj420p`,
      "-frames:v", "1", "-map_metadata", "-1", "-q:v", String(q), ausgabe]);
    if ((await fs.stat(ausgabe)).size <= profil.maxBytes) return ausgabe;
  }
  throw new Error("Das Titelbild lässt sich nicht sicher unter 2 MiB verkleinern. Bitte ein einfacheres Bild wählen.");
}

export async function thumbnailsErstellen({ ordner, video, quelle = video, layout, optionen, kanaele, mastodonPatch = false }) {
  const masse = await untersuche(video);
  const stand = await videoStand(video);
  const ausgabeDir = path.join(ordner, `cover-${randomBytes(4).toString("hex")}`);
  await fs.mkdir(ausgabeDir, { recursive: true });
  let bild = optionen.bild;
  if (optionen.modus === "frame") {
    const ms = frameZeit(String(optionen.frameMs / 1000), masse.dauer);
    bild = path.join(ausgabeDir, "frame.jpg");
    await ausfuehren("ffmpeg", ["-y", "-v", "error", "-ss", String(ms / 1000), "-i", quelle,
      "-frames:v", "1", "-q:v", "2", bild]);
  }
  if (!["text", "frame", "bild"].includes(optionen.modus) || (optionen.modus !== "text" && !bild)) throw new Error("Bitte zuerst ein Bild oder einen Videoframe auswählen.");
  const profile = new Set(["original", ...(optionen.quer ? ["quer"] : []), ...kanaele.map((k) => thumbnailZiel(k, optionen, mastodonPatch).profil)]);
  const dateien = {};
  for (const key of profile) {
    const profil = key === "original" ? originalProfil(masse) : THUMBNAIL_PROFILE[key];
    let eingabe = bild;
    if (optionen.modus === "text" || optionen.mitText) {
      const inhalt = grafikInhalt(optionen.text);
      // Cover sind kurz. Keine unsichtbare Kürzung längerer Erklärtexte.
      if (inhalt.gekuerzt || [...inhalt.titel].length > 70 || [...inhalt.beschreibung].length > 60) {
        throw new Error("Bitte eine Cover-Überschrift bis 70 Zeichen und optional bis 60 Zeichen Erklärung schreiben.");
      }
      eingabe = path.join(ausgabeDir, `${key}-grafik.jpg`);
      if (optionen.modus !== "text" && optionen.vorlage !== "grafik") {
        await fotoCover({ ausgabe: eingabe, inhalt, layout, bild, quer: profil.breite > profil.hoehe });
      } else {
        await textGrafik({ ausgabe: eingabe, inhalt, layout, format: profil.format,
          hintergrund: optionen.modus === "text" ? null : bild });
      }
    }
    const ziel = path.join(ausgabeDir, `${key}.jpg`);
    await jpegProfil(eingabe, ziel, profil);
    dateien[key] = ziel;
  }
  return { ...optionen, dateien, hochgeladen: {}, videoStand: stand };
}

export function coverBedarf(thumbnail, kanaele, mastodonPatch = false) {
  if (!thumbnail) return 0;
  return new Set(kanaele.map((k) => thumbnailZiel(k, thumbnail, mastodonPatch))
    .filter((z) => z.bild && thumbnail.dateien?.[z.profil] && !thumbnail.hochgeladen?.[z.profil]).map((z) => z.profil)).size;
}

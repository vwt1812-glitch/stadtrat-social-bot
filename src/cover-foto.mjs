import fs from "node:fs/promises";
import path from "node:path";
import { ausfuehren, logoGrafik, storyFlaeche, textBreite } from "./video.mjs";
import { ausgewogeneZeilen, logoFuerGrafik } from "./grafik-text.mjs";

// Beide mittigen Zuschnitte bleiben erhalten: 4:5 (y=285..1635), 3:4 (y=240..1680).
// Zusätzlich 20 px Innenabstand. Keine Beschriftung über dem Foto.
export function fotoCoverBereiche({ balkenHoehe, logoHoehe = 0 }) {
  const oben = 305, unten = 1615;
  const logoY = oben + 20;
  const fotoY = oben + (logoHoehe ? logoHoehe + 40 : 0);
  const balkenY = unten - balkenHoehe;
  const fotoHoehe = balkenY - fotoY;
  if (fotoHoehe < 560) throw new Error("Bitte den Covertext kürzen, damit genug Platz für das Foto bleibt.");
  return { oben, unten, logoY, fotoY, fotoHoehe, balkenY };
}

// Foto bleibt vollständig sichtbar. Nur die Hintergrundfläche wird beschnitten.
// Gestaltung wie die bisherigen Fotocover: Logo oben, orange Aussage auf dunklem Balken.
export async function fotoCover({ ausgabe, inhalt, layout, bild, quer = false }) {
  const masse = { breite: 1080, hoehe: quer ? 608 : 1920 };
  const ordner = path.dirname(ausgabe);
  const schrift = path.join(layout.schriftOrdner, "Inter-Bold.otf");
  const normal = path.join(layout.schriftOrdner, "Inter-Medium.otf");
  const logo = layout.logo ? await logoGrafik({ layout: { ...layout,
    logo: logoFuerGrafik(layout.logo, "hell"), logoBreite: quer ? 0.68 : 0.62,
    logoStil: "frei", logoPosition: "oben-links", smartLogo: false, bild: null,
  }, masse, ordner, video: false }) : null;
  const titel = String(inhalt.titel ?? "").trim();
  if (!titel) throw new Error("Bitte eine Überschrift für das Fotocover eingeben.");
  const body = String(inhalt.beschreibung ?? "").trim();
  const bodySize = quer ? 24 : 42;
  const bodyZeilen = body ? ausgewogeneZeilen(body, quer ? 64 : 38) : [];
  if (bodyZeilen.length > 2) throw new Error("Bitte den Erklärungstext auf höchstens zwei kurze Zeilen kürzen.");
  let fit;
  for (let size = quer ? 84 : 110; size >= (quer ? 60 : 90); size -= 4) {
    const zeilen = ausgewogeneZeilen(titel, 960 / (size * 0.56));
    if (!zeilen.length || zeilen.length > 3) continue;
    if (quer && zeilen.length * Math.round(size * 1.18) + 64 + bodyZeilen.length * (bodySize + 10) > 400) continue;
    let passt = true;
    for (const [i, zeile] of zeilen.entries()) {
      const datei = path.join(ordner, `cover-foto-titel-${i}.txt`);
      await fs.writeFile(datei, zeile, "utf8");
      if (await textBreite(datei, schrift, size) > 960) passt = false;
    }
    if (passt) { fit = { size, zeilen }; break; }
  }
  if (!fit) throw new Error("Bitte den Fotocover-Titel kürzen, damit er auf dem Handy lesbar bleibt.");
  const zeilenHoehe = Math.round(fit.size * 1.18);
  const balkenHoehe = fit.zeilen.length * zeilenHoehe + 64 + bodyZeilen.length * (bodySize + 10);
  const bereiche = quer ? null : fotoCoverBereiche({ balkenHoehe, logoHoehe: logo?.sichtbar.h ?? 0 });
  const balkenY = quer ? Math.max(180, masse.hoehe - balkenHoehe - 24) : bereiche.balkenY;
  const filter = quer ? [`[0:v]${storyFlaeche(masse)}[foto]`] : [
    `[0:v]split[hintergrund][motiv]`,
    `[hintergrund]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:2[unscharf]`,
    `[motiv]scale=1080:${Math.floor(bereiche.fotoHoehe / 2) * 2}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2[scharf]`,
    `[unscharf][scharf]overlay=(W-w)/2:${bereiche.fotoY}+(${bereiche.fotoHoehe}-h)/2,setsar=1[foto]`,
  ];
  const zeichnen = [`drawbox=x=0:y=${balkenY}:w=iw:h=${balkenHoehe}:color=0x1D1D1B:t=fill`];
  for (const [i] of fit.zeilen.entries()) {
    zeichnen.push(`drawtext=fontfile='${schrift}':textfile='cover-foto-titel-${i}.txt':expansion=none:fontsize=${fit.size}:fontcolor=0xF18616:x=(w-text_w)/2:y=${balkenY + 28 + i * zeilenHoehe}`);
  }
  for (const [i, zeile] of bodyZeilen.entries()) {
    const datei = `cover-foto-body-${i}.txt`;
    await fs.writeFile(path.join(ordner, datei), zeile, "utf8");
    if (await textBreite(path.join(ordner, datei), normal, bodySize) > 960) throw new Error("Bitte den Erklärungstext kürzen.");
    zeichnen.push(`drawtext=fontfile='${normal}':textfile='${datei}':expansion=none:fontsize=${bodySize}:fontcolor=white:x=(w-text_w)/2:y=${balkenY + 36 + fit.zeilen.length * zeilenHoehe + i * (bodySize + 10)}`);
  }
  const args = ["-y", "-v", "error", "-i", bild];
  let ziel = "text";
  if (logo) {
    args.push("-i", logo.datei);
    const oben = quer ? 18 : bereiche.logoY;
    zeichnen.push(`drawbox=x=0:y=${quer ? 0 : bereiche.oben}:w=iw:h=${quer ? logo.sichtbar.h + oben * 2 : logo.sichtbar.h + 40}:color=white@0.88:t=fill`);
    filter.push(`[foto]${zeichnen.join(",")}[text]`);
    filter.push(`[text][1:v]overlay=${Math.round((masse.breite - logo.sichtbar.w) / 2)}:${oben}:format=auto[cover]`);
    ziel = "cover";
  } else filter.push(`[foto]${zeichnen.join(",")}[text]`);
  args.push("-filter_complex", filter.join(";"), "-map", `[${ziel}]`, "-frames:v", "1", "-q:v", "3", ausgabe);
  await ausfuehren("ffmpeg", args, { cwd: ordner });
  return ausgabe;
}

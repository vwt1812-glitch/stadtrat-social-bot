import fs from "node:fs/promises";
import path from "node:path";
import { ausfuehren, logoGrafik, textBreite, untersuche } from "./video.mjs";
import { ausgewogeneZeilen, logoFuerGrafik } from "./grafik-text.mjs";

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Füllt die Zielfläche ohne Strecken und künstliche Ränder; Gesicht, falls erkannt, im Zentrum.
export function coverFotoAusschnitt(original, ziel, gesichter = []) {
  const faktor = Math.max(ziel.breite / original.breite, ziel.hoehe / original.hoehe);
  const breite = Math.max(2, Math.floor(ziel.breite / faktor / 2) * 2);
  const hoehe = Math.max(2, Math.floor(ziel.hoehe / faktor / 2) * 2);
  const g = [...gesichter].filter((g) => [g.x, g.y, g.w, g.h].every(Number.isFinite))
    .sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const x = Math.floor(clamp((g ? g.x + g.w / 2 : 0.5) * original.breite - breite / 2, 0, original.breite - breite) / 2) * 2;
  const y = Math.floor(clamp((g ? g.y + g.h / 2 : 0.5) * original.hoehe - hoehe / 2, 0, original.hoehe - hoehe) / 2) * 2;
  return { x, y, breite, hoehe };
}

// Logo und Balken bleiben in beiden mittigen Zuschnitten (4:5 / 3:4).
// Das Foto dahinter bleibt vollflächig, statt zwischen Logo und Text zu schrumpfen.
export function fotoCoverBereiche({ balkenHoehe, logoHoehe = 0, gesichter = [], textPosition = "auto" }) {
  const oben = 305, unten = 1615, abstand = 20;
  const kandidaten = [
    { logoY: oben, balkenY: unten - balkenHoehe, position: "unten" },
    { logoY: oben, balkenY: oben + logoHoehe + 2 * abstand, position: "oben" },
    { logoY: unten - logoHoehe, balkenY: oben, position: "oben" },
    { logoY: unten - logoHoehe, balkenY: unten - logoHoehe - 2 * abstand - balkenHoehe, position: "unten" },
  ].filter((p) => p.balkenY >= oben && p.balkenY + balkenHoehe <= unten &&
    (p.balkenY >= p.logoY + logoHoehe + abstand || p.balkenY + balkenHoehe + abstand <= p.logoY) &&
    (textPosition === "auto" || p.position === textPosition));
  if (!kandidaten.length) throw new Error("Bitte den Covertext kürzen.");
  const schnitt = (y, h, g) => Math.max(0, Math.min(y + h, g.y + g.h + 24) - Math.max(y, g.y - 24));
  const wert = (p) => gesichter.reduce((s, g) => s + schnitt(p.balkenY, balkenHoehe, g) + schnitt(p.logoY - 16, logoHoehe + 32, g), 0);
  kandidaten.sort((a, b) => wert(a) - wert(b));
  return { oben, unten, ...kandidaten[0] };
}

export const QUER_COVER = Object.freeze({ bildBreite: 500, textX: 536, textBreite: 508, titelOben: 180 });

export async function fotoCover({ ausgabe, inhalt, layout, bild, quer = false, gesichter = [], textPosition = "auto" }) {
  if (!["auto", "oben", "unten"].includes(textPosition)) throw new Error("Ungültige Titelbild-Textposition.");
  const masse = { breite: 1080, hoehe: quer ? 608 : 1920 };
  const original = await untersuche(bild);
  const zielBild = quer ? { breite: QUER_COVER.bildBreite, hoehe: masse.hoehe } : masse;
  const crop = coverFotoAusschnitt(original, zielBild, gesichter);
  const uebertragen = gesichter.map((g) => ({
    y: (g.y * original.hoehe - crop.y) * zielBild.hoehe / crop.hoehe,
    h: g.h * original.hoehe * zielBild.hoehe / crop.hoehe,
  }));
  const ordner = path.dirname(ausgabe);
  const schrift = path.join(layout.schriftOrdner, "Inter-Bold.otf");
  const normal = path.join(layout.schriftOrdner, "Inter-Medium.otf");
  const logo = layout.logo ? await logoGrafik({ layout: { ...layout,
    logo: logoFuerGrafik(layout.logo, "hell"), logoBreite: quer ? 0.68 : 0.56,
    logoStil: "frei", logoPosition: "oben-links", smartLogo: false, bild: null,
  }, masse, ordner, video: false }) : null;
  const titel = String(inhalt.titel ?? "").trim();
  if (!titel) throw new Error("Bitte eine Überschrift für das Fotocover eingeben.");
  const bodySize = quer ? 24 : 42;
  const bodyZeilen = inhalt.beschreibung ? ausgewogeneZeilen(inhalt.beschreibung, quer ? 34 : 38) : [];
  if (bodyZeilen.length > 2) throw new Error("Bitte den Erklärungstext auf höchstens zwei kurze Zeilen kürzen.");
  const maxBreite = quer ? QUER_COVER.textBreite : 960;
  let fit;
  for (let size = quer ? 84 : 102; size >= (quer ? 52 : 86); size -= 4) {
    const zeilen = ausgewogeneZeilen(titel, maxBreite / (size * 0.56));
    if (!zeilen.length || zeilen.length > (quer ? 4 : 3)) continue;
    if (quer && zeilen.length * Math.round(size * 1.18) + (bodyZeilen.length ? 24 + bodyZeilen.length * (bodySize + 10) : 0) > 392) continue;
    let passt = true;
    for (const [i, zeile] of zeilen.entries()) {
      const datei = path.join(ordner, `cover-foto-titel-${i}.txt`);
      await fs.writeFile(datei, zeile, "utf8");
      if (await textBreite(datei, schrift, size) > maxBreite) passt = false;
    }
    if (passt) { fit = { size, zeilen }; break; }
  }
  if (!fit) throw new Error("Bitte den Fotocover-Titel kürzen, damit er auf dem Handy lesbar bleibt.");
  const zeilenHoehe = Math.round(fit.size * 1.18);
  const titelHoehe = fit.zeilen.length * zeilenHoehe;
  const balkenHoehe = titelHoehe + 48 + bodyZeilen.length * (bodySize + 10);
  const bereiche = quer ? null : fotoCoverBereiche({ balkenHoehe, logoHoehe: logo?.sichtbar.h ?? 0, gesichter: uebertragen, textPosition });
  const titelY = quer ? QUER_COVER.titelOben : bereiche.balkenY + 20;
  const bildFilter = `crop=${crop.breite}:${crop.hoehe}:${crop.x}:${crop.y},scale=${zielBild.breite}:${zielBild.hoehe},setsar=1`;
  const filter = [`[0:v]${bildFilter}${quer ? ",pad=1080:608:0:0:color=0x1D1D1B" : ""}[foto]`];
  const zeichnen = quer ? [] : [`drawbox=x=0:y=${bereiche.balkenY}:w=iw:h=${balkenHoehe}:color=0x1D1D1B:t=fill`];
  for (const [i] of fit.zeilen.entries()) {
    zeichnen.push(`drawtext=fontfile='${schrift}':textfile='cover-foto-titel-${i}.txt':expansion=none:fontsize=${fit.size}:fontcolor=0xF18616:x=${quer ? QUER_COVER.textX : "(w-text_w)/2"}:y=${titelY + i * zeilenHoehe}`);
  }
  for (const [i, zeile] of bodyZeilen.entries()) {
    const datei = `cover-foto-body-${i}.txt`;
    await fs.writeFile(path.join(ordner, datei), zeile, "utf8");
    if (await textBreite(path.join(ordner, datei), normal, bodySize) > maxBreite) throw new Error("Bitte den Erklärungstext kürzen.");
    zeichnen.push(`drawtext=fontfile='${normal}':textfile='${datei}':expansion=none:fontsize=${bodySize}:fontcolor=white:x=${quer ? QUER_COVER.textX : "(w-text_w)/2"}:y=${titelY + titelHoehe + 12 + i * (bodySize + 10)}`);
  }
  const args = ["-y", "-v", "error", "-i", bild];
  let ziel = "text";
  if (logo) {
    args.push("-i", logo.datei);
    const oben = quer ? 30 : bereiche.logoY;
    const links = quer ? QUER_COVER.bildBreite : 0;
    const breite = masse.breite - links;
    zeichnen.push(`drawbox=x=${links}:y=${oben - 16}:w=${breite}:h=${logo.sichtbar.h + 32}:color=white@0.88:t=fill`);
    filter.push(`[foto]${zeichnen.join(",")}[text]`);
    filter.push(`[text][1:v]overlay=${links + Math.round((breite - logo.sichtbar.w) / 2)}:${oben}:format=auto[cover]`);
    ziel = "cover";
  } else filter.push(`[foto]${zeichnen.join(",")}[text]`);
  args.push("-filter_complex", filter.join(";"), "-map", `[${ziel}]`, "-frames:v", "1", "-q:v", "3", ausgabe);
  await ausfuehren("ffmpeg", args, { cwd: ordner });
  return ausgabe;
}

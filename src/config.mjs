import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hier = path.dirname(fileURLToPath(import.meta.url));
export const BOT_DIR = path.resolve(hier, "..");

const envDatei = path.join(BOT_DIR, ".env");
if (fs.existsSync(envDatei)) process.loadEnvFile(envDatei);

const env = (name, standard) => {
  const wert = process.env[name]?.trim();
  return wert ? wert : standard;
};
const pflicht = (name) => {
  const wert = env(name);
  if (!wert) throw new Error(`${name} fehlt – bitte in social-bot/.env eintragen (Vorlage: .env.example).`);
  return wert;
};
const liste = (name) => (env(name, "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const pfad = (wert) => (wert ? path.resolve(BOT_DIR, wert) : wert);

process.env.TZ = env("ZEITZONE", "Europe/Berlin");

function captionConfig() {
  const anthropicKey = env("ANTHROPIC_API_KEY");
  const openaiKey = env("OPENAI_API_KEY");
  const anbieter = env("CAPTION_ANBIETER", anthropicKey ? "claude" : openaiKey ? "openai" : "");
  if (anbieter && !["claude", "openai"].includes(anbieter)) throw new Error(`CAPTION_ANBIETER muss claude oder openai sein, nicht „${anbieter}“.`);
  if (anbieter === "claude" && !anthropicKey) throw new Error("CAPTION_ANBIETER=claude braucht ANTHROPIC_API_KEY.");
  if (anbieter === "openai" && !openaiKey) throw new Error("CAPTION_ANBIETER=openai braucht OPENAI_API_KEY.");
  return {
    anbieter: anbieter || null,
    anthropicKey,
    openaiKey,
    openaiUrl: env("OPENAI_BASE_URL"),
    modell: env("CAPTION_MODELL", anbieter === "openai" ? "gpt-5.5" : "claude-opus-5-5"),
    stil: env("CAPTION_STIL", ""),
    hashtags: env("CAPTION_HASHTAGS", "#Nürnberg #Stadtrat"),
  };
}

/** Logo-Datei; die frühere Vorgabe assets/logo.png gibt es nicht mehr. */
function logoPfad() {
  const wert = env("LOGO", "assets/logos/quer-dunkel.png");
  if (/(^|\/)assets\/logo\.png$/.test(wert)) return pfad("assets/logos/quer-dunkel.png");
  return pfad(wert);
}

export function ladeConfig() {
  const mastodonAnbindung = env("MASTODON_ANBINDUNG", "postiz");
  if (!["postiz", "direkt"].includes(mastodonAnbindung)) throw new Error("MASTODON_ANBINDUNG muss postiz oder direkt sein.");
  return {
    telegram: {
      token: pflicht("TELEGRAM_BOT_TOKEN"),
      api: env("TELEGRAM_API_URL", "https://api.telegram.org").replace(/\/$/, ""),
      // Telegram-IDs von Personen oder Gruppen (Gruppen-IDs sind negativ)
      erlaubt: liste("ERLAUBTE_NUTZER").map(Number),
    },
    postiz: {
      url: pflicht("POSTIZ_URL").replace(/\/$/, ""),
      apiKey: pflicht("POSTIZ_API_KEY"),
      kanaele: liste("POSTIZ_KANAELE"),
      kunde: env("POSTIZ_KUNDE", ""),
      // Postiz-Standard API_LIMIT=30 pro Stunde; 0 = nicht mitzählen
      maxAnfragen: Number(env("POSTIZ_MAX_ANFRAGEN", "28")),
      einstellungen: pfad(env("KANAL_EINSTELLUNGEN", "kanaele.json")),
      // Nur nach Installation des dokumentierten Postiz-Patches einschalten.
      mastodonThumbnails: env("POSTIZ_MASTODON_THUMBNAILS", "nein") === "ja",
    },
    whisper: {
      bin: env("WHISPER_BIN", "whisper-cli"),
      modell: pfad(pflicht("WHISPER_MODELL")),
      threads: Number(env("WHISPER_THREADS", "4")),
      sprache: env("WHISPER_SPRACHE", "de"),
    },
    glossar: pfad(env("GLOSSAR", "glossar.txt")),
    // Python mit OpenCV für die Gesichtssuche (pi/install.sh legt es an); fehlt es, bleibt die Suche aus
    gesicht: { python: pfad(env("GESICHT_PYTHON", ".venv/bin/python")) },
    layout: {
      logo: logoPfad(),
      logoPosition: env("LOGO_POSITION", "oben-links"),
      logoBreite: Number(env("LOGO_BREITE", "0.48")),
      // karte = auf dunkler, abgerundeter Karte mit Akzentlinie; frei = Logo ohne Fläche
      logoStil: env("LOGO_STIL", env("LOGO_HINTERGRUND") === "nein" ? "frei" : "karte"),
      karteFarbe: env("KARTE_FARBE", "#1D1D1B"),
      akzentFarbe: env("AKZENT_FARBE", "#F18616"),
      logoAufFotos: env("LOGO_AUF_FOTOS", "nein") !== "nein",
      schrift: env("SCHRIFT", "Inter"),
      schriftOrdner: pfad(env("SCHRIFT_ORDNER", "assets/fonts")),
      farbe: env("UNTERTITEL_FARBE", "#FFFFFF"),
      rand: env("UNTERTITEL_RAND", "#000000"),
      stil: env("UNTERTITEL_STIL", "rand"),
      // Abstand vom unteren Rand als Anteil der Höhe – hochkant über Name und Caption von TikTok/Reels
      position: Number(env("UNTERTITEL_POSITION", "0.33")),
      positionQuer: Number(env("UNTERTITEL_POSITION_QUER", "0.08")),
      // 1 = kurze Häppchen in einer Zeile, 2 = bis zu zwei Zeilen
      zeilen: Number(env("UNTERTITEL_ZEILEN", "1")),
      // balken = schräge Balken orange/schwarz, die einwischen; karte = dunkle Karte wie das Logo
      bauchbindeStil: env("BAUCHBINDE_STIL", "balken"),
      bauchbindeStart: Number(env("BAUCHBINDE_START", "0.5")),
      bauchbindeDauer: Number(env("BAUCHBINDE_DAUER", "4")),
    },
    // Querformat-Videos für Instagram/TikTok in 9:16 (pro Video im Menü umschaltbar)
    hochkant: {
      netze: liste("HOCHKANT_NETZE").length ? liste("HOCHKANT_NETZE") : ["instagram", "instagram-standalone", "tiktok", "tiktok-business"],
      standard: env("HOCHKANT_STANDARD", "nein") === "ja",
    },
    bauchbinde: {
      name: env("BAUCHBINDE_NAME", ""),
      funktion: env("BAUCHBINDE_FUNKTION", ""),
      standard: env("BAUCHBINDE_STANDARD", "nein") === "ja",
    },
    video: {
      encoder: env("VIDEO_ENCODER", "libx264"),
      preset: env("VIDEO_PRESET", "veryfast"),
      crf: env("VIDEO_CRF", "21"),
    },
    caption: captionConfig(),
    // Postiz ist Standard. Der frühere direkte Anschluss bleibt ausdrücklich wählbar.
    mastodon: mastodonAnbindung === "direkt" && env("MASTODON_URL") && env("MASTODON_TOKEN")
      ? {
          url: env("MASTODON_URL"),
          token: env("MASTODON_TOKEN"),
          sichtbarkeit: env("MASTODON_SICHTBARKEIT", "unlisted"),
          inhaltswarnung: env("MASTODON_INHALTSWARNUNG", ""),
        }
      : null,
    datenDir: pfad(env("DATEN_DIR", "daten")),
  };
}

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

export function ladeConfig() {
  return {
    telegram: {
      token: pflicht("TELEGRAM_BOT_TOKEN"),
      api: env("TELEGRAM_API_URL", "https://api.telegram.org").replace(/\/$/, ""),
      erlaubt: liste("ERLAUBTE_NUTZER").map(Number),
    },
    postiz: {
      url: pflicht("POSTIZ_URL").replace(/\/$/, ""),
      apiKey: pflicht("POSTIZ_API_KEY"),
      kanaele: liste("POSTIZ_KANAELE"),
      einstellungen: pfad(env("KANAL_EINSTELLUNGEN", "kanaele.json")),
    },
    whisper: {
      bin: env("WHISPER_BIN", "whisper-cli"),
      modell: pfad(pflicht("WHISPER_MODELL")),
      threads: Number(env("WHISPER_THREADS", "4")),
      sprache: env("WHISPER_SPRACHE", "de"),
    },
    glossar: pfad(env("GLOSSAR", "glossar.txt")),
    layout: {
      logo: pfad(env("LOGO", "assets/logo.png")),
      logoPosition: env("LOGO_POSITION", "oben-rechts"),
      logoBreite: Number(env("LOGO_BREITE", "0.3")),
      logoHintergrund: env("LOGO_HINTERGRUND", "ja") !== "nein",
      schrift: env("SCHRIFT", "DejaVu Sans"),
      schriftOrdner: pfad(env("SCHRIFT_ORDNER", "")),
      farbe: env("UNTERTITEL_FARBE", "#FFFFFF"),
      rand: env("UNTERTITEL_RAND", "#000000"),
      stil: env("UNTERTITEL_STIL", "rand"),
      position: Number(env("UNTERTITEL_POSITION", "0.18")),
    },
    video: {
      encoder: env("VIDEO_ENCODER", "libx264"),
      preset: env("VIDEO_PRESET", "veryfast"),
      crf: env("VIDEO_CRF", "21"),
    },
    caption: {
      anthropicKey: env("ANTHROPIC_API_KEY"),
      modell: env("CAPTION_MODELL", "claude-opus-5-5"),
      stil: env("CAPTION_STIL", ""),
      hashtags: env("CAPTION_HASHTAGS", "#Nürnberg #Stadtrat"),
    },
    datenDir: pfad(env("DATEN_DIR", "daten")),
  };
}

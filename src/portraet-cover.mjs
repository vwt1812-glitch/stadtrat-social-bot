import {readFileSync} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ausfuehren, untersuche } from "./video.mjs";
import { ausgewogeneZeilen, logoFuerGrafik } from "./grafik-text.mjs";
import { untertitelTextBreite } from "./untertitel.mjs";

export const PORTRAET_HINTERGRUENDE = Object.freeze({
  original: "Originalfoto", orange: "Anthrazit mit Orange", dunkel: "Anthrazit", ratssaal: "Sitzungssaal", video: "Stadtrat / Videobild", eigen: "Eigenes Foto",
});

export async function portraetFreistellen(eingabe, ordner, python) {
  const daten=await fs.readFile(eingabe),hash=createHash("sha256").update(daten).digest("hex").slice(0,16);
  const ziel=path.join(ordner,`portraet-v3-${hash}.png`);
  try {await fs.access(ziel);return ziel;} catch {}
  // Bereits transparente PNGs brauchen weder OpenCV noch eine neue Segmentierung.
  if(daten.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&[4,6].includes(daten[25])) {
    const alpha=await ausfuehren("ffmpeg",["-v","error","-i",eingabe,"-vf","alphaextract,scale=1:1","-frames:v","1","-f","rawvideo","-pix_fmt","gray","pipe:1"],{binaer:true});
    if(alpha[0]<255) {await fs.copyFile(eingabe,ziel);return ziel;}
  }
  if(!python)throw Error("Die automatische Freistellung ist hier nicht eingerichtet. Bitte ein transparentes PNG verwenden.");
  try {await ausfuehren(python,[fileURLToPath(new URL("./portraet-freistellen.py",import.meta.url)),eingabe,ziel]);}
  catch(e) {console.error("Porträt-Freistellung:",e.message);throw Error("Porträt nicht freigestellt. Bitte ein Foto vor hellem, ruhigem Hintergrund oder ein transparentes PNG schicken.");}
  return ziel;
}

export const PORTRAET_SCHRIFTEN=Object.freeze({politics:"PoliticsHead (Styleguide)",klassisch:"Klassisch (Arial-ähnlich)",inter:"Inter"});
const klassisch=JSON.parse(readFileSync(new URL("../assets/fonts/liberation-bold-metriken.json",import.meta.url)));
const politics=JSON.parse(readFileSync(new URL("../assets/fonts/politicshead-metriken.json",import.meta.url)));
const bodyFont=JSON.parse(readFileSync(new URL("../assets/fonts/dejavu-condensed-metriken.json",import.meta.url)));
const breiteMit=(text,size,m)=>[...text].reduce((n,c)=>n+(m.advances[c]??2*m.unitsPerEm),0)*size/m.unitsPerEm;
export function portraetTextBreite(text,size,schrift="politics") {
  if(schrift==="inter")return untertitelTextBreite(text,size);
  return breiteMit(schrift==="politics"?text.toLocaleUpperCase("de-DE"):text,size,schrift==="politics"?politics:klassisch);
}

export function portraetTitel(text, quer=false,schrift="politics") {
  const breite=quer?800:840;
  if(schrift==="politics")text=text.toLocaleUpperCase("de-DE");
  for(const maxZeilen of [2,3])for(let size=maxZeilen===3?82:quer?98:90;size>=58;size-=4) {
    const zeilen=ausgewogeneZeilen(text,breite/(size*.56));
    if(zeilen.length&&zeilen.length<=maxZeilen&&zeilen.every(z=>portraetTextBreite(z,size,schrift)<=breite))return {size,zeilen};
  }
  throw Error("Bitte den Porträt-Titel kürzen, damit er groß und vollständig lesbar bleibt.");
}

export async function portraetCover({ausgabe,inhalt,layout,portraet,freigestellt,hintergrund="orange",hintergrundBild,quer=false,unterzeile="",schrift="politics"}) {
  if(!Object.hasOwn(PORTRAET_HINTERGRUENDE,hintergrund))throw Error("Unbekannter Porträt-Hintergrund.");
  const dir=path.dirname(ausgabe),w=quer?1920:1080,h=quer?1080:1920;
  if(!Object.hasOwn(PORTRAET_SCHRIFTEN,schrift))throw Error("Unbekannte Schrift.");
  const titel=portraetTitel(inhalt.titel,quer,schrift),line=Math.round(titel.size*1.12);
  // Portrait reference: both rectangles continue beyond the right image edge,
  // including for short titles. Orange is a separate rectangle shifted down/left.
  const innenX=64,innenY=44,versatzX=14,versatzY=18;
  const panelW=quer?Math.ceil(Math.max(...titel.zeilen.map(z=>portraetTextBreite(z,titel.size,schrift)))+2*innenX+versatzX):1120;
  const panelH=(titel.zeilen.length-1)*line+titel.size+2*innenY+versatzY;
  const winkel=-.14,rotH=Math.ceil(panelW*Math.abs(Math.sin(winkel))+panelH*Math.cos(winkel));
  await fs.copyFile(path.join(layout.schriftOrdner,({politics:"PoliticsHead-Bold.ttf",inter:"Inter-Bold.otf",klassisch:"LiberationSans-Bold.ttf"})[schrift]),path.join(dir,"portraet-font.otf"));
  await fs.copyFile(path.join(layout.schriftOrdner,"DejaVuSansCondensed.ttf"),path.join(dir,"portraet-body.ttf"));
  const foto=await untersuche(hintergrund==="original"?portraet:freigestellt);
  const ph=quer?1050:1590,pw=Math.round(ph*foto.breite/foto.hoehe/2)*2;
  const px=quer?w-pw+60:Math.round((w-pw)/2)+45,py=quer?70:530;
  const args=["-y","-v","error"];
  const filter=[];
  let index=0;
  if(["video","eigen","ratssaal"].includes(hintergrund)) {
    if(!hintergrundBild)throw Error("Bitte zuerst ein Hintergrundfoto auswählen.");
    args.push("-i",hintergrundBild);index++;
    const licht="(0.12+0.68*max(0,(Y/H-0.30)/0.70))";
    filter.push(`[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=${hintergrund==="ratssaal"?3:10}:1,hue=s=0,format=rgb24,geq=r='r(X,Y)*${licht}':g='g(X,Y)*${licht}':b='b(X,Y)*${licht}',setsar=1[grund]`);
  } else {
    // Orange bleibt Markenakzent; die Logofläche ist neutral und kontrastreich.
    const farbe=hintergrund==="original"?"0xE5E6E7":"0x1D1D1B";
    const akzent=hintergrund==="orange"?`,drawbox=x=0:y=0:w=24:h=ih:color=0xF18616:t=fill,drawbox=x=0:y=ih-16:w=iw:h=16:color=0xF18616:t=fill`:"";
    filter.push(`color=c=${farbe}:s=${w}x${h}:d=1${akzent}[grund]`);
  }
  args.push("-i",hintergrund==="original"?portraet:freigestellt);
  // Keep the canvas opaque RGB: automatic negotiation can quantize soft alpha edges.
  filter.push(`[${index}:v]scale=${pw}:${ph}:flags=lanczos,format=rgba[person];[grund][person]overlay=${px}:${py}:format=rgb[basis]`);
  index++;
  let label="basis";
  if(layout.logo) {
    const logoDatei=logoFuerGrafik(layout.logo,hintergrund==="original"?"hell":"dunkel"),logoInfo=await untersuche(logoDatei);
    args.push("-i",logoDatei);
    const lw=Math.round(Math.min(quer?850:930,(quer?190:210)*logoInfo.breite/logoInfo.hoehe));
    const lx=quer?60:Math.round((w-lw)/2),ly=quer?60:305;
    filter.push(`[${index}:v]scale=${lw}:-1,format=rgba[logo];[${label}][logo]overlay=${lx}:${ly}:format=rgb[marke]`);
    label="marke";index++;
  }
  const zeichnen=[
    `drawbox=x=0:y=${versatzY}:w=iw-${versatzX}:h=ih-${versatzY}:color=0xF18616:t=fill:replace=1`,
    `drawbox=x=${versatzX}:y=0:w=iw-${versatzX}:h=ih-${versatzY}:color=black:t=fill:replace=1`,
  ];
  for(const [i,z] of titel.zeilen.entries()) {
    const name=`portraet-titel-${i}.txt`;await fs.writeFile(path.join(dir,name),z);
    zeichnen.push(`drawtext=fontfile=portraet-font.otf:textfile=${name}:expansion=none:fontsize=${titel.size}:fontcolor=white:x=${versatzX+innenX}:y=${innenY+i*line}`);
  }
  filter.push(`color=c=black@0:s=${panelW}x${panelH}:d=1,format=rgba,${zeichnen.join(",")},rotate=${winkel}:ow=rotw(${winkel}):oh=roth(${winkel}):c=none[panel]`);
  filter.push(`[${label}][panel]overlay=${quer?45:60}:${quer?Math.min(560,900-rotH):1680-rotH}:format=rgb[banner]`);
  const body=inhalt.beschreibung||unterzeile;
  if(body) {
    const size=quer?38:36,zeilen=ausgewogeneZeilen(body,quer?42:44);
    if(zeilen.length>2||zeilen.some(z=>breiteMit(z,size,bodyFont)>w-100))throw Error("Bitte die Unterzeile kürzen.");
    const draw=[];
    for(const [i,z] of zeilen.entries()) {
      const name=`portraet-unten-${i}.txt`;await fs.writeFile(path.join(dir,name),z);
      draw.push(`drawtext=fontfile=portraet-body.ttf:textfile=${name}:expansion=none:fontsize=${size}:fontcolor=white:borderw=1:bordercolor=black@0.7:x=${quer?60:"(w-text_w)/2"}:y=${(quer?930:1800)+i*46}`);
    }
    filter.push(`[banner]${draw.join(",")}[fertig]`);
  } else filter.push("[banner]null[fertig]");
  args.push("-filter_complex",filter.join(";"),"-map","[fertig]","-frames:v","1","-q:v","3",ausgabe);
  await ausfuehren("ffmpeg",args,{cwd:dir});return ausgabe;
}

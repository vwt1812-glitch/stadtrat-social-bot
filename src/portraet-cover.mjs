import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ausfuehren, untersuche } from "./video.mjs";
import { ausgewogeneZeilen, logoFuerGrafik } from "./grafik-text.mjs";
import { untertitelTextBreite } from "./untertitel.mjs";

export const PORTRAET_HINTERGRUENDE = Object.freeze({
  original: "Originalfoto", orange: "Orange", dunkel: "Dunkel", video: "Stadtrat / Videobild", eigen: "Eigenes Foto",
});

export async function portraetFreistellen(eingabe, ordner, python) {
  const daten=await fs.readFile(eingabe),hash=createHash("sha256").update(daten).digest("hex").slice(0,16);
  const ziel=path.join(ordner,`portraet-v1-${hash}.png`);
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

export function portraetTitel(text, quer=false) {
  const breite=quer?850:940;
  for(const maxZeilen of [2,3])for(let size=maxZeilen===3?86:quer?102:106;size>=58;size-=4) {
    const zeilen=ausgewogeneZeilen(text,breite/(size*.56));
    if(zeilen.length&&zeilen.length<=maxZeilen&&zeilen.every(z=>untertitelTextBreite(z,size)<=breite))return {size,zeilen};
  }
  throw Error("Bitte den Porträt-Titel kürzen, damit er groß und vollständig lesbar bleibt.");
}

export async function portraetCover({ausgabe,inhalt,layout,portraet,freigestellt,hintergrund="orange",hintergrundBild,quer=false,unterzeile=""}) {
  if(!Object.hasOwn(PORTRAET_HINTERGRUENDE,hintergrund))throw Error("Unbekannter Porträt-Hintergrund.");
  const dir=path.dirname(ausgabe),w=quer?1920:1080,h=quer?1080:1920;
  const titel=portraetTitel(inhalt.titel,quer),line=Math.round(titel.size*1.16),panelH=titel.zeilen.length*line+64;
  await fs.copyFile(path.join(layout.schriftOrdner,"Inter-Bold.otf"),path.join(dir,"portraet-font.otf"));
  const foto=await untersuche(hintergrund==="original"?portraet:freigestellt);
  const ph=quer?1050:1590,pw=Math.round(ph*foto.breite/foto.hoehe/2)*2;
  const px=quer?w-pw+60:Math.round((w-pw)/2)+45,py=quer?70:530;
  const args=["-y","-v","error"];
  const filter=[];
  let index=0;
  if(["video","eigen"].includes(hintergrund)) {
    if(!hintergrundBild)throw Error("Bitte zuerst ein Hintergrundfoto auswählen.");
    args.push("-i",hintergrundBild);index++;
    filter.push(`[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=10:1,eq=brightness=-0.12:saturation=0.7,setsar=1[grund]`);
  } else {
    const farbe=hintergrund==="orange"?"0xF18616":hintergrund==="dunkel"?"0x263D45":"0xE5E6E7";
    const verlauf=hintergrund==="orange"?",geq=r='r(X,Y)*(0.25+0.75*Y/H)':g='g(X,Y)*(0.25+0.75*Y/H)':b='b(X,Y)*(0.25+0.75*Y/H)'":"";
    filter.push(`color=c=${farbe}:s=${w}x${h}:d=1${verlauf},drawbox=x=0:y=0:w=${Math.round(w*.6)}:h=ih:color=white@0.08:t=fill[grund]`);
  }
  args.push("-i",hintergrund==="original"?portraet:freigestellt);
  filter.push(`[${index}:v]scale=${pw}:${ph},format=rgba[person];[grund][person]overlay=${px}:${py}:format=auto[basis]`);
  index++;
  let label="basis";
  if(layout.logo) {
    const logoDatei=logoFuerGrafik(layout.logo,hintergrund==="original"?"hell":"dunkel"),logoInfo=await untersuche(logoDatei);
    args.push("-i",logoDatei);
    const lw=Math.round(Math.min(quer?850:930,(quer?190:210)*logoInfo.breite/logoInfo.hoehe));
    const lx=quer?60:Math.round((w-lw)/2),ly=quer?60:305;
    filter.push(`[${index}:v]scale=${lw}:-1,format=rgba[logo];[${label}][logo]overlay=${lx}:${ly}:format=auto[marke]`);
    label="marke";index++;
  }
  const panelW=quer?960:1060;
  const zeichnen=[`drawbox=x=12:y=0:w=iw-12:h=ih-14:color=black:t=fill`];
  for(const [i,z] of titel.zeilen.entries()) {
    const name=`portraet-titel-${i}.txt`;await fs.writeFile(path.join(dir,name),z);
    zeichnen.push(`drawtext=fontfile=portraet-font.otf:textfile=${name}:expansion=none:fontsize=${titel.size}:fontcolor=white:x=(w-text_w)/2:y=${24+i*line}`);
  }
  filter.push(`color=c=0xF18616:s=${panelW}x${panelH}:d=1,${zeichnen.join(",")},format=rgba,rotate=-0.09:ow=rotw(-0.09):oh=roth(-0.09):c=none[panel]`);
  filter.push(`[${label}][panel]overlay=${quer?30:"(W-w)/2"}:${quer?470:Math.min(1320,1630-panelH-96)}:format=auto[banner]`);
  const body=inhalt.beschreibung||unterzeile;
  if(body) {
    const size=quer?38:36,zeilen=ausgewogeneZeilen(body,quer?42:44);
    if(zeilen.length>2||zeilen.some(z=>untertitelTextBreite(z,size)>w-100))throw Error("Bitte die Unterzeile kürzen.");
    const draw=[];
    for(const [i,z] of zeilen.entries()) {
      const name=`portraet-unten-${i}.txt`;await fs.writeFile(path.join(dir,name),z);
      draw.push(`drawtext=fontfile=portraet-font.otf:textfile=${name}:expansion=none:fontsize=${size}:fontcolor=white:borderw=2:bordercolor=black@0.7:x=${quer?60:"(w-text_w)/2"}:y=${(quer?930:1800)+i*46}`);
    }
    filter.push(`[banner]${draw.join(",")}[fertig]`);
  } else filter.push("[banner]null[fertig]");
  args.push("-filter_complex",filter.join(";"),"-map","[fertig]","-frames:v","1","-q:v","3",ausgabe);
  await ausfuehren("ffmpeg",args,{cwd:dir});return ausgabe;
}

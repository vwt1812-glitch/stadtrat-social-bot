import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {portraetTitel,portraetCover,portraetFreistellen,PORTRAET_HINTERGRUENDE} from "../src/portraet-cover.mjs";
import {untertitelTextBreite} from "../src/untertitel.mjs";
import {thumbnailsErstellen,THUMBNAIL_PROFILE,originalProfil} from "../src/thumbnail.mjs";
import {ausfuehren,untersuche} from "../src/video.mjs";

test("Porträt-Titel bleibt vollständig und groß, auch mit Umlauten und Satzzeichen",()=>{
  for(const quer of [false,true]) {
    const text="Nürnberger Haushalt: Demokratie-Sparkurs?",fit=portraetTitel(text,quer);
    assert.equal(fit.zeilen.join(" "),text);
    assert.ok(fit.size>=58);
    assert.ok(fit.zeilen.every(z=>untertitelTextBreite(z,fit.size)<=(quer?850:940)));
  }
  assert.throws(()=>portraetTitel("W".repeat(80)),/kürzen/);
});

test("Hintergründe unterscheiden vorhandenes Video und eigenes Foto",()=>{
  assert.deepEqual(Object.keys(PORTRAET_HINTERGRUENDE),["original","orange","dunkel","video","eigen"]);
});

const ffmpeg=(()=>{try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});return true;}catch{return false;}})();
test("Transparente PNGs werden ohne Python und ohne veränderte Bildpixel wiederverwendet",{skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"portraet-alpha-"));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const bild=path.join(dir,"transparent.png");
  await ausfuehren("ffmpeg",["-y","-v","error","-f","lavfi","-i","color=c=red@0.5:s=160x240,format=rgba","-frames:v","1",bild]);
  const ziel=await portraetFreistellen(bild,dir,null);
  assert.deepEqual(await fs.readFile(ziel),await fs.readFile(bild));
  assert.equal(await portraetFreistellen(bild,dir,null),ziel);
});
test("Porträt-Thumbnail rendert Hoch-/Querprofile und Raster, ohne Video oder Porträt zu verändern",{skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"portraet-cover-"));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const video=path.join(dir,"video.mp4"),portraet=path.join(dir,"person.png"),bg=path.join(dir,"hintergrund.png");
  await ausfuehren("ffmpeg",["-y","-v","error","-f","lavfi","-i","color=blue:s=320x180:d=1","-c:v","libx264",video]);
  await ausfuehren("ffmpeg",["-y","-v","error","-f","lavfi","-i","color=green:s=240x400,drawbox=x=60:y=20:w=120:h=120:color=yellow:t=fill","-frames:v","1",portraet]);
  await fs.copyFile(portraet,bg);
  const vorher=await fs.readFile(video),fotoVorher=await fs.readFile(portraet);
  const layout={schriftOrdner:path.resolve("assets/fonts"),logo:path.resolve("assets/logos/quer-hell.png")};
  const optionen={modus:"portraet",text:"Mehr Transparenz\nÖffentliche Sitzungen",hintergrund:"video",frameMs:0};
  const c=await thumbnailsErstellen({ordner:dir,video,layout,optionen,kanaele:[{identifier:"instagram"},{identifier:"youtube"}],vorlagen:{portraet,freigestellt:portraet}});
  assert.equal(c.modus,"portraet");assert.equal(c.text,optionen.text);assert.deepEqual(c.hochgeladen,{});
  for(const [key,datei] of Object.entries(c.dateien)) {
    const p=key==="original"?originalProfil({breite:320,hoehe:180}):THUMBNAIL_PROFILE[key],m=await untersuche(datei);
    assert.deepEqual([m.breite,m.hoehe],[p.breite,p.hoehe]);
    assert.ok((await fs.stat(datei)).size<=p.maxBytes);
  }
  for(const hintergrund of ["orange","dunkel","original","eigen"]) {
    await portraetCover({ausgabe:path.join(dir,`${hintergrund}.jpg`),inhalt:{titel:"Stadtrat erklärt"},layout,portraet,freigestellt:portraet,hintergrund,hintergrundBild:bg});
  }
  // Am Rand neben dem transparenten Logo bleibt der warme Hintergrund sichtbar.
  const pixel=await ausfuehren("ffmpeg",["-v","error","-i",path.join(dir,"orange.jpg"),"-vf","crop=2:2:70:294,scale=1:1","-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{binaer:true});
  assert.ok(pixel[0]>pixel[1]+20&&pixel[1]>pixel[2]+20,`Keine weiße Logokarte: ${[...pixel]}`);
  await assert.rejects(portraetCover({ausgabe:path.join(dir,"falsch.jpg"),hintergrund:"../fremd"}),/Unbekannter/);
  await assert.rejects(thumbnailsErstellen({ordner:dir,video,layout,optionen:{...optionen,portraet:path.join(dir,"fehlt.png")},kanaele:[]}),/Porträt hochladen/);
  assert.deepEqual(await fs.readFile(video),vorher);assert.deepEqual(await fs.readFile(portraet),fotoVorher);
});

test("Telegram: Porträt erstellen, Hintergrund wechseln, eigene Bilder und Fehler lassen Entwurf intakt",async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"portraet-flow-"));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  execFileSync(process.execPath,["--experimental-test-module-mocks",fileURLToPath(new URL("./fixtures/portraet-flow.mjs",import.meta.url)),dir],{timeout:22000,stdio:"pipe"});
});

import {createHash} from 'node:crypto';
import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {portraetTitel,portraetTextBreite,portraetCover,portraetFreistellen,PORTRAET_HINTERGRUENDE} from "../src/portraet-cover.mjs";
import {untertitelTextBreite} from "../src/untertitel.mjs";
import {thumbnailsErstellen,THUMBNAIL_PROFILE,originalProfil} from "../src/thumbnail.mjs";
import {ausfuehren,untersuche} from "../src/video.mjs";

test("Porträt-Titel bleibt vollständig und groß, auch mit Umlauten und Satzzeichen",()=>{
  for(const schrift of ["politics","klassisch","inter"])for(const quer of [false,true]) {
    const text="Nürnberger Haushalt: Demokratie-Sparkurs?",fit=portraetTitel(text,quer,schrift);
    assert.equal(fit.zeilen.join(" "),schrift==="politics"?text.toLocaleUpperCase("de-DE"):text);
    assert.ok(fit.size>=58);
    assert.ok(fit.zeilen.every(z=>portraetTextBreite(z,fit.size,schrift)<=(quer?800:840)));
  }
  assert.equal(portraetTitel("Größere Straße!",false,"politics").zeilen.join(" "),"GRÖSSERE STRASSE!");
  assert.throws(()=>portraetTitel("W".repeat(80)),/kürzen/);
});

test("Mitgelieferte Schriftmetriken und Freistellungsmodell haben die erwarteten Prüfsummen",async()=>{
  for(const [font,metrics] of [["PoliticsHead-Bold.ttf","politicshead-metriken.json"],["DejaVuSansCondensed.ttf","dejavu-condensed-metriken.json"]]) {
    const m=JSON.parse(await fs.readFile(new URL(`../assets/fonts/${metrics}`,import.meta.url)));
    assert.equal(createHash("sha256").update(await fs.readFile(new URL(`../assets/fonts/${font}`,import.meta.url))).digest("hex"),m.sha256);
    for(const c of "ÄÖÜẞ!? ".replace("ẞ","SS"))assert.ok(m.advances[c]>0);
  }
  const m=JSON.parse(await fs.readFile(new URL('../assets/fonts/liberation-bold-metriken.json',import.meta.url)));
  assert.equal(createHash('sha256').update(await fs.readFile(new URL('../assets/fonts/LiberationSans-Bold.ttf',import.meta.url))).digest('hex'),m.sha256);
  assert.equal(createHash('md5').update(await fs.readFile(new URL('../assets/models/u2netp.onnx',import.meta.url))).digest('hex'),'8e83ca70e441ab06c318d82300c84806');
});

test("Hintergründe unterscheiden vorhandenes Video und eigenes Foto",()=>{
  assert.deepEqual(Object.keys(PORTRAET_HINTERGRUENDE),["original","orange","dunkel","ratssaal","video","eigen"]);
});

const ffmpeg=(()=>{try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});return true;}catch{return false;}})();
test("Transparente PNGs werden ohne Python und ohne veränderte Bildpixel wiederverwendet",{skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"portraet-alpha-"));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const bild=path.join(dir,"transparent.png");
  await ausfuehren("ffmpeg",["-y","-v","error","-f","lavfi","-i","color=c=red@0.5:s=160x240,format=rgba","-frames:v","1",bild]);
  const hash=createHash('sha256').update(await fs.readFile(bild)).digest('hex').slice(0,16);
  await fs.writeFile(path.join(dir,`portraet-v2-${hash}.png`),'alte harte Maske');
  const ziel=await portraetFreistellen(bild,dir,null);
  assert.equal(path.basename(ziel),`portraet-v3-${hash}.png`);
  assert.deepEqual(await fs.readFile(ziel),await fs.readFile(bild));
  assert.equal(await portraetFreistellen(bild,dir,null),ziel);
});
test("Weiche Porträttransparenz bleibt im fertigen Thumbnail erhalten",{skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'portraet-weich-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const bild=path.join(dir,'weich.png'),ziel=path.join(dir,'cover.jpg');
  await ausfuehren('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=red@0.5:s=240x400,format=rgba','-frames:v','1',bild]);
  await portraetCover({ausgabe:ziel,inhalt:{titel:'Test'},layout:{schriftOrdner:path.resolve('assets/fonts')},portraet:bild,freigestellt:bild,hintergrund:'dunkel',akzentFarbe:'#F18616'});
  const pixel=await ausfuehren('ffmpeg',['-v','error','-i',ziel,'-vf','crop=2:2:600:800,scale=1:1','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{binaer:true});
  for(const [i,expected] of [142,15,14].entries())assert.ok(Math.abs(pixel[i]-expected)<5,`50% Alpha muss mit Anthrazit gemischt werden: ${[...pixel]}`);
  const banner=await ausfuehren('ffmpeg',['-v','error','-i',ziel,'-vf','crop=980:400:50:1280','-frames:v','1','-f','rawvideo','-pix_fmt','gray','pipe:1'],{binaer:true});
  assert.ok(banner.filter(p=>p>235).length>1000,'Die weiße Überschrift muss im schwarzen Banner sichtbar bleiben');
  const rand=await ausfuehren('ffmpeg',['-v','error','-i',ziel,'-vf','crop=8:480:1072:1250','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{binaer:true});
  let schwarz=0,orange=0;
  for(let i=0;i<rand.length;i+=3) {
    if(Math.max(rand[i],rand[i+1],rand[i+2])<12)schwarz++;
    if(rand[i]>200&&rand[i+1]>95&&rand[i+1]<180&&rand[i+2]<65)orange++;
  }
  assert.ok(schwarz>200,'Auch ein kurzer Titel braucht einen schwarzen Kasten bis zur rechten Bildkante');
  assert.ok(orange>30,'Das versetzte orange Rechteck muss ebenfalls rechts angeschnitten sein');
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
  assert.equal(c.schrift,"inter");assert.equal(c.akzentFarbe,"#2563EB");
  assert.equal(c.modus,"portraet");assert.equal(c.text,optionen.text);assert.deepEqual(c.hochgeladen,{});
  for(const [key,datei] of Object.entries(c.dateien)) {
    const p=key==="original"?originalProfil({breite:320,hoehe:180}):THUMBNAIL_PROFILE[key],m=await untersuche(datei);
    assert.deepEqual([m.breite,m.hoehe],[p.breite,p.hoehe]);
    assert.ok((await fs.stat(datei)).size<=p.maxBytes);
  }
  const saal=await thumbnailsErstellen({ordner:dir,video,layout,optionen:{...optionen,hintergrund:"ratssaal"},kanaele:[],vorlagen:{portraet,freigestellt:portraet,ratssaal:bg}});
  assert.ok(saal.dateien.original);
  await assert.rejects(thumbnailsErstellen({ordner:dir,video,layout,optionen:{...optionen,hintergrund:"ratssaal"},kanaele:[],vorlagen:{portraet,freigestellt:portraet}}),/Sitzungssaal-Foto/);
  for(const hintergrund of ["orange","dunkel","original","eigen"]) {
    await portraetCover({ausgabe:path.join(dir,`${hintergrund}.jpg`),inhalt:{titel:"Stadtrat erklärt"},layout,portraet,freigestellt:portraet,hintergrund,hintergrundBild:bg});
  }
  // Hinter dem orange-weißen Logo bleibt die Fläche neutral dunkel, ohne Logokarte.
  const pixel=await ausfuehren("ffmpeg",["-v","error","-i",path.join(dir,"orange.jpg"),"-vf","crop=2:2:70:294,scale=1:1","-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1"],{binaer:true});
  assert.ok(Math.max(...pixel)<60&&Math.max(...pixel)-Math.min(...pixel)<8,`Neutraler dunkler Logohintergrund: ${[...pixel]}`);
  await assert.rejects(portraetCover({ausgabe:path.join(dir,"falsch.jpg"),hintergrund:"../fremd"}),/Unbekannter/);
  await assert.rejects(thumbnailsErstellen({ordner:dir,video,layout,optionen:{...optionen,portraet:path.join(dir,"fehlt.png")},kanaele:[]}),/Porträt hochladen/);
  assert.deepEqual(await fs.readFile(video),vorher);assert.deepEqual(await fs.readFile(portraet),fotoVorher);
});

test("Telegram: Porträt erstellen, Hintergrund wechseln, eigene Bilder und Fehler lassen Entwurf intakt",async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"portraet-flow-"));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const modus of ["mit-saal","ohne-saal"]) {
    const teil=path.join(dir,modus);await fs.mkdir(teil);
    execFileSync(process.execPath,["--experimental-test-module-mocks",fileURLToPath(new URL("./fixtures/portraet-flow.mjs",import.meta.url)),teil,modus],{timeout:22000,stdio:"pipe"});
  }
});

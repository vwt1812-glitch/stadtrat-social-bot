import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {audioFilter,messungLesen,auftragTonErsetzen,tonProzess,stereoPruefen,stummerKanalQuelle,kanalPegelLesen,videoTonErsetzen} from "../src/audio.mjs";
import {ausfuehren,untersuche} from "../src/video.mjs";

test("Lautstärkemessung behandelt Stille und lehnt ungültige Werte ab",()=>{
  assert.equal(messungLesen('{"input_i":"-inf"}'),null);
  assert.throws(()=>messungLesen('kein JSON'),/gelesen/);
  assert.throws(()=>messungLesen('{"input_i":"nan","input_tp":"0"}'),/Ungültige/);
});
test("Telegram: Ton umschalten, Original wiederherstellen und bei Fehlern bisherige Fassung behalten",async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audio-flow-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  execFileSync(process.execPath,['--experimental-test-module-mocks',fileURLToPath(new URL('./fixtures/audio-flow.mjs',import.meta.url)),dir],{timeout:22000,stdio:'pipe'});
});
const ffmpeg=(()=>{try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});return true;}catch{return false;}})();
const hash=async(f,track)=>(await tonProzess('ffmpeg',['-v','error','-i',f,'-map',`0:${track}:0`,'-c','copy','-f','hash','-hash','sha256','-'])).out.trim();
test('Stumme Stereoseite verlangt sehr kleinen RMS-Pegel, deutlichen Abstand und niedrige Spitzen',()=>{
  const p=(rms,peak)=>({rms:String(rms),peak:String(peak)}),laut=p(-20,-6),still=p('-inf','-inf');
  assert.equal(stummerKanalQuelle([laut,still]),0);
  assert.equal(stummerKanalQuelle([p(-68.54,-40.79),p(-13.29,0)]),1); // measured Rode case
  for(const pair of [[still,still],[laut,p(-40,-25)],[laut,p(-68,-25)],[p(-50,-35),still]])assert.equal(stummerKanalQuelle(pair),null);
  assert.throws(()=>kanalPegelLesen('Channel: 2\nPeak level dB: -10\nRMS level dB: -20'),/vollständig/);
  assert.throws(()=>stummerKanalQuelle([{rms:'nan',peak:'-inf'},still]),/Ungültige/);
});
test('Echte Stereodateien: links/rechts und Rauschboden reparieren, Stereo und späten zweiten Sprecher erhalten',{skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audio-stereo-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const tone='0.2*sin(2*PI*350*t)';
  const faelle=[['links',`${tone}|0`,0],['rechts',`0|${tone}`,1],['rauschen',`0.00005*sin(2*PI*800*t)|${tone}`,1],['stereo',`${tone}|0.1*sin(2*PI*600*t)`,null],['spaet',`${tone}|if(lt(t\\,3)\\,0\\,0.1*sin(2*PI*600*t))`,null],['still','0|0',null]];
  for(const [name,signal,quelle] of faelle) {
    const f=path.join(dir,name+'.mkv');
    await ausfuehren('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=blue:s=128x72:r=5:d=4','-f','lavfi','-i',`aevalsrc=${signal}:s=48000:d=4`,'-c:v','libx264','-c:a','pcm_s16le',f]);
    const pruefung=await stereoPruefen(f,dir);assert.equal(pruefung.quelle,quelle,name);
    assert.deepEqual(await stereoPruefen(f,dir),pruefung,'Cache enthält auch -inf korrekt');
    assert.equal(await audioFilter(f,'original',dir),null);
    if(quelle===null) {assert.equal(await audioFilter(f,'kanaele',dir),null);continue;}
    const out=path.join(dir,name+'.mp4');
    await videoTonErsetzen({eingabe:f,original:f,ausgabe:out,modus:'kanaele'});
    assert.equal(await hash(out,'v'),await hash(f,'v'));
    const gemessen=await stereoPruefen(out,dir);
    assert.ok(gemessen.pegel.every(p=>Number(p.rms)>-35),'Beide Seiten müssen hörbar sein');
    assert.ok(Math.abs(Number(gemessen.pegel[0].rms)-Number(gemessen.pegel[1].rms))<.2,'Beide Seiten müssen gleich laut sein');
    const diff=(await tonProzess('ffmpeg',['-hide_banner','-nostats','-i',out,'-vn','-af','pan=mono|c0=c0-c1,astats=metadata=0:reset=0','-f','null','-'])).err.match(/RMS level dB:\s*(\S+)/);
    assert.ok(diff&&(diff[1]==='-inf'||Number(diff[1])<-55),'Bis auf AAC-Rundung muss auf beiden Seiten dasselbe Signal liegen');
    assert.ok((await audioFilter(f,'sprache',dir)).startsWith(`pan=stereo|c0=c${quelle}|c1=c${quelle},`),'Kanalreparatur muss vor Sprachbearbeitung und Messung stattfinden');
  }
});
test("Tonkorrektur normalisiert behutsam, kopiert Video und rechnet erneute Korrekturen vom Original",{skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audio-bot-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const original=path.join(dir,'original.mp4');
  await ausfuehren('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=blue:s=128x72:r=5:d=12','-f','lavfi','-i',"aevalsrc=sin(2*PI*350*t)*if(lt(t\\,4)\\,0.03\\,if(lt(t\\,8)\\,0.2\\,0.08)):s=48000:d=12",'-c:v','libx264','-c:a','aac',original]);
  const a={ordner:dir,original,medien:[original],storyDatei:original,thumbnail:{dateien:{hochkant:'cover.jpg'},videoStand:{}}};
  const snapshot=JSON.stringify(a),before=await fs.readFile(original),result=await auftragTonErsetzen(a,'sprache');
  assert.equal(JSON.stringify(a),snapshot);assert.equal(result.storyDatei,result.medien[0]);
  assert.equal(await hash(result.medien[0],'v'),await hash(original,'v'));
  const info=await untersuche(result.medien[0]);assert.ok(info.hatTon&&Math.abs(info.dauer-12)<.15);
  const measurement=messungLesen((await tonProzess('ffmpeg',['-hide_banner','-nostats','-i',result.medien[0],'-vn','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'])).err);
  assert.ok(Math.abs(Number(measurement.input_i)+16)<1.1,JSON.stringify(measurement));
  assert.ok(Number(measurement.input_tp)<=-1);
  assert.equal(result.thumbnail.videoStand.datei,result.medien[0]);assert.equal(result.thumbnail.dateien.hochkant,'cover.jpg');
  const second=await auftragTonErsetzen({...a,...result},'sprache');
  assert.equal(await hash(result.medien[0],'a'),await hash(second.medien[0],'a'));
  await assert.rejects(auftragTonErsetzen(a,'kaputt'),/Unbekannte/);
  assert.deepEqual(await fs.readFile(original),before);
});
test("Stumme Videos und digitale Stille erhalten keine künstliche Verstärkung",{skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'audio-stille-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const f=path.join(dir,'stumm.mp4'),silent=path.join(dir,'still.mp4');
  await ausfuehren('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=black:s=128x72:d=4','-c:v','libx264',f]);
  assert.equal(await audioFilter(f,'sprache',dir),null);
  await ausfuehren('ffmpeg',['-y','-v','error','-i',f,'-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','4','-c:v','copy','-c:a','aac',silent]);
  assert.equal(await audioFilter(silent,'sprache',dir),null);
  assert.equal(await audioFilter(silent,'original',dir),null);
});

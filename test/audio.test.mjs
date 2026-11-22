import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {audioFilter,messungLesen,auftragTonErsetzen,tonProzess} from "../src/audio.mjs";
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

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {mock} from "node:test";
import {setTimeout as pause} from "node:timers/promises";
import {Auftraege} from "../../src/auftraege.mjs";
import {Telegram} from "../../src/telegram.mjs";
import {Postiz} from "../../src/postiz.mjs";
import * as audio from "../../src/audio.mjs";
const [dir]=process.argv.slice(2);
Object.assign(process.env,{DATEN_DIR:dir,TELEGRAM_BOT_TOKEN:"test",ERLAUBTE_NUTZER:"123",POSTIZ_URL:"https://postiz.invalid",POSTIZ_API_KEY:"test",WHISPER_MODELL:"test",CAPTION_ANBIETER:"",ANTHROPIC_API_KEY:"",OPENAI_API_KEY:"",MASTODON_TOKEN:""});
const s=new Auftraege(dir),a=s.neu(123),original=path.join(a.ordner,"original.mp4");fs.writeFileSync(original,"Unverändertes Original");
s.aendern(a.id,{art:"video",status:"vorschau",caption:"Beitrag bleibt",original,medien:[original],storyDatei:original,masse:{breite:1920,hoehe:1080,dauer:5,hatTon:true},kanaele:["ig"],menueNachricht:1});
const stand=()=>JSON.parse(fs.readFileSync(path.join(dir,"auftraege.json")))[a.id];let calls=0,step=0;
mock.module("../../src/audio.mjs",{namedExports:{...audio,auftragTonErsetzen:async(b,modus)=>{
  calls++;assert.equal(b.original,original);
  if(modus==="lautstaerke")throw Error("Absichtlicher Audiofehler");
  return {medien:[path.join(dir,modus+'.mp4')],storyDatei:path.join(dir,modus+'.mp4'),audioTuning:modus};
}}});
mock.method(Postiz.prototype,"kanaele",async()=>[{id:"ig",identifier:"instagram",name:"Instagram"}]);
mock.method(globalThis,"fetch",async()=>{throw Error("Kein Netzwerk im Test");});
const callback=modus=>[{update_id:step,callback_query:{id:String(step),from:{id:123},message:{chat:{id:123},message_id:1},data:`a:${a.id}:audio:${modus}`}}];
mock.method(Telegram.prototype,"aufruf",async method=>{
  if(method==='getMe')return {username:'test'};
  if(method!=='getUpdates')return {message_id:1};
  for(;;){await pause(10);const b=stand();
    if(step===0){step++;return callback('sprache');}
    if(step===1&&calls===1&&b.status==='vorschau'){assert.equal(b.audioTuning,'sprache');step++;return callback('lautstaerke');}
    if(step===2&&calls===2&&b.status==='vorschau'){assert.equal(b.audioTuning,'sprache');assert.equal(b.medien[0],path.join(dir,'sprache.mp4'));step++;return callback('original');}
    if(step===3&&calls===3&&b.status==='vorschau'){assert.equal(b.audioTuning,'original');assert.equal(b.caption,'Beitrag bleibt');assert.equal(fs.readFileSync(original,'utf8'),'Unverändertes Original');process.exit(0);}
  }
});
setTimeout(()=>process.exit(1),18000).unref();await import('../../src/bot.mjs');

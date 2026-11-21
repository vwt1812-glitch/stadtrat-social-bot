import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {mock} from "node:test";
import {setTimeout as pause} from "node:timers/promises";
import {Auftraege} from "../../src/auftraege.mjs";
import {Telegram} from "../../src/telegram.mjs";
import {Postiz} from "../../src/postiz.mjs";
import * as video from "../../src/video.mjs";
import * as thumbnail from "../../src/thumbnail.mjs";
const [dir]=process.argv.slice(2),portrait=path.join(dir,"vorlage.png");fs.writeFileSync(portrait,"Privates Porträt");
Object.assign(process.env,{DATEN_DIR:dir,TELEGRAM_BOT_TOKEN:"test",ERLAUBTE_NUTZER:"123",POSTIZ_URL:"https://postiz.invalid",POSTIZ_API_KEY:"test",WHISPER_MODELL:"test",CAPTION_ANBIETER:"",ANTHROPIC_API_KEY:"",OPENAI_API_KEY:"",MASTODON_TOKEN:"",THUMBNAIL_PORTRAET:portrait});
const s=new Auftraege(dir),a=s.neu(123),original=path.join(a.ordner,"original.mp4");fs.writeFileSync(original,"Originalvideo");
s.aendern(a.id,{art:"video",status:"vorschau",caption:"Beitrag bleibt",original,medien:[original],masse:{breite:1920,hoehe:1080,dauer:5},kanaele:["ig"],menueNachricht:1});
const stand=()=>JSON.parse(fs.readFileSync(path.join(dir,"auftraege.json")))[a.id];
const renders=[],menus=[];
mock.module("../../src/video.mjs",{namedExports:{...video,untersuche:async()=>({breite:1920,hoehe:1080,dauer:5})}});
mock.module("../../src/thumbnail.mjs",{namedExports:{...thumbnail,thumbnailsErstellen:async o=>{
  renders.push(o);assert.equal(o.vorlagen.portraet,portrait);
  if(o.optionen.hintergrund==="dunkel")throw Error("Absichtlicher Renderfehler");
  return {...o.optionen,dateien:{hochkant:path.join(dir,"cover.jpg")},hochgeladen:{},videoStand:{}};
}}});
mock.method(Postiz.prototype,"kanaele",async()=>[{id:"ig",identifier:"instagram",name:"Instagram"}]);
mock.method(Telegram.prototype,"fotos",async()=>({}));
mock.method(Telegram.prototype,"herunterladen",async(id,ziel)=>{fs.writeFileSync(ziel,id);});
mock.method(globalThis,"fetch",async()=>{throw Error("Kein Netzwerk im Test");});
let step=0;
const callback=aktion=>[{update_id:step,callback_query:{id:String(step),from:{id:123},message:{chat:{id:123},message_id:1},data:`a:${a.id}:${aktion}`}}];
const message=fields=>[{update_id:step,message:{chat:{id:123,type:"private"},from:{id:123},...fields}}];
mock.method(Telegram.prototype,"aufruf",async(method,payload)=>{
  if(method==="getMe")return {username:"test"};
  if(method!=="getUpdates") {if(payload?.text)menus.push(payload.text);return {message_id:1};}
  for(;;) {
    await pause(10);const b=stand();
    if(step===0){step++;return callback("thumbportraet");}
    if(step===1&&b.wartetAuf==="thumbnailText"){step++;return message({text:"Mehr Transparenz\nÖffentlich erklären"});}
    if(step===2&&b.status==="vorschau"&&renders.length===1){assert.equal(b.thumbnail.modus,"portraet");assert.equal(b.thumbnail.text,"Mehr Transparenz\nÖffentlich erklären");step++;return callback("thumbhintergrund");}
    if(step===3&&menus.some(x=>x.includes("Hintergrund wählen"))){step++;return callback("thumbhintergrund:video");}
    if(step===4&&b.status==="vorschau"&&renders.length===2){assert.equal(b.thumbnail.hintergrund,"video");step++;return callback("thumbhintergrund:eigen");}
    if(step===5&&b.wartetAuf==="thumbnailHintergrund"){step++;return message({photo:[{file_id:"Hintergrund",file_size:20}]});}
    if(step===6&&b.status==="vorschau"&&renders.length===3){assert.equal(fs.readFileSync(b.thumbnail.hintergrundBild,"utf8"),"Hintergrund");step++;return callback("thumbportraetbild");}
    if(step===7&&b.wartetAuf==="thumbnailPortraet"){step++;return message({document:{file_id:"Neues Porträt",mime_type:"image/png",file_size:20}});}
    if(step===8&&b.status==="vorschau"&&renders.length===4){assert.equal(fs.readFileSync(b.thumbnail.portraet,"utf8"),"Neues Porträt");step++;return callback("thumbhintergrund:dunkel");}
    if(step===9&&b.status==="vorschau"&&renders.length===5){
      assert.equal(b.thumbnail.hintergrund,"eigen");assert.equal(b.caption,"Beitrag bleibt");assert.equal(fs.readFileSync(original,"utf8"),"Originalvideo");
      assert.equal(b.thumbnail.text,"Mehr Transparenz\nÖffentlich erklären");process.exit(0);
    }
  }
});
setTimeout(()=>{console.error("Porträtworkflow hängt",step,stand());process.exit(1);},18000).unref();
await import("../../src/bot.mjs");

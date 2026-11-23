import {hintergrundSammlung} from "../../src/hintergrund-sammlung.mjs";
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
const [dir,modus]=process.argv.slice(2),portrait=path.join(dir,"vorlage.png");fs.writeFileSync(portrait,"Privates Porträt");
const sammlung=path.join(dir,"hintergruende");
if(modus==="mit-sammlung"){fs.mkdirSync(sammlung);for(let i=1;i<=10;i++)fs.writeFileSync(path.join(sammlung,`${String(i).padStart(2,"0")}_Hintergrund_${i}.jpg`),"Privates Motiv");}
Object.assign(process.env,{THUMBNAIL_HINTERGRUENDE:sammlung,DATEN_DIR:dir,TELEGRAM_BOT_TOKEN:"test",ERLAUBTE_NUTZER:"123",POSTIZ_URL:"https://postiz.invalid",POSTIZ_API_KEY:"test",WHISPER_MODELL:"test",CAPTION_ANBIETER:"",ANTHROPIC_API_KEY:"",OPENAI_API_KEY:"",MASTODON_TOKEN:"",THUMBNAIL_RATSSAAL:modus==="ohne-saal"?path.join(dir,"fehlt.jpg"):portrait,THUMBNAIL_PORTRAET:portrait});
const s=new Auftraege(dir),a=s.neu(123),original=path.join(a.ordner,"original.mp4");fs.writeFileSync(original,"Originalvideo");
s.aendern(a.id,{art:"video",status:"vorschau",caption:"Beitrag bleibt",original,medien:[original],masse:{breite:1920,hoehe:1080,dauer:5},kanaele:["ig"],menueNachricht:1});
const stand=()=>JSON.parse(fs.readFileSync(path.join(dir,"auftraege.json")))[a.id];
const renders=[],menus=[],buttons=[];
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
  if(method!=="getUpdates") {if(payload?.text)menus.push(payload.text);if(payload?.reply_markup?.inline_keyboard)buttons.push(...payload.reply_markup.inline_keyboard.flat().map(b=>b.text));return {message_id:1};}
  for(;;) {
    await pause(10);const b=stand();
    if(step===0){step++;return callback("thumbportraet");}
    if(step===1&&b.wartetAuf==="thumbnailText"){step++;return message({text:"Mehr Transparenz\nÖffentlich erklären"});}
    if(step===2&&b.status==="vorschau"&&renders.length===1){assert.equal(b.thumbnail.modus,"portraet");assert.equal(b.thumbnail.text,"Mehr Transparenz\nÖffentlich erklären");step++;return callback("thumbhintergrund");}
    if(step===3&&menus.some(x=>x.includes("Hintergrund wählen"))){assert.equal(buttons.some(x=>x.includes("Sitzungssaal")),modus!=="ohne-saal");step++;return callback("thumbhintergrund:video");}
    if(step===4&&b.status==="vorschau"&&renders.length===2){assert.equal(b.thumbnail.hintergrund,"video");step++;return callback("thumbhintergrund:eigen");}
    if(step===5&&b.wartetAuf==="thumbnailHintergrund"){step++;return message({photo:[{file_id:"Hintergrund",file_size:20}]});}
    if(step===6&&b.status==="vorschau"&&renders.length===3){assert.equal(fs.readFileSync(b.thumbnail.hintergrundBild,"utf8"),"Hintergrund");step++;return callback("thumbportraetbild");}
    if(step===7&&b.wartetAuf==="thumbnailPortraet"){step++;return message({document:{file_id:"Neues Porträt",mime_type:"image/png",file_size:20}});}
    if(step===8&&b.status==="vorschau"&&renders.length===4){assert.equal(fs.readFileSync(b.thumbnail.portraet,"utf8"),"Neues Porträt");step++;return callback("thumbhintergrund:dunkel");}
    if(step===9&&b.status==="vorschau"&&renders.length===5){
      assert.equal(b.thumbnail.hintergrund,"eigen");assert.equal(b.caption,"Beitrag bleibt");assert.equal(fs.readFileSync(original,"utf8"),"Originalvideo");
      assert.equal(b.thumbnail.text,"Mehr Transparenz\nÖffentlich erklären");
      if(modus!=="mit-sammlung")process.exit(0);
      step++;return callback("thumbhintergrund");
    }
    if(step===10&&buttons.some(x=>x.includes("Gespeicherte Hintergründe"))){step++;return callback("thumbhintergrund:sammlung");}
    if(step===11&&menus.some(x=>x.includes("Seite 1/2"))){step++;return callback("thumbsammlung:1");}
    if(step===12&&menus.some(x=>x.includes("Seite 2/2"))){step++;return callback("thumbmotiv:"+(await hintergrundSammlung(sammlung))[9].id);}
    if(step===13&&b.status==="vorschau"&&renders.length===6){assert.equal(b.thumbnail.hintergrund,"sammlung");assert.equal(b.thumbnail.hintergrundName,"Hintergrund 10");step++;return callback("thumbmotiv:../fremd");}
    if(step===14&&menus.some(x=>x.includes("Motiv nicht mehr verfügbar"))){assert.equal(renders.length,6);assert.equal(b.thumbnail.hintergrundName,"Hintergrund 10");assert.equal(b.caption,"Beitrag bleibt");process.exit(0);}
  }
});
setTimeout(()=>{console.error("Porträtworkflow hängt",step,stand());process.exit(1);},18000).unref();
await import("../../src/bot.mjs");

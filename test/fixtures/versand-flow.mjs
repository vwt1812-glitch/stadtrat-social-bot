import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {mock} from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {Auftraege} from '../../src/auftraege.mjs';
import {Telegram} from '../../src/telegram.mjs';
import {Postiz} from '../../src/postiz.mjs';
import * as versand from '../../src/versand-video.mjs';
import * as diagnose from '../../src/postiz-diagnose.mjs';
const [dir,modus]=process.argv.slice(2);
Object.assign(process.env,{DATEN_DIR:dir,TELEGRAM_BOT_TOKEN:'test',ERLAUBTE_NUTZER:'123',POSTIZ_URL:'https://postiz.invalid',POSTIZ_API_KEY:'test',WHISPER_MODELL:'test',CAPTION_ANBIETER:'',ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',MASTODON_TOKEN:'',POSTIZ_DIAGNOSE_CONTAINER:'postiz'});
const s=new Auftraege(dir),a=s.neu(123),original=path.join(a.ordner,'original.mp4'),klein=path.join(a.ordner,'versand-test.mp4');fs.writeFileSync(original,Buffer.alloc(2500,1));fs.writeFileSync(klein,Buffer.alloc(500,2));
const kanaele=modus==='verbindung'?[{id:'b',identifier:'bluesky',name:'Bluesky'}]:[{id:'m',identifier:'mastodon',name:'Mastodon'},{id:'t',identifier:'telegram',name:'Telegram'},{id:'i',identifier:'instagram',name:'Instagram'}];
s.aendern(a.id,{art:'video',status:'vorschau',caption:'Mein Text',original,medien:[original],masse:{breite:1280,hoehe:720,dauer:5,hatTon:true},kanaele:kanaele.map(k=>k.id),menueNachricht:1});
const stand=()=>JSON.parse(fs.readFileSync(path.join(dir,'auftraege.json')))[a.id],menus=[],uploads=[],calls=[];
let vorbereitet=0,step=0;
mock.module('../../src/versand-video.mjs',{namedExports:{...versand,versandVideo:async(source,maxBytes)=>{assert.equal(source,original);assert.equal(maxBytes,1000);vorbereitet++;return klein;}}});
mock.module('../../src/postiz-diagnose.mjs',{namedExports:{...diagnose,postizDiagnose:async()=>({kanaele:modus==='verbindung'?[{id:'b',refreshNeeded:true}]:[],posts:[]})}});
mock.method(Postiz.prototype,'eigeneEinstellungen',()=>({mastodon:{maxVideoMB:.001},telegram:{maxVideoMB:.002}}));
mock.method(Postiz.prototype,'kanaele',async()=>kanaele);
mock.method(Postiz.prototype,'hochladen',async f=>{uploads.push(f);return {id:path.basename(f),path:'https://postiz.invalid/'+path.basename(f)};});
mock.method(Postiz.prototype,'beitrag',async o=>{calls.push(o);return {post:kanaele.map(k=>({postId:'p-'+k.id,integration:k.id}))};});
mock.method(globalThis,'fetch',async()=>{throw Error('Kein Netzwerk im Test');});
const callback=action=>[{update_id:step,callback_query:{id:String(step),from:{id:123},message:{chat:{id:123},message_id:1},data:`a:${a.id}:${action}`}}];
mock.method(Telegram.prototype,'aufruf',async(method,payload)=>{
  if(method==='getMe')return {username:'test'};
  if(method!=='getUpdates'){if(payload?.text)menus.push(payload.text);return {message_id:1};}
  for(;;){await pause(10);const b=stand();
    if(step===0){step++;return callback('jetzt');}
    if(modus==='verbindung'&&menus.some(t=>t.includes('Kontoverbindung'))){assert.equal(uploads.length,0);assert.equal(calls.length,0);assert.equal(b.status,'vorschau');process.exit(0);}
    if(modus!=='verbindung'&&step===1&&b.plan){assert.ok(menus.some(t=>t.includes('Versandfassungen')));step++;return callback('ja');}
    if(modus!=='verbindung'&&step===2&&b.status==='gepostet'){
      assert.equal(vorbereitet,1);assert.deepEqual(uploads,[original,klein]);assert.equal(calls.length,1);
      assert.deepEqual(calls[0].kanalMedien.m,calls[0].kanalMedien.t);assert.equal(calls[0].kanalMedien.i,undefined);
      assert.equal(calls[0].medien[0].id,'original.mp4');assert.equal(b.plattformUploads['versand-test.mp4'].id,'versand-test.mp4');
      assert.equal(fs.readFileSync(original).length,2500);process.exit(0);
    }
  }
});
setTimeout(()=>{console.error('Versand-Flow Zeitlimit',modus,stand().status,menus);process.exit(1)},15000).unref();
await import('../../src/bot.mjs');

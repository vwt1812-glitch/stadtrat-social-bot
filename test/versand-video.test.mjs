import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {versandGrenze,versandBedarf,versandVideo} from '../src/versand-video.mjs';
import {Postiz,einstellungenFuer} from '../src/postiz.mjs';
import {ausfuehren,untersuche} from '../src/video.mjs';

test('Dateigrenzen sind pro Server/Konto einstellbar und bleiben lokale Einstellungen',()=>{
  assert.equal(versandGrenze({identifier:'mastodon'}),40e6);
  assert.equal(versandGrenze({identifier:'telegram'}),48e6);
  assert.equal(versandGrenze({identifier:'instagram'}),null);
  const k={id:'m',identifier:'mastodon'},eigene={mastodon:{maxVideoMB:30},m:{maxVideoMB:25}};
  assert.equal(versandGrenze(k,eigene),25e6);
  assert.equal(einstellungenFuer(k,{caption:'Text',eigene}).maxVideoMB,undefined);
  assert.throws(()=>versandGrenze(k,{m:{maxVideoMB:-1}}),/positive/);
});

test('Bedarf prüft die tatsächlich gewählte Datei und überspringt bestätigte Posts und Storys',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'versand-bedarf-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const quer=path.join(dir,'quer.mp4'),hoch=path.join(dir,'hoch.mp4');await fs.writeFile(quer,Buffer.alloc(6000));await fs.writeFile(hoch,Buffer.alloc(2000));
  const a={art:'video',medien:[quer],storyDatei:hoch},kanaele=[{id:'t',identifier:'telegram'},{id:'i',identifier:'instagram'}],eigene={telegram:{maxVideoMB:.005},instagram:{maxVideoMB:.005}};
  const b=await versandBedarf(a,kanaele,{eigene,hochkant:true,netze:['instagram']});
  assert.deepEqual(b.map(x=>[x.kanal.id,x.datei]),[['t',quer]]);
  assert.equal((await versandBedarf({...a,postiz:{post:[]}},kanaele,{eigene})).length,0);
  assert.equal((await versandBedarf({...a,nurStory:true},kanaele,{eigene})).length,0);
});

test('Postiz erhält die kleinere Fassung nur auf dem passenden Kanal, Cover und Story bleiben zugeordnet',async t=>{
  const requests=[];t.mock.method(globalThis,'fetch',async(_,o)=>{const b=JSON.parse(o.body);requests.push(b);return new Response(JSON.stringify(b.posts.map(p=>({postId:p.integration.id}))));});
  const p=new Postiz({url:'https://postiz.invalid',apiKey:'test',einstellungen:'fehlt.json'}),quer={id:'q',path:'/quer.mp4'},hoch={id:'h',path:'/hoch.mp4'},klein={id:'k',path:'/klein.mp4'};
  await p.beitrag({typ:'now',zeit:new Date(),caption:'Text',medien:[quer],hochkantMedium:hoch,storyMedium:hoch,story:true,kanaele:[{id:'ig',identifier:'instagram'},{id:'m',identifier:'mastodon'},{id:'t',identifier:'telegram'}],kanalMedien:{m:[klein],t:[klein]},thumbnails:{ig:{id:'c',path:'/cover.jpg'}}});
  const posts=Object.fromEntries(requests[0].posts.map(p=>[p.integration.id,p]));
  assert.deepEqual(posts.ig.value[0].image,[{...hoch,thumbnail:'/cover.jpg'}]);
  for(const id of ['m','t'])assert.deepEqual(posts[id].value[0].image,[klein]);
  assert.deepEqual(requests[1].posts[0].value[0].image,[hoch]);
});

const ffmpeg=(()=>{try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});return true;}catch{return false;}})();
test('Echte Versandfassung hält die Dateigrenze ein, bleibt vollständig mit Ton und verwendet den Cache', {skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'versand-echt-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const input=path.join(dir,'quelle.mp4');
  await ausfuehren('ffmpeg',['-y','-v','error','-f','lavfi','-i','testsrc2=s=640x360:r=30:d=5','-f','lavfi','-i','sine=frequency=440:duration=5','-c:v','libx264','-preset','fast','-crf','10','-c:a','aac','-shortest',input]);
  const hash=async f=>createHash('sha256').update(await fs.readFile(f)).digest('hex'),vorher=await hash(input);
  assert.ok((await fs.stat(input)).size>350000);
  const out=await versandVideo(input,350000,dir),m=await untersuche(out);
  assert.notEqual(out,input);assert.ok((await fs.stat(out)).size<=350000);
  assert.ok(Math.abs(m.dauer-5)<.25);assert.equal(m.hatTon,true);assert.deepEqual([m.breite,m.hoehe],[640,360]);
  await ausfuehren('ffmpeg',['-v','error','-i',out,'-f','null',process.platform==='win32'?'NUL':'/dev/null']);
  const stat=await fs.stat(out);assert.equal(await versandVideo(input,350000,dir),out);assert.equal((await fs.stat(out)).mtimeMs,stat.mtimeMs);
  assert.equal(await hash(input),vorher);assert.equal(await versandVideo(input,100000000,dir),input);
  await assert.rejects(versandVideo(input,5000,dir),/zu lang/);
});

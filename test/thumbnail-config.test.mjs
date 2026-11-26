import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ladeConfig} from '../src/config.mjs';

test('Eine neue Installation verwendet weder Personenbranding noch ein Partei-Logo',t=>{
  const vars={TELEGRAM_BOT_TOKEN:'test',POSTIZ_URL:'https://postiz.invalid',POSTIZ_API_KEY:'test',WHISPER_MODELL:'test',CAPTION_ANBIETER:'',ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',LOGO:'',CAPTION_HASHTAGS:'',POSTIZ_KUNDE:'',THUMBNAIL_SCHRIFT:'',THUMBNAIL_UNTERZEILE:'',THUMBNAIL_HINTERGRUND:'',THUMBNAIL_AKZENT_FARBE:'',THUMBNAIL_GRUND_FARBE:''};
  const before=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));
  t.after(()=>{for(const [k,v] of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  Object.assign(process.env,vars);
  const c=ladeConfig();
  assert.equal(c.layout.logo,null);assert.equal(c.postiz.kunde,'');assert.equal(c.thumbnail.schrift,'inter');
  assert.equal(c.thumbnail.unterzeile,'');assert.equal(c.thumbnail.hintergrund,'dunkel');assert.equal(c.thumbnail.akzentFarbe,'#2563EB');
  assert.equal(c.caption.hashtags,'#Stadtrat');
  Object.assign(process.env,{THUMBNAIL_SCHRIFT:'politics',THUMBNAIL_UNTERZEILE:'Mein eigener Text',THUMBNAIL_AKZENT_FARBE:'#F18616',THUMBNAIL_HINTERGRUND:'orange',LOGO:'daten/vorlagen/mein-logo.png'});
  const privat=ladeConfig();assert.equal(privat.thumbnail.schrift,'politics');assert.equal(privat.thumbnail.unterzeile,'Mein eigener Text');assert.ok(privat.layout.logo.endsWith('mein-logo.png'));
});

test('Private Bilder, Exporte und Konfigurationskopien sind ausgeschlossen; öffentliche Vorlagen bleiben möglich',()=>{
  const privat=['daten/vorlagen/portraet.png','daten/vorlagen/ratssaal.jpg','.env','.env.backup','private/mein-logo.png','output/thumbnail.jpg','testexport.jpg','testvideo.mp4','styleguide.pdf'];
  const oeffentlich=['.env.example','assets/logos/neutrales-beispiel.svg','test/fixtures/beispiel.png'];
  const ignored=execFileSync('git',['check-ignore','--stdin'],{input:[...privat,...oeffentlich].join('\n')+'\n',encoding:'utf8'}).trim().split(/\r?\n/);
  assert.deepEqual(ignored.sort(),privat.sort());
});

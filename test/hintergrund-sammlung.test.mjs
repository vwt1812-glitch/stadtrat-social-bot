import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hintergrundSammlung,hintergrundMotiv,hintergrundSeite} from '../src/hintergrund-sammlung.mjs';

test('Private Sammlung bietet nur direkte Bilddateien, lesbare Namen und stabile kurze IDs',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hintergruende-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'archiv'));for(const name of ['02_Rathaus_Platz.JPG','01_Saal_Fenster.png','notizen.txt','.versteckt.jpg'])await fs.writeFile(path.join(dir,name),'privat');
  await fs.writeFile(path.join(dir,'archiv','alt.jpg'),'privat');
  const bilder=await hintergrundSammlung(dir);
  assert.deepEqual(bilder.map(b=>b.name),['Saal Fenster','Rathaus Platz']);
  for(const b of bilder)assert.match(b.id,/^[a-f0-9]{12}$/);
  assert.deepEqual(await hintergrundSammlung(dir),bilder);
  assert.equal((await hintergrundMotiv(dir,bilder[0].id)).datei,path.join(dir,'01_Saal_Fenster.png'));
  await assert.rejects(hintergrundMotiv(dir,'../../privat.jpg'),/nicht mehr verfügbar/);
  await fs.unlink(bilder[0].datei);await assert.rejects(hintergrundMotiv(dir,bilder[0].id),/nicht mehr verfügbar/);
  assert.deepEqual(await hintergrundSammlung(path.join(dir,'fehlt')),[]);
});

test('Sammlung ist mit acht Motiven pro Seite bedienbar, auch bei ungültiger Navigation',()=>{
  const bilder=Array.from({length:11},(_,i)=>({id:String(i)}));
  assert.deepEqual(hintergrundSeite(bilder).bilder,bilder.slice(0,8));
  assert.equal(hintergrundSeite(bilder).seiten,2);
  assert.deepEqual(hintergrundSeite(bilder,1).bilder,bilder.slice(8));
  assert.equal(hintergrundSeite(bilder,999).seite,1);assert.equal(hintergrundSeite(bilder,NaN).seite,0);
  assert.deepEqual(hintergrundSeite([]),{bilder:[],seite:0,seiten:1});
});

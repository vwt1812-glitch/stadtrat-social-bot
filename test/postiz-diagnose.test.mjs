import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {diagnoseCode,diagnoseProgramm,kanalVorpruefung,postizDiagnose} from '../src/postiz-diagnose.mjs';

test('Konkrete Fehler werden ohne rohe Antworten oder Zugangsdaten klassifiziert',()=>{
  for(const [s,c] of [['credits depleted','GUTHABEN'],['413 Request Entity Too Large','DATEIGROESSE'],['File muss kleiner als 40 MB sein','DATEIGROESSE'],['Invalid token','VERBINDUNG'],['???','UNBEKANNT']])assert.equal(diagnoseCode(s),c);
});

test('Abgelaufene Verbindung sperrt vor dem Upload; historische X-Credits sind ein Hinweis',async()=>{
  const k=[{id:'b',name:'Bluesky',identifier:'bluesky'},{id:'x',name:'X',identifier:'x'}];
  const d={kanaele:[{id:'b',refreshNeeded:true}],posts:[{kanalId:'x',code:'GUTHABEN'}]};
  const r=kanalVorpruefung(k,d);assert.match(r.fehler.join(),/Bluesky.*erneuert/);assert.match(r.hinweise.join(),/letzten Versuch/);assert.equal(r.fehler.length,1);
  assert.deepEqual(kanalVorpruefung(k,null),{fehler:[],hinweise:[]});
  await assert.rejects(postizDiagnose('--privileged',[]),/Ungültiger/);
  assert.equal(await postizDiagnose('',[]),null);
});

test('Lokale Diagnose liest nur freigegebene IDs und gibt keine Token/Providerantworten aus',async()=>{
  const logs=[],requests=[],secret='GEHEIMER-WERT';
  class PrismaClient {
    integration={findMany:async q=>{requests.push(q);return [{id:'x',refreshNeeded:false}];}};
    post={findMany:async q=>{requests.push(q);return [{id:'p',state:'ERROR',integrationId:'x',error:'Unknown Error'}];}};
    async $disconnect(){}
  }
  class Client {workflow={getHandle:id=>{assert.equal(id,'post_p');return {fetchHistory:async()=>({events:[{activityTaskFailedEventAttributes:{failure:{message:'Unknown Error',applicationFailureInfo:{details:{payloads:[{data:Buffer.from(JSON.stringify({json:JSON.stringify({error:{detail:'credits depleted'},headers:{Authorization:secret}})}))}]}}}}}]})};}};}
  await vm.runInNewContext(diagnoseProgramm(['x'],['p']),{Buffer,Date,console:{log:s=>logs.push(s),error:s=>{throw Error(s)}},process:{env:{}},require:name=>name.endsWith('@prisma/client')?{PrismaClient}:{Client,Connection:{connect:async()=>({close:async()=>{}})}}});
  const result=JSON.parse(logs[0]);assert.deepEqual(result.posts,[{id:'p',kanalId:'x',code:'GUTHABEN'}]);
  assert.ok(!logs.join().includes(secret));assert.ok(!logs.join().includes('Authorization'));
  assert.deepEqual(Array.from(requests[0].where.id.in),['x']);assert.deepEqual(Array.from(requests[1].where.integrationId.in),['x']);
});

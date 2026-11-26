import {spawn} from 'node:child_process';

export const DIAGNOSE_TEXTE=Object.freeze({
  VERBINDUNG:'Die Kontoverbindung muss in Postiz erneuert werden.',
  GUTHABEN:'X meldet aufgebrauchte API-Credits. Vor einem weiteren Versuch das API-Guthaben prüfen.',
  DATEIGROESSE:'Die Plattform hat das Video wegen seiner Dateigröße abgelehnt. Eine kleinere Versandfassung ist erforderlich.',
  UNBEKANNT:'Postiz meldet einen Fehler ohne auswertbare Ursache. Bitte den Beitrag im Postiz-Kalender prüfen.',
});

/** Classify without copying tokens, headers or complete provider responses to Telegram. */
export function diagnoseCode(text) {
  if(/credits depleted|payment required/i.test(text))return 'GUTHABEN';
  if(/413|entity too large|file.*kleiner|file.*too large|file.*size.*limit/i.test(text))return 'DATEIGROESSE';
  if(/invalid.*token|token.*expired|authenticationrequired|invalidgrant|unauthorized/i.test(text))return 'VERBINDUNG';
  return 'UNBEKANNT';
}

// Executed only by an explicitly configured self-hosted installation. All database
// queries are SELECTs scoped to channel/post IDs obtained through this bot's API.
export function diagnoseProgramm(kanalIds,postIds) {
  return `
const {PrismaClient}=require('/app/node_modules/@prisma/client');
const db=new PrismaClient();
const kanalIds=${JSON.stringify(kanalIds)},postIds=${JSON.stringify(postIds)};
const code=${diagnoseCode.toString()};
function fehler(f){if(!f)return '';let out=f.message||'';for(const p of f.applicationFailureInfo?.details?.payloads||[])out+=' '+Buffer.from(p.data).toString();return out+' '+fehler(f.cause);}
(async()=>{let connection;try{
 const kanaele=await db.integration.findMany({where:{id:{in:kanalIds}},select:{id:true,refreshNeeded:true,disabled:true}});
 const angefragt=await db.post.findMany({where:{id:{in:postIds},integrationId:{in:kanalIds}},select:{id:true,state:true,integrationId:true,error:true}});
 const letzte=await db.post.findMany({where:{integrationId:{in:kanalIds},publishDate:{gte:new Date(Date.now()-3*86400000)}},orderBy:{publishDate:'desc'},take:100,select:{id:true,state:true,integrationId:true,error:true}});
 const neueste=[...new Map(letzte.slice().reverse().map(p=>[p.integrationId,p])).values()];
 const posts=[...new Map([...angefragt,...neueste].map(p=>[p.id,p])).values()];
 const {Client,Connection}=require('/app/node_modules/@temporalio/client');
 if(posts.some(p=>p.state==='ERROR'))try{connection=await Connection.connect({address:process.env.TEMPORAL_ADDRESS||'temporal:7233'});}catch{}
 const client=connection?new Client({connection}):null;
 const result=[];
 for(const p of posts.filter(p=>p.state==='ERROR')){
   let text=p.error||'';
   if(client&&code(text)==='UNBEKANNT')try{const h=await client.workflow.getHandle('post_'+p.id).fetchHistory();for(const e of h.events)text+=' '+fehler(e.activityTaskFailedEventAttributes?.failure);}catch{}
   const verbindung=kanaele.find(k=>k.id===p.integrationId)?.refreshNeeded;
   result.push({id:p.id,kanalId:p.integrationId,code:verbindung?'VERBINDUNG':code(text)});
 }
 console.log(JSON.stringify({kanaele,posts:result}));
}finally{await db.$disconnect();if(connection)await connection.close();}})().catch(()=>{console.error('Postiz-Diagnose nicht verfügbar');process.exitCode=1;});
`;
}

export async function postizDiagnose(container,kanalIds,postIds=[]) {
  if(!container)return null;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container))throw Error('Ungültiger Postiz-Containername.');
  return new Promise((resolve,reject)=>{
    const p=spawn('docker',['exec','-i',container,'node'],{stdio:['pipe','pipe','pipe']});
    let out='',fertig=false;
    const timer=setTimeout(()=>{p.kill();ende(Error('Postiz-Diagnose hat zu lange gedauert.'));},25000);
    function ende(e,data){if(fertig)return;fertig=true;clearTimeout(timer);e?reject(e):resolve(data);}
    p.on('error',()=>ende(Error('Lokale Postiz-Diagnose ist nicht erreichbar.')));
    p.stdin.on('error',()=>{});
    p.stdout.on('data',d=>{out+=d;if(out.length>1e6){p.kill();ende(Error('Ungültige Diagnoseantwort.'));}});
    p.stderr.on('data',()=>{});
    p.on('close',n=>{if(n!==0)return ende(Error('Lokale Postiz-Diagnose ist nicht verfügbar.'));try{const data=JSON.parse(out);if(!Array.isArray(data.kanaele)||!Array.isArray(data.posts))throw Error();ende(null,data);}catch{ende(Error('Ungültige Diagnoseantwort.'));}});
    p.stdin.end(diagnoseProgramm([...new Set(kanalIds)],[...new Set(postIds)]));
  });
}

export function kanalVorpruefung(kanaele,diagnose) {
  const fehler=[],hinweise=[];
  for(const k of kanaele) {
    const info=diagnose?.kanaele.find(x=>x.id===k.id);
    if(info?.refreshNeeded||info?.disabled)fehler.push(`${k.name} (${k.identifier}): ${DIAGNOSE_TEXTE.VERBINDUNG}`);
    if(k.identifier==='x'&&diagnose?.posts.some(p=>p.kanalId===k.id&&p.code==='GUTHABEN'))hinweise.push(`${k.name} (X): Beim letzten Versuch waren die API-Credits aufgebraucht. Das aktuelle Guthaben lässt sich hier nicht vorab bestätigen.`);
  }
  return {fehler,hinweise};
}

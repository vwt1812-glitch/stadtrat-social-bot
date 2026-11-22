import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ausfuehren,untersuche} from './video.mjs';

// Conservative defaults for this installation. Mastodon limits depend on the server.
// Telegram's ordinary Bot API accepts 50 MB; reserve space for multipart overhead.
export function versandGrenze(kanal,eigene={}) {
  const mb=eigene[kanal.id]?.maxVideoMB??eigene[kanal.identifier]?.maxVideoMB??({mastodon:40,telegram:48})[kanal.identifier];
  if(mb===undefined)return null;
  if(!Number.isFinite(mb)||mb<=0)throw Error('maxVideoMB muss eine positive Zahl sein.');
  return Math.floor(mb*1e6);
}

/** Same feed source as Postiz; story attachments are deliberately independent. */
export function versandQuellen(auftrag,kanal,hochkant=false,netze=[]) {
  return hochkant&&auftrag.storyDatei&&netze.includes(kanal.identifier)?[auftrag.storyDatei]:auftrag.medien??[];
}

export async function versandBedarf(auftrag,kanaele,{eigene={},hochkant=false,netze=[]}={}) {
  if(auftrag.nurStory||auftrag.art!=='video'||auftrag.postiz?.post)return [];
  const result=[];
  for(const kanal of kanaele) {
    const maxBytes=versandGrenze(kanal,eigene);if(!maxBytes)continue;
    for(const [index,datei] of versandQuellen(auftrag,kanal,hochkant,netze).entries()) {
      if((await fs.stat(datei)).size>maxBytes)result.push({kanal,index,datei,maxBytes});
    }
  }
  return result;
}

const laufend=new Map();
/** Full length, original framing and already rendered subtitles; no audio enhancement again. */
export async function versandVideo(datei,maxBytes,ordner) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw Error('Ungültiges Dateilimit.');
  const stat=await fs.stat(datei);
  if(stat.size<=maxBytes)return datei;
  const key=createHash('sha256').update(JSON.stringify({version:1,datei:path.resolve(datei),size:stat.size,mtime:stat.mtimeMs,maxBytes})).digest('hex').slice(0,24);
  const ziel=path.join(ordner,`versand-${key}.mp4`);
  if(laufend.has(ziel))return laufend.get(ziel);
  const promise=(async()=>{
    const info=await untersuche(datei);
    if(!Number.isFinite(info.dauer)||info.dauer<=0)throw Error('Videodauer für Versandfassung unbekannt.');
    const passt=async f=>{try {const s=await fs.stat(f),m=await untersuche(f);return s.size>0&&s.size<=maxBytes&&Math.abs(m.dauer-info.dauer)<0.25&&m.hatTon===info.hatTon;}catch{return false;}};
    if(await passt(ziel))return ziel;
    const tmp=await fs.mkdtemp(path.join(path.resolve(ordner),'versand-temp-'));
    try {
      const audio=info.hatTon?96000:0;
      const faktor=Math.min(1,1280/Math.max(info.breite,info.hoehe));
      const breite=Math.max(2,Math.floor(info.breite*faktor/2)*2),hoehe=Math.max(2,Math.floor(info.hoehe*faktor/2)*2);
      let bitrate=Math.floor(maxBytes*.92*8/info.dauer-audio);
      if(bitrate<180000)throw Error('Das Video ist für eine lesbare vollständige Versandfassung zu lang. Bitte einen kürzeren Ausschnitt wählen oder das Dateilimit prüfen.');
      const ausgabe=path.join(tmp,'video.mp4'),log=path.join(tmp,'pass');
      for(let versuch=0;versuch<2;versuch++) {
        const basis=['-y','-v','error','-i',datei,'-map','0:v:0','-vf',`scale=${breite}:${hoehe},setsar=1,fps=30`,'-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-b:v',String(bitrate),'-passlogfile',log];
        await ausfuehren('ffmpeg',[...basis,'-pass','1','-an','-f','null',process.platform==='win32'?'NUL':'/dev/null']);
        await ausfuehren('ffmpeg',[...basis,'-pass','2','-map','0:a:0?','-c:a','aac','-b:a','96k','-movflags','+faststart',ausgabe]);
        if(await passt(ausgabe)){
          const aktuell=await fs.stat(datei);
          if(aktuell.size!==stat.size||aktuell.mtimeMs!==stat.mtimeMs)throw Error('Die Videodatei wurde während der Vorbereitung geändert. Bitte erneut versuchen.');
          await fs.rename(ausgabe,ziel);return ziel;
        }
        bitrate=Math.floor(bitrate*.8);
      }
      throw Error('Die kleinere Versandfassung erfüllt Dateilimit oder Vollständigkeitsprüfung nicht. Es wurde nichts ersetzt.');
    } finally {
      if(path.dirname(tmp)!==path.resolve(ordner))throw Error('Ungültiger temporärer Versandordner.');
      await fs.rm(tmp,{recursive:true,force:true});
    }
  })();
  laufend.set(ziel,promise);
  try{return await promise;}finally{laufend.delete(ziel);}
}

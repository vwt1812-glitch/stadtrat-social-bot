import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

/** Only directly contained regular image files, never paths supplied in callbacks. */
export async function hintergrundSammlung(ordner) {
  if(!ordner)return [];
  let files;
  try{files=await fs.readdir(ordner,{withFileTypes:true});}
  catch(e){if(e.code==='ENOENT')return [];throw e;}
  return files.filter(f=>f.isFile()&&/\.(jpe?g|png|webp)$/i.test(f.name)&&!f.name.startsWith('.'))
    .sort((a,b)=>a.name.localeCompare(b.name,'de',{numeric:true}))
    .map(f=>{
      const name=path.basename(f.name,path.extname(f.name)).replace(/^\d+[\s_-]+/,'').replace(/_/g,' ');
      return {id:createHash('sha256').update(f.name).digest('hex').slice(0,12),name:name.charAt(0).toLocaleUpperCase('de-DE')+name.slice(1),datei:path.join(ordner,f.name)};
    });
}

export async function hintergrundMotiv(ordner,id) {
  const bild=(await hintergrundSammlung(ordner)).find(b=>b.id===id);
  if(!bild)throw Error('Dieser gespeicherte Hintergrund ist nicht mehr verfügbar. Bitte ein anderes Motiv wählen.');
  return bild;
}

export function hintergrundSeite(bilder,seite=0) {
  const seiten=Math.max(1,Math.ceil(bilder.length/8)),nr=Math.max(0,Math.min(Number.isSafeInteger(seite)?seite:0,seiten-1));
  return {bilder:bilder.slice(nr*8,nr*8+8),seite:nr,seiten};
}

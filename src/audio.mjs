import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomBytes} from "node:crypto";

export const AUDIO_MODI=Object.freeze({original:"Originalton",lautstaerke:"Lautstärke ausgleichen",sprache:"Sprache behutsam verbessern"});
// Modest denoising and gentle compression; no gate that cuts word beginnings or room decays.
export const SPRACH_FILTER="highpass=f=70,afftdn=nr=4:nf=-55:tn=1,acompressor=threshold=0.125:ratio=1.5:attack=20:release=250:makeup=1";
export function tonProzess(bin,args) {
  return new Promise((resolve,reject)=>{
    const p=spawn(bin,args,{stdio:["ignore","pipe","pipe"]});let out="",err="";
    p.stdout.on("data",d=>out=(out+d).slice(-128000));p.stderr.on("data",d=>err=(err+d).slice(-128000));
    p.on("error",reject);p.on("close",code=>code===0?resolve({out,err}):reject(Error(`${bin} fehlgeschlagen: ${err.slice(-2000)}`)));
  });
}
export function messungLesen(text) {
  const treffer=text.match(/\{\s*"input_i"[\s\S]*?\}/g);
  if(!treffer?.length)throw Error("Lautstärkemessung konnte nicht gelesen werden.");
  const m=JSON.parse(treffer.at(-1));
  if(m.input_i==="-inf")return null;
  for(const k of ["input_i","input_tp","input_lra","input_thresh","target_offset"])if(!Number.isFinite(Number(m[k])))throw Error("Ungültige Lautstärkemessung.");
  return m;
}
export async function audioFilter(eingabe,modus="original",ordner=path.dirname(eingabe)) {
  if(!Object.hasOwn(AUDIO_MODI,modus))throw Error("Unbekannte Tonkorrektur.");
  if(modus==="original")return null;
  const probe=JSON.parse((await tonProzess("ffprobe",["-v","error","-show_streams","-of","json",eingabe])).out);
  const spur=probe.streams.find(s=>s.codec_type==="audio");
  if(!spur)return null;
  const kanaele=spur.channels===1?"mono":"stereo";
  const stat=await fs.stat(eingabe),hash=createHash("sha256").update(JSON.stringify([eingabe,stat.size,stat.mtimeMs,modus,1])).digest("hex").slice(0,20);
  const datei=path.join(ordner,`audio-analyse-${hash}.json`),vorfilter=modus==="sprache"?SPRACH_FILTER+",":"";
  let m;
  try {m=JSON.parse(await fs.readFile(datei,"utf8"));}
  catch {
    const {err}=await tonProzess("ffmpeg",["-hide_banner","-nostats","-i",eingabe,"-vn","-sn","-dn","-map","0:a:0","-af",vorfilter+"loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json","-f","null","-"]);
    m=messungLesen(err);await fs.writeFile(datei,JSON.stringify(m));
  }
  if(!m)return null; // Silence must not be amplified into noise.
  for(const k of ["input_i","input_tp","input_lra","input_thresh","target_offset"])if(!Number.isFinite(Number(m[k])))throw Error("Ungültige gespeicherte Lautstärkemessung.");
  return vorfilter+`loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${Number(m.input_i)}:measured_TP=${Number(m.input_tp)}:measured_LRA=${Number(m.input_lra)}:measured_thresh=${Number(m.input_thresh)}:offset=${Number(m.target_offset)}:linear=true,aformat=sample_rates=48000:channel_layouts=${kanaele}`;
}

/** Replace only audio, always taking it from the original; video packets are copied unchanged. */
export async function videoTonErsetzen({eingabe,original,ausgabe,modus}) {
  const filter=await audioFilter(original,modus,path.dirname(ausgabe));
  const args=["-y","-v","error","-i",eingabe,"-i",original,"-map","0:v:0","-map","1:a:0?","-c:v","copy"];
  if(filter)args.push("-af",filter);
  args.push("-c:a","aac","-b:a","160k","-movflags","+faststart",ausgabe);
  await tonProzess("ffmpeg",args);
}

export async function auftragTonErsetzen(a,modus) {
  if(!a.original||!a.medien?.length)throw Error("Bitte zuerst eine Videovorschau erstellen.");
  const neu=new Map(),dateien=[];
  try {
    for(const f of [...a.medien,...(a.storyDatei?[a.storyDatei]:[])])if(!neu.has(f)) {
      const ziel=path.join(a.ordner,`audio-${randomBytes(6).toString("hex")}.mp4`);dateien.push(ziel);
      await videoTonErsetzen({eingabe:f,original:a.original,ausgabe:ziel,modus});neu.set(f,ziel);
    }
    const medien=a.medien.map(f=>neu.get(f)),stand=await fs.stat(medien[0]);
    return {medien,storyDatei:a.storyDatei?neu.get(a.storyDatei):a.storyDatei,audioTuning:modus,hochgeladen:null,storyHochgeladen:null,storyClips:null,plan:null,
      ...(a.thumbnail?{thumbnail:{...a.thumbnail,videoStand:{datei:medien[0],groesse:stand.size,geaendert:stand.mtimeMs}}}:{})};
  } catch(e) {await Promise.allSettled(dateien.map(f=>fs.rm(f,{force:true})));throw e;}
}

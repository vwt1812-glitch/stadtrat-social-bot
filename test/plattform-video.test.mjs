import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {sichereZone} from "../src/story-layout.mjs";
import {sichererHochkantAusschnitt} from "../src/plattform-video.mjs";
import {storyLayout,ausfuehren,logoGrafik} from "../src/video.mjs";
import {untertitelPosition,untertitelRahmen,untertitelTextBreite,zuAss} from "../src/untertitel.mjs";

const original={breite:1920,hoehe:1080,dauer:12};
const masse={breite:1080,hoehe:1920,dauer:12};
const layout={position:0.35,zeilen:1,schrift:"Inter",farbe:"#F18616",rand:"#1D1D1B",stil:"rand"};
const funde=(y=0.4,h=0.36,w=0.16)=>({bilder:24,version:3,dicht:true,alleGesichter:true,
  zeiten:Array.from({length:24},(_,i)=>i/2),gesichter:Array.from({length:24},(_,i)=>({t:i/2,x:0.36,y,w,h}))});

test("Gesicht und Untertitel passen gemeinsam oberhalb der Reels-Bedienelemente",()=>{
  const f=funde(),a=sichererHochkantAusschnitt(original,f,masse,layout);
  assert.ok(a?.darstellung);
  assert.ok(a.breite>608&&a.breite<original.breite);
  const l=storyLayout({...layout,gesichter:f.gesichter},original,masse,a);
  const r=untertitelRahmen({...masse,...l}),zone=sichereZone(masse,"reel");
  for(const g of l.gesichter) {
    assert.ok(g.x*1080>=zone.links);
    assert.ok((g.x+g.w)*1080<=zone.rechts);
    assert.ok(g.y*1920>=zone.oben);
    assert.ok((g.y+g.h)*1920<r.unten-r.textHoehe);
  }
  assert.ok(r.unten<=zone.unten);
});

test("Ausreichend kleiner Sprecher kann weiterhin die ganze 9:16-Fläche nutzen",()=>{
  const a=sichererHochkantAusschnitt(original,funde(0.26,0.12,0.06),masse,layout);
  assert.ok(a);
  assert.equal(a.darstellung,undefined);
});

test("Zusätzliche Personen im breiteren Ausschnitt werden erneut gegen den Textbereich geprüft",()=>{
  const f=funde();
  for(const g of [...f.gesichter])if(g.t>=4&&g.t<=7) {
    f.gesichter.push({...g,x:0.55,y:0.5,w:0.1});
  }
  const a=sichererHochkantAusschnitt(original,f,masse,layout);
  assert.ok(a?.darstellung);
  assert.ok(a.bereiche.some(b=>b.ab<=5&&b.bis>=6));
  const l=storyLayout({...layout,gesichter:f.gesichter},original,masse,a);
  const r=untertitelRahmen({...masse,...l});
  for(const g of l.gesichter)assert.ok((g.y+g.h)*1920<r.unten-r.textHoehe);
});

test("Auch ausdrückliche Randpositionen lassen den ganzen Textblock innerhalb der UI-Freizonen",()=>{
  for(const modus of ["reel","story"])for(const zeilen of [1,2])for(const position of [0,0.16,0.35,0.99]) {
    const o={...masse,...layout,layoutModus:modus,zeilen,position};
    const r=untertitelRahmen(o),unten=(1-untertitelPosition(o))*o.hoehe;
    assert.ok(unten<=r.unten+0.001);
    assert.ok(unten-r.textHoehe>=r.oben-0.001);
    const manuell={...o,lage:"logobereich"};
    const obenUnten=(1-untertitelPosition(manuell))*o.hoehe;
    assert.ok(obenUnten-r.textHoehe>=r.oben-0.001);
  }
});

test("Fontmetriken gehören zur mitgelieferten Schrift und berücksichtigen echte Zeichenbreiten",async()=>{
  const m=JSON.parse(await fs.readFile(new URL('../assets/fonts/inter-bold-metriken.json',import.meta.url)));
  const font=await fs.readFile(new URL('../assets/fonts/Inter-Bold.otf',import.meta.url));
  assert.equal(createHash('sha256').update(font).digest('hex'),m.sha256);
  assert.ok(untertitelTextBreite('WWWW',67)>untertitelTextBreite('iiii',67)*2);
  const o={...masse,...layout,layoutModus:"reel"};
  const ass=zuAss([{start:0,end:1000,text:"Dienstaufwandsentschädigungen"}],o);
  assert.match(ass,/\{\\fs\d+\}/);
});

const ffmpeg=(()=>{try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});return true;}catch{return false;}})();
test("Auch übergroße Logos passen vollständig in die Plattform-Freizone",{skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'logo-safe-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const logo=path.join(dir,'eingabe.png');
  await ausfuehren('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=white:s=800x300','-frames:v','1',logo]);
  for(const logoStil of ['frei','karte']) {
    const g=await logoGrafik({layout:{...layout,logo,logoStil,logoBreite:0.85,logoPosition:'oben-rechts',smartLogo:true,layoutModus:'reel',karteFarbe:'#1D1D1B'},masse,ordner:dir});
    const z=sichereZone(masse,'reel'),r=g.sichtbar;
    assert.ok(r.x>=z.links&&r.x+r.w<=z.rechts&&r.y>=z.oben&&r.y+r.h<=z.unten);
  }
});
test("Gerenderte lange Untertitel einschließlich Rand und Schatten bleiben in den Safe Areas",{skip:!ffmpeg},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'untertitel-safe-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.cp(new URL('../assets/fonts',import.meta.url),path.join(dir,'fonts'),{recursive:true});
  for(const [modus,stil,lage] of [["reel","rand",null],["reel","box","logobereich"],["story","rand","oben"]]) {
    const o={...masse,...layout,layoutModus:modus,position:0.16,stil,lage};
    await fs.writeFile(path.join(dir,'sicher.ass'),zuAss([{start:0,end:1000,text:'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW'}],o));
    const raw=await ausfuehren('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x777777:s=1080x1920:d=1',
      '-vf','ass=sicher.ass:fontsdir=fonts','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{cwd:dir,binaer:true});
    let x0=1080,x1=-1,y0=1920,y1=-1;
    for(let y=0;y<1920;y++)for(let x=0;x<1080;x++) {
      const i=(y*1080+x)*3;
      if(Math.max(Math.abs(raw[i]-119),Math.abs(raw[i+1]-119),Math.abs(raw[i+2]-119))>20) {
        x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      }
    }
    const z=sichereZone(masse,modus);
    assert.ok(x1>x0&&y1>y0);
    assert.ok(x0>=z.links&&x1<z.rechts&&y0>=z.oben&&y1<z.unten,`${modus}/${stil}: ${[x0,x1,y0,y1]}`);
  }
});

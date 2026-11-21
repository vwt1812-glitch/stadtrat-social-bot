import { sichereZone } from "./story-layout.mjs";
import { untertitelRahmen } from "./untertitel.mjs";
import { ausschnittAktiv, hochkantAusschnitt } from "./hochkant-ausschnitt.mjs";

/** Bild und Text gemeinsam planen: freier Mund darf nicht auf Kosten der UI-Flächen gehen. */
export function sichererHochkantAusschnitt(original,funde,masse,layout) {
  const zonen=sichereZone(masse,"reel");
  const text=untertitelRahmen({...masse,...layout,layoutModus:"reel"});
  const normal=hochkantAusschnitt(original,funde,{links:zonen.links/masse.breite,rechts:zonen.rechts/masse.breite});
  const referenz=normal??hochkantAusschnitt(original,funde);
  if(!referenz)return null;
  const gesichter=funde.gesichter.filter(g=>ausschnittAktiv(referenz,g.t));
  const unten=Math.max(...gesichter.map(g=>g.y+g.h*1.05));
  const oben=Math.min(...gesichter.map(g=>Math.max(0,g.y-g.h*0.2)));
  const textOben=text.unten-text.textHoehe;
  const abstand=Math.round(masse.hoehe*0.02);
  if(normal&&oben*masse.hoehe>=zonen.oben&&unten*masse.hoehe<=textOben-abstand)return normal;
  let kopfUnten=unten;
  for(let versuch=0;versuch<8;versuch++) {
    const h=Math.floor(Math.min(masse.hoehe,(textOben-abstand-zonen.oben)/kopfUnten)/2)*2;
    const w=Math.round(original.hoehe*masse.breite/h/2)*2;
    if(h<2||w>original.breite)return null;
    const a=hochkantAusschnitt(original,funde,{breite:w,links:zonen.links/masse.breite,rechts:zonen.rechts/masse.breite});
    if(!a)return null;
    // Ein breiterer Ausschnitt kann zusätzliche Abschnitte/Personen einschließen.
    // Deren Kopfbereiche müssen ebenfalls oberhalb des Textes bleiben.
    const neuUnten=Math.max(...funde.gesichter.filter(g=>ausschnittAktiv(a,g.t)).map(g=>g.y+g.h*1.05));
    if(neuUnten>kopfUnten+1e-9) {kopfUnten=neuUnten;continue;}
    const dauer=original.dauer??masse.dauer??Math.max(...funde.gesichter.map(g=>g.t))+1;
    return {...a,ab:a.ab??0,bis:a.bis??dauer,darstellung:{x:0,y:zonen.oben,breite:masse.breite,hoehe:h}};
  }
  return null;
}

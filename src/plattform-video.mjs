import { untertitelRahmen } from "./untertitel.mjs";
import { hochkantAusschnitt } from "./hochkant-ausschnitt.mjs";

/** Ein echter 9:16-Ausschnitt füllt das Zielbild. UI-Freizonen gelten für die Einblendungen. */
export function sichererHochkantAusschnitt(original,funde) {
  return hochkantAusschnitt(original,funde);
}

/** Fester Textplatz je Video: zuerst Mund schützen, dann übrige Kopfbereiche. */
export function ausschnittUntertitelPosition(gesichter,masse,layout) {
  const r=untertitelRahmen({...masse,...layout,layoutModus:"reel"});
  const unten=r.unten,oben=r.oben+r.textHoehe;
  if(!gesichter.length)return 1-unten/masse.hoehe;
  const overlap=(a,b,c,d)=>Math.max(0,Math.min(b,d)-Math.max(a,c));
  let beste={y:unten,mund:Infinity,kopf:Infinity};
  for(let y=unten;y>=oben;y-=2) {
    const top=(y-r.textHoehe)/masse.hoehe,bottom=y/masse.hoehe;
    let mund=0,kopf=0;
    for(const g of gesichter) {
      mund+=overlap(top,bottom,g.y+g.h*0.55,g.y+g.h*1.05);
      kopf+=overlap(top,bottom,g.y-g.h*0.2,g.y+g.h*1.05);
    }
    if(mund<beste.mund-1e-9||(Math.abs(mund-beste.mund)<1e-9&&kopf<beste.kopf-1e-9))beste={y,mund,kopf};
  }
  return 1-beste.y/masse.hoehe;
}

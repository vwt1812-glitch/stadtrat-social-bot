# Regenerate with: python scripts/untertitel-metriken.py
# Inter is distributed under the SIL Open Font License in assets/fonts/.
# OpenType tables: https://learn.microsoft.com/en-us/typography/opentype/spec/hmtx
# Unicode mapping: https://learn.microsoft.com/en-us/typography/opentype/spec/cmap
import struct,json,hashlib,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
font=root/'assets/fonts/Inter-Bold.otf'; data=font.read_bytes()
u16=lambda p:struct.unpack_from('>H',data,p)[0]
s16=lambda p:struct.unpack_from('>h',data,p)[0]
u32=lambda p:struct.unpack_from('>I',data,p)[0]
tables={data[12+i*16:16+i*16].decode('ascii'):u32(20+i*16) for i in range(u16(4))}
c=tables['cmap'];sub=None
for i in range(u16(c+2)):
    r=c+4+i*8;p=c+u32(r+4)
    if u16(r) in (0,3) and u16(p)==4:sub=p
if sub is None:raise RuntimeError('Unicode cmap Format 4 fehlt')
n=u16(sub+6)//2;end=sub+14;start=end+2*n+2;delta=start+2*n;offset=delta+2*n
metrics=u16(tables['hhea']+34);units=u16(tables['head']+18)
def glyph(cp):
    for i in range(n):
        if u16(start+2*i)<=cp<=u16(end+2*i):
            d=s16(delta+2*i);r=u16(offset+2*i)
            if not r:return (cp+d)&65535
            g=u16(offset+2*i+r+2*(cp-u16(start+2*i)))
            return (g+d)&65535 if g else 0
    return 0
chars=list(range(32,592))+list(range(0x2010,0x2040))+[0x20ac]
adv={chr(cp):u16(tables['hmtx']+4*min(glyph(cp),metrics-1)) for cp in chars if glyph(cp)}
out={'font':'Inter-Bold.otf','sha256':hashlib.sha256(data).hexdigest(),'unitsPerEm':units,'advances':adv}
(root/'assets/fonts/inter-bold-metriken.json').write_text(json.dumps(out,ensure_ascii=True,separators=(',',':'))+'\n',encoding='utf-8')
print('Zeichenmetriken:',len(adv),'Einheiten pro em:',units)

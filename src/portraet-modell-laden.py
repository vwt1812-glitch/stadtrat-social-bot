import pathlib,urllib.request,hashlib
root=pathlib.Path(__file__).resolve().parents[1]
target=root/'daten/modelle/isnet-general-use.onnx'
expected='fc16ebd8b0c10d971d3513d564d01e29'
target.parent.mkdir(parents=True,exist_ok=True)
if target.exists() and hashlib.md5(target.read_bytes()).hexdigest()==expected:
    print('Freistellungsmodell bereit');raise SystemExit
part=target.with_suffix('.download')
try:
    urllib.request.urlretrieve('https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',part)
    if hashlib.md5(part.read_bytes()).hexdigest()!=expected:raise ValueError('Prüfsumme des Freistellungsmodells stimmt nicht')
    part.replace(target)
finally:
    part.unlink(missing_ok=True)
print('Freistellungsmodell eingerichtet')

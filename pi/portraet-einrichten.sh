# Separate Bildumgebung; vorhandene Gesichtssuche bleibt verwendbar.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv-portraet
.venv-portraet/bin/python -m pip install --disable-pip-version-check -r pi/portraet-requirements.txt
.venv-portraet/bin/python src/portraet-modell-laden.py
printf '%s\n' 'In .env setzen: THUMBNAIL_PYTHON=.venv-portraet/bin/python'

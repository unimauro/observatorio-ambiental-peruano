#!/usr/bin/env bash
# Refresca los datos del módulo El Niño desde una IP RESIDENCIAL y los sube al repo.
#
# Por qué: el GeoServer del SENAMHI (idesep.senamhi.gob.pe) y senamhi.gob.pe no responden a
# IPs de datacenter (GitHub Actions, VPS Hostinger): las conexiones expiran. ENFEN tampoco
# resuelve desde el runner. Desde una conexión doméstica funcionan. Este script corre el ETL
# completo aquí, commitea solo los archivos de datos y hace push; el push dispara el deploy,
# cuyo paso "Recuperar" conserva la copia más nueva (repo vs Pages) y el ETL en CI vuelve a
# refrescar NOAA/Open-Meteo cada hora.
#
# Uso manual:   ./etl/sync_nino_local.sh
# Programado:   docs/launchd/pe.tunky.oap-nino.plist (cada hora mientras la Mac esté encendida)
#               cp docs/launchd/pe.tunky.oap-nino.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/pe.tunky.oap-nino.plist
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG=/tmp/oap-nino-sync.log
exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) inicio"

if [ -n "$(git status --porcelain --untracked-files=no | grep -v '^ M public/data/nino\|^ M public/data/csv/nino-' || true)" ]; then
  echo "hay cambios locales sin commitear fuera de los datos; no se sincroniza"; exit 0
fi
git pull --rebase -q origin main || { echo "pull falló"; exit 1; }

set +e
python3 etl/build_nino.py; rc=$?
set -e
if [ "$rc" != 0 ]; then echo "ETL terminó con código $rc; no se publica"; exit 0; fi

# ¿Respondió el SENAMHI? Si no, no vale la pena commitear (CI ya refresca NOAA/Open-Meteo)
if python3 -c "import json,sys; e=json.load(open('public/data/nino/estado.json')); sys.exit(0 if any(f['estado']=='ok' and f['id'].startswith('SENAMHI') for f in e['fuentes']) else 1)"; then
  git add public/data/nino public/data/csv/nino-*.csv
  if git diff --cached --quiet; then echo "sin cambios"; exit 0; fi
  git commit -q -m "El Niño: datos SENAMHI/ENFEN refrescados desde IP residencial ($(date -u +%FT%H:%MZ))"
  git push -q origin main && echo "publicado"
else
  echo "SENAMHI no respondió desde esta red; no se commitea"
  git checkout -q -- public/data/nino public/data/csv/nino-*.csv 2>/dev/null || true
fi
echo "=== fin"

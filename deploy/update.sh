#!/usr/bin/env bash
# Portal DreamTeam · instala, compila y reinicia después de subir archivos por WinSCP.
# Uso (como root):  bash /var/www/portal/deploy/update.sh
set -euo pipefail
APP=/var/www/portal

# WinSCP sube los archivos como tu usuario: se devuelven al usuario del servicio
chown -R portal:portal "$APP"
chmod 600 "$APP/server/.env"

sudo -u portal -H bash -c "
  set -e
  cd '$APP'
  npm ci --no-audit --no-fund
  cd server
  npx prisma generate
  # Aplica cambios del esquema. Si un cambio borraría datos, se detiene y avisa.
  npx prisma db push --skip-generate
  # Chromium para los reportes (solo descarga si cambió la versión de Playwright)
  PLAYWRIGHT_BROWSERS_PATH=$APP/.playwright npx playwright install chromium
  cd ..
  npm run build
"

systemctl restart portal-api portal-worker
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:4100/api/health >/dev/null; then echo "Portal actualizado y en línea."; exit 0; fi
  sleep 1
done
echo "El API no respondió. Revisa: journalctl -u portal-api -n 50" >&2
exit 1

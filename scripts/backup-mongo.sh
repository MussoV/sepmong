#!/usr/bin/env bash
# Backup diario de MongoDB. Cron sugerido (3 a. m. hora del servidor, UTC):
#   0 3 * * * /opt/semillero/scripts/backup-mongo.sh >> /opt/semillero/backups/backup.log 2>&1
set -euo pipefail

BASE_DIR="/opt/semillero"
RETENCION_DIAS=14

set -a; source "${BASE_DIR}/.env"; set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVO="mongo-${APP_DB_NAME}-${STAMP}.archive.gz"

docker exec semillero-mongo mongodump \
  --username "${MONGO_INITDB_ROOT_USERNAME}" \
  --password "${MONGO_INITDB_ROOT_PASSWORD}" \
  --authenticationDatabase admin \
  --db "${APP_DB_NAME}" \
  --archive="/backups/${ARCHIVO}" \
  --gzip

find "${BASE_DIR}/backups" -name "mongo-*.archive.gz" -mtime +${RETENCION_DIAS} -delete

echo "$(date -u +%FT%TZ) OK ${ARCHIVO}"

# PENDIENTE: copiar el archivo fuera del servidor (R2 / GCS).
# Un backup en el mismo disco no protege contra la pérdida del servidor.

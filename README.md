# sepmong — Base de datos documental del semillero

MongoDB 8.0 en Docker para el sitio web y dashboard del invernadero.
Guarda contenido, catálogo de sensores, umbrales, alertas, mensajes y auditoría.
Las lecturas de sensores **no** están aquí: siguen en InfluxDB (escritas por Node-RED).

Modelo de datos, relaciones y decisiones de diseño: [`docs/modelo-datos.md`](docs/modelo-datos.md)

## Estructura

```
docker-compose.yml        MongoDB, solo en 127.0.0.1, con healthcheck y límites de memoria
.env.example              Plantilla de secretos (copiar a .env, nunca subir .env)
mongo-init/
  01-colecciones.js       13 colecciones con validación $jsonSchema e índices
  02-roles-usuarios.js    Rol semilleroApp (mínimo privilegio) y usuario de la app
  03-semillas.js          Variables, config del sitio, primer admin, versión de esquema
scripts/backup-mongo.sh   Backup diario con retención de 14 días
docs/modelo-datos.md      Modelo de datos
```

## Despliegue

Requisitos: Docker Engine y Docker Compose v2. El puerto 27017 debe estar libre.

```bash
# 1. Clonar
cd /opt && sudo git clone <url-del-repo> semillero
sudo chown -R $USER:$USER /opt/semillero && cd /opt/semillero

# 2. Secretos
cp .env.example .env && chmod 600 .env
openssl rand -base64 32 | tr -d '/+=' | head -c 32; echo   # una por contraseña
nano .env        # contraseñas + ADMIN_INICIAL_EMAIL (@uniandes.edu.co)

# 3. Permisos y validación
chmod 644 mongo-init/*.js && chmod +x scripts/backup-mongo.sh
docker compose config --quiet && echo "compose OK"

# 4. Levantar (el primer arranque ejecuta mongo-init/)
docker compose up -d
docker compose logs -f mongo     # esperar "Semillas cargadas." y salir con Ctrl+C
```

### Verificar

```bash
docker compose ps                    # healthy
sudo ss -tulpn | grep 27017          # 127.0.0.1:27017, NUNCA 0.0.0.0

source .env
docker exec -it semillero-mongo mongosh --quiet \
  -u "$APP_DB_USER" -p "$APP_DB_PASSWORD" --authenticationDatabase "$APP_DB_NAME" "$APP_DB_NAME" \
  --eval 'print(db.getCollectionNames().length + " colecciones"); print(db.variables.countDocuments() + " variables")'
# Esperado: 13 colecciones, 3 variables
```

### Backup

```bash
./scripts/backup-mongo.sh && ls -lh backups/
crontab -e
# 0 3 * * * /opt/semillero/scripts/backup-mongo.sh >> /opt/semillero/backups/backup.log 2>&1
```

Pendiente: copiar los backups fuera del servidor (R2 / GCS).

### Si falla el primer arranque

Los scripts de `mongo-init/` solo corren con la carpeta de datos vacía:

```bash
docker compose down
sudo rm -rf data/mongo/*
docker compose up -d
```

## Conexión desde la API

```
mongodb://semillero_app:<APP_DB_PASSWORD>@127.0.0.1:27017/semillero?authSource=semillero
```

El usuario de la app no puede crear índices, desactivar validaciones ni editar la auditoría.
Si se usa un ODM que crea índices al arrancar (p. ej. Beanie), desactivarlo.

## Seguridad

- Mongo publica el puerto **solo en loopback**. Docker se salta `ufw`, así que esa línea del Compose es la protección real.
- Cuando exista el túnel WireGuard con la VM, se agrega la línea comentada con la IP del túnel y Docker debe arrancar después de `wg-quick@wg0`.
- Cambios de esquema: ver la sección "Cambios al esquema" en `docs/modelo-datos.md`.

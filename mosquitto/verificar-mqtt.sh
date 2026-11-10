#!/usr/bin/env bash
# Verificación del broker MQTT (ejecutar en el servidor del semillero).
echo "== 1. Configuración"
docker exec mosquitto grep -E "allow_anonymous|password_file|acl_file" /mosquitto/config/mosquitto.conf

echo "== 2. Un anónimo debe ser rechazado"
docker exec mosquitto mosquitto_sub -t '#' -C 1 -W 5 2>&1 | grep -q "not authorised" \
  && echo "OK: anónimo rechazado" || echo "ALERTA: el anónimo NO fue rechazado"

echo "== 3. Conexiones abiertas"
docker exec mosquitto netstat -tn | grep -c ':1883 .*ESTABLISHED'

echo "== 4. Última conexión de cada cliente (todas deben tener u'...')"
docker logs mosquitto 2>&1 | grep "New client connected" | grep -v "from ::1" \
  | awk '{for(i=1;i<=NF;i++) if($i=="as") id=$(i+1); u[id]=$0} END{for(k in u) print u[k]}'

echo "== 5. Rechazos de dispositivos reales en 24 h"
docker logs --since 24h mosquitto 2>&1 | grep "not authorised" | grep -v "\[::1" || echo "ninguno"

echo "== 6. Última lectura en Influx"
docker exec influxdb influx query 'from(bucket:"sensores") |> range(start:-2m) |> filter(fn:(r)=>r._field=="temperatura") |> last()' | tail -1

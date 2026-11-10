# Broker MQTT — autenticación por dispositivo (RF-14)

Desde el 2026-11-10 Mosquitto **no acepta conexiones anónimas**. Cada dispositivo tiene su
usuario y solo puede publicar o leer sus propios tópicos.

| Usuario | Dispositivo | Puede |
|---|---|---|
| `nodo1` | ESP32 de sensores (`ESP32-33124b00`, WiFi `Seneca`) | publicar `sensores/nodo1`, `sensores/nodo2`, `sensores/esp32/estado` |
| `bomba` | PLC Beckhoff/TwinCAT (`Untitled1-TcMqttClient1`) | publicar el estado de la bomba; leer `invernadero/temperatura` (extractor) |
| `nodered` | Node-RED del servidor | leer `sensores/#` e `invernadero/#` |
| `monitor` | Diagnóstico | leer todo |

Las contraseñas están en el gestor de contraseñas del equipo. **El archivo `passwd` nunca va a git.**
Los dispositivos tienen la IP del servidor escrita en su firmware: si cambia, hay que reflashearlos.

## Decisión de diseño: la ingesta es MQTT

RF-14 pide "ingesta autenticada por dispositivo, cada sensor/nodo con su propia credencial".
Se cumple en el broker MQTT (protocolo estándar de IoT) y no en una API HTTP, para no
reescribir el firmware ni los flujos de Node-RED. Cada dispositivo físico tiene una credencial
propia; el ESP32 lleva dos sensores (nodo1, nodo2) bajo la misma credencial porque la
credencial identifica al dispositivo.

## Archivos

- `mosquitto.conf`, `acl`: copias de referencia de `/mosquitto/config/` en el servidor.
- `verificar-mqtt.sh`: comprobación completa (anónimos rechazados, clientes autenticados, datos llegando).

Para editar en el servidor, la carpeta del host se obtiene con:

```bash
docker inspect mosquitto --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

## Agregar un dispositivo

```bash
openssl rand -base64 18 | tr -d '/+='            # contraseña (sin '$': TwinCAT lo usa como escape)
docker exec -it mosquitto mosquitto_passwd /mosquitto/config/passwd <usuario>   # SIN -c
sudo nano <carpeta-host>/acl                        # agregar "user <usuario>" y sus tópicos
docker exec mosquitto sh -c 'chown mosquitto:mosquitto /mosquitto/config/passwd /mosquitto/config/acl && chmod 0700 /mosquitto/config/passwd /mosquitto/config/acl'
docker kill -s HUP mosquitto                        # recarga sin desconectar a nadie
```

Luego configurar usuario y contraseña en el firmware y comprobar con
`docker logs --since 5m mosquitto 2>&1 | grep "New client connected"` que aparece con `u'<usuario>'`.

**Nunca usar `mosquitto_passwd -c`**: crea el archivo de cero y borra los demás usuarios.

## Revocar un dispositivo

```bash
docker exec -it mosquitto mosquitto_passwd -D /mosquitto/config/passwd <usuario>
docker kill -s HUP mosquitto
docker restart mosquitto     # corta la sesión que ya estaba abierta
```

## Firmware

- **ESP32:** credenciales en `secrets.h` (no se sube a git), `client.connect(id, MQTT_USER, MQTT_PASS, ...)`.
  Código de error en el monitor serie: `rc=4` contraseña incorrecta, `rc=-2` IP del broker incorrecta.
- **PLC:** `fbMqttClient.sUserName` / `sUserPassword` en el bloque de configuración. Cargar con descarga
  completa y **activar el boot project**, o el PLC arrancará con el programa viejo tras un corte de luz.

## Pendientes

- **TLS** (RNF-04): las contraseñas viajan sin cifrar; el ESP32 usa un WiFi abierto. Plan: listener 8883
  con TLS para los dispositivos y 1883 solo interno para Node-RED. Requiere antes IP fija o DNS del servidor.
- **Límites del broker** (RNF-04): `max_connections` y `message_size_limit`.
- **Puerto 9001** (WebSocket): nadie lo usa; candidato a eliminar.
- **`invernadero/temperatura`**: nadie lo publica; el extractor del PLC queda apagado por su watchdog.

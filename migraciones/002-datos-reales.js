// 002 — Alinear el catálogo con los datos reales del IoT (sin tocar el IoT).
//
// Qué hace:
//   1. Renombra la variable "humedad_relativa" a "humedad" (nombre real en MQTT e Influx).
//   2. Ajusta el rango válido de temperatura al filtro físico de Node-RED (−40 a 80 °C).
//   3. Registra el catálogo inicial: invernadero-1, el gateway Node-RED y el sensor nodo1,
//      enlazado a Influx (bucket "sensores", measurement "ambiente", tag nodo = "nodo1").
//   4. Sube la versión del esquema a 2.
//
// Es idempotente: se puede ejecutar más de una vez sin duplicar nada.
//
// Ejecutar como root, desde /opt/semillero con `source .env`:
//   docker cp migraciones/002-datos-reales.js semillero-mongo:/tmp/
//   docker exec semillero-mongo mongosh "mongodb://127.0.0.1:27017/admin" \
//     -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --quiet /tmp/002-datos-reales.js

const app = db.getSiblingDB("semillero");
const ahora = new Date();

// --- 1 y 2: variables -------------------------------------------------------
const vieja = app.variables.findOne({ _id: "humedad_relativa" });
if (vieja && !app.variables.findOne({ _id: "humedad" })) {
  app.variables.insertOne({ ...vieja, _id: "humedad", actualizado_en: ahora });
}
if (vieja) {
  app.variables.deleteOne({ _id: "humedad_relativa" });
  app.umbrales.updateMany({ variable: "humedad_relativa" }, { $set: { variable: "humedad", actualizado_en: ahora } });
  app.sensores.updateMany({ variables: "humedad_relativa" }, { $set: { "variables.$": "humedad", actualizado_en: ahora } });
}
app.variables.updateOne(
  { _id: "temperatura" },
  { $set: { rango_valido: { min: -40, max: 80 }, actualizado_en: ahora } }
);

// --- 3: catálogo inicial ----------------------------------------------------
const ts = { creado_en: ahora, actualizado_en: ahora };

app.invernaderos.updateOne(
  { codigo: "invernadero-1" },
  { $setOnInsert: { codigo: "invernadero-1", nombre: "Invernadero SEPHIA", activo: true, ...ts } },
  { upsert: true }
);
const inv = app.invernaderos.findOne({ codigo: "invernadero-1" })._id;

// El gateway queda INACTIVO: hoy no hay ingesta por la API (el tiempo real se lee de
// Influx para no modificar Node-RED). Cuando se autorice la ingesta (RF-14), se le
// genera una API key real y se activa.
app.dispositivos.updateOne(
  { codigo: "nodered-gw" },
  {
    $setOnInsert: {
      codigo: "nodered-gw",
      nombre: "Node-RED del servidor del semillero",
      tipo: "gateway",
      invernadero_id: inv,
      credencial: { prefijo: "pendiente", hash: "sin-credencial", creada_en: ahora, rotada_en: null },
      activo: false,
      ...ts,
    },
  },
  { upsert: true }
);
const gw = app.dispositivos.findOne({ codigo: "nodered-gw" })._id;

app.sensores.updateOne(
  { codigo: "nodo1" },
  {
    $setOnInsert: {
      codigo: "nodo1",
      nombre: "Nodo 1",
      invernadero_id: inv,
      dispositivo_id: gw,
      variables: ["temperatura", "humedad"],
      estado: "activo",
      intervalo_esperado_s: NumberInt(10),
      ultimo_reporte: null,
      influx: { bucket: "sensores", measurement: "ambiente", tags: { nodo: "nodo1" } },
      ...ts,
    },
  },
  { upsert: true }
);

// --- 4: versión -------------------------------------------------------------
app.getCollection("_meta").updateOne(
  { _id: "esquema" },
  { $set: { version: NumberInt(2), aplicado_en: ahora } }
);

print("Migración 002 aplicada:");
print("  variables: " + app.variables.find({}, { _id: 1 }).toArray().map((v) => v._id).join(", "));
print("  sensores:  " + app.sensores.find({}, { codigo: 1 }).toArray().map((s) => s.codigo).join(", "));
print("  esquema v" + app.getCollection("_meta").findOne({ _id: "esquema" }).version);

// 03 — Datos mínimos para arrancar.
//
// - Catálogo de variables (las dos que se miden hoy + pH, previsto en RF-13).
// - Documento único del sitio, vacío, con el dashboard en modo conservador (RF-18 pendiente).
// - Primer administrador: sin él nadie podría entrar al panel para autorizar a los demás.
// - Versión del esquema, para futuras migraciones.
//
// Invernaderos, dispositivos y sensores NO se siembran aquí: dependen de datos reales
// (códigos de Node-RED, API keys) y se crean desde la API o con un script aparte.

const app = db.getSiblingDB(process.env.APP_DB_NAME);
const ahora = new Date();
const ts = { creado_en: ahora, actualizado_en: ahora };

app.variables.insertMany([
  { _id: "temperatura", nombre: "Temperatura", unidad: "°C", decimales: NumberInt(1),
    rango_valido: { min: -10, max: 60 }, activo: true, ...ts },
  { _id: "humedad_relativa", nombre: "Humedad relativa", unidad: "%", decimales: NumberInt(1),
    rango_valido: { min: 0, max: 100 }, activo: true, ...ts },
  { _id: "ph", nombre: "pH", unidad: "pH", decimales: NumberInt(2),
    rango_valido: { min: 0, max: 14 }, activo: false, ...ts },   // se activa cuando haya sensor
]);

app.sitio.insertOne({
  _id: "principal",
  mision: "",
  vision: "",
  historia: "",
  redes_sociales: [],
  correos_notificacion: [],
  dashboard: { historico_publico: true, exportacion_publica: false },
  ...ts,
});

const email = (process.env.ADMIN_INICIAL_EMAIL || "").trim().toLowerCase();
if (email) {
  app.administradores.insertOne({
    email,
    nombre: (process.env.ADMIN_INICIAL_NOMBRE || email).trim(),
    activo: true,
    autorizado_por: null,
    ...ts,
  });
  print(`Administrador inicial: ${email}`);
} else {
  print("AVISO: ADMIN_INICIAL_EMAIL vacío; no hay administradores y nadie podrá entrar al panel.");
}

app.getCollection("_meta").insertOne({ _id: "esquema", version: NumberInt(1), aplicado_en: ahora });

print("Semillas cargadas.");

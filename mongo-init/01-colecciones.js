// 01 — Colecciones, validación de esquema e índices.
// Se ejecuta UNA vez, cuando /data/db está vacío. Ver docs/modelo-datos.md.
//
// Las lecturas de sensores NO viven aquí: están en InfluxDB (escritas por Node-RED).
// Mongo guarda el catálogo (invernaderos, sensores, variables), la configuración
// (umbrales), el estado derivado (alertas) y el contenido del sitio.

const app = db.getSiblingDB(process.env.APP_DB_NAME);

// ---------- tipos reutilizables ----------
const NUM = ["double", "int", "long", "decimal"];
const NUM_O_NULL = [...NUM, "null"];
const OID_O_NULL = ["objectId", "null"];
const FECHA_O_NULL = ["date", "null"];
const EMAIL = { bsonType: "string", pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", maxLength: 254 };
const EMAIL_UNIANDES = { bsonType: "string", pattern: "^[a-z0-9._%+-]+@uniandes\\.edu\\.co$" };
const CODIGO = { bsonType: "string", pattern: "^[a-z0-9]+(?:[-_][a-z0-9]+)*$", maxLength: 64 };
const URL_HTTPS = { bsonType: "string", pattern: "^https://" };
const TIMESTAMPS = { creado_en: { bsonType: "date" }, actualizado_en: { bsonType: "date" } };

function coleccion(nombre, schema, indices = []) {
  app.createCollection(nombre, {
    validator: {
      $jsonSchema: {
        bsonType: "object",
        ...schema,
        properties: { ...TIMESTAMPS, ...schema.properties },
      },
    },
    validationLevel: "strict",
    validationAction: "error",
  });
  indices.forEach(([keys, opts]) => app.getCollection(nombre).createIndex(keys, opts || {}));
  print(`  ✓ ${nombre}`);
}

print("Creando colecciones...");

// =====================================================================
// SITIO — documento único con la configuración institucional
// RF-01, RF-03, RNF-05, RF-18, RF-11/RF-17 (destinatarios de correo)
// =====================================================================
coleccion("sitio", {
  required: ["_id"],
  properties: {
    _id: { enum: ["principal"] },                 // fuerza que exista un solo documento
    mision: { bsonType: "string" },
    vision: { bsonType: "string" },
    historia: { bsonType: "string" },             // markdown
    redes_sociales: {
      bsonType: "array",
      items: {
        bsonType: "object",
        required: ["red", "url"],
        properties: {
          red: { enum: ["instagram", "facebook", "linkedin", "x", "youtube", "tiktok", "github", "web"] },
          url: URL_HTTPS,
        },
      },
    },
    correo_contacto: EMAIL,
    correos_notificacion: { bsonType: "array", items: EMAIL },  // reciben contacto y alertas
    politica_datos: {                                           // Ley 1581 de 2012
      bsonType: "object",
      required: ["version", "texto", "publicada_en"],
      properties: {
        version: { bsonType: "string" },
        texto: { bsonType: "string" },
        publicada_en: { bsonType: "date" },
      },
    },
    dashboard: {                                   // RF-18: decisión pendiente, configurable sin código
      bsonType: "object",
      properties: {
        historico_publico: { bsonType: "bool" },
        exportacion_publica: { bsonType: "bool" },
      },
    },
  },
});

// =====================================================================
// ADMINISTRADORES — RF-19, RF-21, RF-22
// =====================================================================
coleccion("administradores", {
  required: ["email", "nombre", "activo", "creado_en"],
  properties: {
    email: EMAIL_UNIANDES,                         // el dominio se valida también en la BD
    nombre: { bsonType: "string", minLength: 1 },
    entra_oid: { bsonType: "string" },             // id estable del usuario en Entra ID
    activo: { bsonType: "bool" },
    autorizado_por: { bsonType: OID_O_NULL },      // → administradores._id (null = semilla inicial)
    revocado_por: { bsonType: OID_O_NULL },
    revocado_en: { bsonType: FECHA_O_NULL },
    ultimo_acceso: { bsonType: FECHA_O_NULL },
  },
}, [
  [{ email: 1 }, { unique: true }],
  [{ entra_oid: 1 }, { unique: true, partialFilterExpression: { entra_oid: { $type: "string" } } }],
]);

// =====================================================================
// INVERNADEROS — RNF-02 (varios invernaderos sin rediseño)
// =====================================================================
coleccion("invernaderos", {
  required: ["codigo", "nombre", "activo"],
  properties: {
    codigo: CODIGO,                                // p. ej. "invernadero-1"
    nombre: { bsonType: "string", minLength: 1 },
    ubicacion: { bsonType: "string" },
    descripcion: { bsonType: "string" },
    activo: { bsonType: "bool" },
  },
}, [
  [{ codigo: 1 }, { unique: true }],
]);

// =====================================================================
// VARIABLES — catálogo abierto de magnitudes medibles (RF-13)
// _id = código estable, el mismo que usan Node-RED / MQTT / Influx
// =====================================================================
coleccion("variables", {
  required: ["_id", "nombre", "unidad", "activo"],
  properties: {
    _id: CODIGO,                                   // "temperatura", "humedad_relativa", "ph"...
    nombre: { bsonType: "string", minLength: 1 },
    unidad: { bsonType: "string" },
    decimales: { bsonType: "int", minimum: 0, maximum: 6 },
    rango_valido: {                                // lecturas fuera de rango se descartan en la ingesta
      bsonType: "object",
      required: ["min", "max"],
      properties: { min: { bsonType: NUM }, max: { bsonType: NUM } },
    },
    activo: { bsonType: "bool" },
  },
});

// =====================================================================
// DISPOSITIVOS — quien se autentica contra la API de ingesta (RF-14, RNF-04)
// Hoy: el gateway Node-RED. Mañana: cada nodo con su propia credencial.
// =====================================================================
coleccion("dispositivos", {
  required: ["codigo", "nombre", "tipo", "invernadero_id", "credencial", "activo"],
  properties: {
    codigo: CODIGO,
    nombre: { bsonType: "string" },
    tipo: { enum: ["gateway", "nodo"] },
    invernadero_id: { bsonType: "objectId" },      // → invernaderos._id
    credencial: {
      bsonType: "object",
      required: ["prefijo", "hash", "creada_en"],
      properties: {
        prefijo: { bsonType: "string", minLength: 6 },  // parte pública de la API key, para buscarla
        hash: { bsonType: "string" },                   // argon2/bcrypt del secreto; nunca en claro
        creada_en: { bsonType: "date" },
        rotada_en: { bsonType: FECHA_O_NULL },
      },
    },
    activo: { bsonType: "bool" },
    revocado_en: { bsonType: FECHA_O_NULL },
    ultimo_uso: { bsonType: FECHA_O_NULL },
  },
}, [
  [{ codigo: 1 }, { unique: true }],
  [{ "credencial.prefijo": 1 }, { unique: true }],
  [{ invernadero_id: 1 }],
]);

// =====================================================================
// SENSORES — catálogo físico; enlaza con las series en Influx
// RF-13, RF-27 (sensores sin reportar)
// =====================================================================
coleccion("sensores", {
  required: ["codigo", "nombre", "invernadero_id", "dispositivo_id", "variables", "estado"],
  properties: {
    codigo: CODIGO,                                // el id que llega por MQTT / Node-RED
    nombre: { bsonType: "string" },
    invernadero_id: { bsonType: "objectId" },      // → invernaderos._id
    dispositivo_id: { bsonType: "objectId" },      // → dispositivos._id (por dónde llegan sus datos)
    variables: { bsonType: "array", minItems: 1, items: { bsonType: "string" } }, // → variables._id
    ubicacion: { bsonType: "string" },
    estado: { enum: ["activo", "mantenimiento", "retirado"] },  // "retirado" = sus lecturas se ignoran
    intervalo_esperado_s: { bsonType: "int", minimum: 1 },      // base para detectar "sin reporte"
    ultimo_reporte: { bsonType: FECHA_O_NULL },
    influx: {                                      // cómo encontrar sus series en Influx
      bsonType: "object",
      required: ["bucket", "measurement"],
      properties: {
        bucket: { bsonType: "string" },
        measurement: { bsonType: "string" },
        tags: { bsonType: "object" },
      },
    },
  },
}, [
  [{ codigo: 1 }, { unique: true }],
  [{ invernadero_id: 1, estado: 1 }],
  [{ dispositivo_id: 1 }],
]);

// =====================================================================
// UMBRALES — mín/máx por variable (RF-17)
// sensor_id = null → aplica a todos los sensores del invernadero
// sensor_id = X    → excepción para ese sensor
// =====================================================================
coleccion("umbrales", {
  required: ["invernadero_id", "variable", "sensor_id", "activo"],
  anyOf: [
    { required: ["min"], properties: { min: { bsonType: NUM } } },
    { required: ["max"], properties: { max: { bsonType: NUM } } },
  ],
  properties: {
    invernadero_id: { bsonType: "objectId" },      // → invernaderos._id
    variable: { bsonType: "string" },              // → variables._id
    sensor_id: { bsonType: OID_O_NULL },           // → sensores._id | null
    min: { bsonType: NUM_O_NULL },
    max: { bsonType: NUM_O_NULL },
    notificar_correo: { bsonType: "bool" },
    activo: { bsonType: "bool" },
    actualizado_por: { bsonType: OID_O_NULL },     // → administradores._id
  },
}, [
  [{ invernadero_id: 1, variable: 1, sensor_id: 1 }, { unique: true }],
]);

// =====================================================================
// ALERTAS — historial de eventos; como máximo UNA activa por sensor/variable/tipo
// RF-17, RF-27
// =====================================================================
coleccion("alertas", {
  required: ["invernadero_id", "sensor_id", "tipo", "estado", "inicio"],
  properties: {
    invernadero_id: { bsonType: "objectId" },
    sensor_id: { bsonType: "objectId" },           // → sensores._id
    variable: { bsonType: ["string", "null"] },    // null en "sin_reporte"
    tipo: { enum: ["max", "min", "sin_reporte"] },
    estado: { enum: ["activa", "resuelta"] },
    umbral: {                                      // copia del umbral al disparar (si luego cambia, el histórico no miente)
      bsonType: "object",
      properties: { min: { bsonType: NUM_O_NULL }, max: { bsonType: NUM_O_NULL } },
    },
    valor_disparo: { bsonType: NUM_O_NULL },
    ultimo_valor: { bsonType: NUM_O_NULL },
    inicio: { bsonType: "date" },
    fin: { bsonType: FECHA_O_NULL },
    notificada: { bsonType: "bool" },
    reconocida_por: { bsonType: OID_O_NULL },      // → administradores._id
    reconocida_en: { bsonType: FECHA_O_NULL },
  },
}, [
  // evita duplicados: un correo al entrar, otro al salir, no uno por lectura
  [{ sensor_id: 1, variable: 1, tipo: 1 }, { unique: true, partialFilterExpression: { estado: "activa" } }],
  [{ estado: 1, inicio: -1 }],
  [{ invernadero_id: 1, inicio: -1 }],
]);

// =====================================================================
// MEDIOS — imágenes y multimedia; el archivo vive en disco (uploads/)
// RF-02 (galería), RF-05 (fotos), RF-07 (multimedia de proyectos), RF-25, RNF-06 (alt)
// =====================================================================
coleccion("medios", {
  required: ["archivo", "tipo_mime", "tamano_bytes", "alt", "categoria", "en_galeria", "creado_en"],
  properties: {
    archivo: { bsonType: "string" },               // ruta relativa dentro de uploads/
    nombre_original: { bsonType: "string" },
    tipo_mime: { bsonType: "string", pattern: "^(image/(jpeg|png|webp|avif|gif)|video/(mp4|webm)|application/pdf)$" },
    tamano_bytes: { bsonType: NUM, minimum: 1 },
    ancho: { bsonType: "int" },
    alto: { bsonType: "int" },
    alt: { bsonType: "string", minLength: 1 },     // texto alternativo obligatorio (accesibilidad)
    categoria: { enum: ["invernadero", "equipo", "eventos", "proyecto", "otro"] },
    en_galeria: { bsonType: "bool" },
    subido_por: { bsonType: OID_O_NULL },          // → administradores._id
  },
}, [
  [{ archivo: 1 }, { unique: true }],
  [{ en_galeria: 1, categoria: 1, creado_en: -1 }],
]);

// =====================================================================
// INTEGRANTES — equipo editable, con historial por rotación (RF-05, RF-06)
// Nunca se borran: se marcan activo=false y se cierra el periodo.
// =====================================================================
coleccion("integrantes", {
  required: ["nombre", "rol", "activo", "orden"],
  properties: {
    nombre: { bsonType: "string", minLength: 1 },
    rol: { bsonType: "string", minLength: 1 },
    bio: { bsonType: "string", maxLength: 600 },
    foto_id: { bsonType: OID_O_NULL },             // → medios._id
    linkedin: URL_HTTPS,
    correo: EMAIL,
    periodo: {
      bsonType: "object",
      properties: {
        desde: { bsonType: "string", pattern: "^\\d{4}-[12]$" },   // "2026-2"
        hasta: { bsonType: ["string", "null"], pattern: "^\\d{4}-[12]$" },
      },
    },
    activo: { bsonType: "bool" },
    orden: { bsonType: "int" },
  },
}, [
  [{ activo: 1, orden: 1 }],
]);

// =====================================================================
// PROYECTOS — RF-07, RF-08 (archivar), RF-09 (sub-página por slug)
// =====================================================================
coleccion("proyectos", {
  required: ["slug", "nombre", "estado", "archivado"],
  properties: {
    slug: CODIGO,                                  // URL: /proyectos/{slug}
    nombre: { bsonType: "string", minLength: 1 },
    resumen: { bsonType: "string", maxLength: 300 },
    descripcion: { bsonType: "string" },           // markdown
    estado: { enum: ["activo", "finalizado"] },
    archivado: { bsonType: "bool" },               // archivar ≠ finalizar: archivado se oculta del sitio
    portada_id: { bsonType: OID_O_NULL },          // → medios._id
    medios: { bsonType: "array", items: { bsonType: "objectId" } },       // → medios._id
    integrantes: { bsonType: "array", items: { bsonType: "objectId" } },  // → integrantes._id
    fecha_inicio: { bsonType: FECHA_O_NULL },
    fecha_fin: { bsonType: FECHA_O_NULL },
    cronograma: {
      bsonType: "array",
      items: {
        bsonType: "object",
        required: ["fecha", "titulo"],
        properties: {
          fecha: { bsonType: "date" },
          titulo: { bsonType: "string" },
          descripcion: { bsonType: "string" },
          completado: { bsonType: "bool" },
        },
      },
    },
    resultados: { bsonType: "string" },            // markdown
    orden: { bsonType: "int" },
  },
}, [
  [{ slug: 1 }, { unique: true }],
  [{ archivado: 1, estado: 1, orden: 1 }],
  [{ integrantes: 1 }],
]);

// =====================================================================
// MENSAJES — formulario de contacto (RF-10, RF-11, RF-12, RF-26, RNF-05)
// =====================================================================
coleccion("mensajes", {
  required: ["nombre", "correo", "mensaje", "estado", "consentimiento", "creado_en"],
  properties: {
    nombre: { bsonType: "string", minLength: 1, maxLength: 120 },
    correo: EMAIL,
    mensaje: { bsonType: "string", minLength: 1, maxLength: 5000 },
    estado: { enum: ["nuevo", "leido", "archivado"] },
    consentimiento: {                              // prueba de autorización (Ley 1581)
      bsonType: "object",
      required: ["acepto", "version_politica", "fecha"],
      properties: {
        acepto: { enum: [true] },
        version_politica: { bsonType: "string" },  // → sitio.politica_datos.version vigente
        fecha: { bsonType: "date" },
      },
    },
    notificado: { bsonType: "bool" },
    ip_hash: { bsonType: "string" },               // hash, nunca la IP en claro
  },
}, [
  [{ estado: 1, creado_en: -1 }],
]);

// =====================================================================
// AUDITORÍA — quién cambió qué y cuándo (RF-23)
// La app solo puede insertar y leer; no puede editar ni borrar (ver 02).
// =====================================================================
coleccion("auditoria", {
  required: ["ts", "actor", "accion", "coleccion"],
  properties: {
    ts: { bsonType: "date" },
    actor: {
      bsonType: "object",
      required: ["email"],
      properties: {
        admin_id: { bsonType: OID_O_NULL },        // → administradores._id (null = sistema)
        email: { bsonType: "string" },
      },
    },
    accion: { enum: ["crear", "editar", "archivar", "restaurar", "eliminar", "login", "autorizar", "revocar", "exportar"] },
    coleccion: { bsonType: "string" },
    documento_id: {},                              // ObjectId o string según la colección
    cambios: { bsonType: "object" },               // { campo: { antes, despues } }
  },
}, [
  [{ ts: -1 }],
  [{ coleccion: 1, documento_id: 1, ts: -1 }],
  [{ "actor.admin_id": 1, ts: -1 }],
]);

print("Colecciones listas.");

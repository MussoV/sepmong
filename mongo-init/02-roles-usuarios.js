// 02 — Rol de la aplicación con mínimo privilegio y su usuario.
//
// - CRUD sobre todas las colecciones de negocio.
// - Auditoría: solo find + insert (la app no puede reescribir la historia).
// - Sin createIndex, dropCollection ni collMod: el esquema lo gobiernan los scripts, no la app.
//
// OJO: si se crea una colección nueva más adelante, hay que agregarla al rol:
//   db.grantPrivilegesToRole("semilleroApp", [{ resource: { db: "semillero", collection: "nueva" },
//                                               actions: ["find", "insert", "update", "remove"] }])

const dbName = process.env.APP_DB_NAME;
const app = db.getSiblingDB(dbName);

const SOLO_INSERCION = ["auditoria"];
const EXCLUIDAS = ["_meta"];

const privilegios = app.getCollectionNames()
  .filter((c) => !c.startsWith("system.") && !EXCLUIDAS.includes(c) && !SOLO_INSERCION.includes(c))
  .map((c) => ({ resource: { db: dbName, collection: c }, actions: ["find", "insert", "update", "remove"] }));

SOLO_INSERCION.forEach((c) =>
  privilegios.push({ resource: { db: dbName, collection: c }, actions: ["find", "insert"] })
);

app.createRole({ role: "semilleroApp", privileges: privilegios, roles: [] });

app.createUser({
  user: process.env.APP_DB_USER,
  pwd: process.env.APP_DB_PASSWORD,
  roles: [{ role: "semilleroApp", db: dbName }],
});

print(`Rol 'semilleroApp' (${privilegios.length} colecciones) y usuario '${process.env.APP_DB_USER}' creados.`);

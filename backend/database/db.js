const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ── Ruta de la base de datos ──────────────────────────────────
const DB_DIR  = path.join(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'fletenet.db');

// Crear carpeta /data si no existe
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// ── Optimizaciones SQLite ─────────────────────────────────────
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ══════════════════════════════════════════════════════════════
//  CREACIÓN DE TABLAS
// ══════════════════════════════════════════════════════════════
db.exec(`

  -- USUARIOS del sistema
  CREATE TABLE IF NOT EXISTS usuarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT    NOT NULL,
    email       TEXT    UNIQUE NOT NULL,
    password    TEXT    NOT NULL,
    rol         TEXT    NOT NULL DEFAULT 'operador',  -- admin | operador | chofer
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- CHOFERES
  CREATE TABLE IF NOT EXISTS choferes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT    NOT NULL,
    dni         TEXT    UNIQUE NOT NULL,
    telefono    TEXT,
    licencia    TEXT,
    vencimiento_licencia TEXT,
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- VEHÍCULOS
  CREATE TABLE IF NOT EXISTS vehiculos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    patente     TEXT    UNIQUE NOT NULL,
    marca       TEXT,
    modelo      TEXT,
    anio        INTEGER,
    tipo        TEXT,   -- camion | semi | utilitario
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- CLIENTES
  CREATE TABLE IF NOT EXISTS clientes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    razon_social TEXT   NOT NULL,
    cuit        TEXT,
    telefono    TEXT,
    email       TEXT,
    direccion   TEXT,
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- PROVEEDORES
  CREATE TABLE IF NOT EXISTS proveedores (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    razon_social TEXT   NOT NULL,
    cuit        TEXT,
    telefono    TEXT,
    email       TEXT,
    rubro       TEXT,
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- PRODUCTOS
  CREATE TABLE IF NOT EXISTS productos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT    NOT NULL,
    unidad      TEXT    NOT NULL DEFAULT 'kg',
    descripcion TEXT,
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- VIAJES
  CREATE TABLE IF NOT EXISTS viajes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    numero          TEXT    UNIQUE NOT NULL,
    fecha           TEXT    NOT NULL,
    chofer_id       INTEGER REFERENCES choferes(id),
    vehiculo_id     INTEGER REFERENCES vehiculos(id),
    cliente_id      INTEGER REFERENCES clientes(id),
    producto_id     INTEGER REFERENCES productos(id),
    origen          TEXT,
    destino         TEXT,
    km_estimados    REAL,
    km_reales       REAL,
    peso_carga      REAL,
    tarifa          REAL,
    importe_flete   REAL,
    estado          TEXT    NOT NULL DEFAULT 'pendiente', -- pendiente | en_curso | completado | cancelado
    observaciones   TEXT,
    creado_en       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- GASTOS
  CREATE TABLE IF NOT EXISTS gastos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    viaje_id    INTEGER REFERENCES viajes(id),
    chofer_id   INTEGER REFERENCES choferes(id),
    fecha       TEXT    NOT NULL,
    categoria   TEXT    NOT NULL,  -- combustible | peaje | comida | alojamiento | reparacion | otro
    descripcion TEXT,
    importe     REAL    NOT NULL,
    comprobante TEXT,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- COMBUSTIBLE
  CREATE TABLE IF NOT EXISTS combustible (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    viaje_id    INTEGER REFERENCES viajes(id),
    vehiculo_id INTEGER REFERENCES vehiculos(id),
    fecha       TEXT    NOT NULL,
    litros      REAL    NOT NULL,
    precio_litro REAL   NOT NULL,
    total       REAL    NOT NULL,
    estacion    TEXT,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- ANTICIPOS a choferes
  CREATE TABLE IF NOT EXISTS anticipos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chofer_id   INTEGER NOT NULL REFERENCES choferes(id),
    viaje_id    INTEGER REFERENCES viajes(id),
    fecha       TEXT    NOT NULL,
    importe     REAL    NOT NULL,
    descripcion TEXT,
    liquidado   INTEGER NOT NULL DEFAULT 0,
    creado_en   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- LIQUIDACIONES
  CREATE TABLE IF NOT EXISTS liquidaciones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    numero          TEXT    UNIQUE NOT NULL,
    chofer_id       INTEGER NOT NULL REFERENCES choferes(id),
    fecha_desde     TEXT    NOT NULL,
    fecha_hasta     TEXT    NOT NULL,
    total_fletes    REAL    NOT NULL DEFAULT 0,
    porcentaje      REAL    NOT NULL DEFAULT 0,
    importe_bruto   REAL    NOT NULL DEFAULT 0,
    total_anticipos REAL    NOT NULL DEFAULT 0,
    total_gastos    REAL    NOT NULL DEFAULT 0,
    importe_neto    REAL    NOT NULL DEFAULT 0,
    estado          TEXT    NOT NULL DEFAULT 'borrador', -- borrador | confirmada | pagada
    observaciones   TEXT,
    creado_en       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- DETALLE de liquidaciones (viajes incluidos)
  CREATE TABLE IF NOT EXISTS liquidacion_viajes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    liquidacion_id  INTEGER NOT NULL REFERENCES liquidaciones(id),
    viaje_id        INTEGER NOT NULL REFERENCES viajes(id)
  );

  -- STOCK
  CREATE TABLE IF NOT EXISTS stock (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id     INTEGER NOT NULL REFERENCES productos(id),
    proveedor_id    INTEGER REFERENCES proveedores(id),
    fecha           TEXT    NOT NULL,
    tipo            TEXT    NOT NULL,  -- entrada | salida
    cantidad        REAL    NOT NULL,
    precio_unitario REAL,
    total           REAL,
    referencia      TEXT,
    creado_en       TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

`);

// ── Usuario admin por defecto ─────────────────────────────────
const bcrypt = require('bcryptjs');

const adminExiste = db.prepare(
  `SELECT id FROM usuarios WHERE email = ?`
).get('admin@fletenet.com');

if (!adminExiste) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT INTO usuarios (nombre, email, password, rol)
    VALUES (?, ?, ?, ?)
  `).run('Administrador', 'admin@fletenet.com', hash, 'admin');
  console.log('✅ Usuario admin creado: admin@fletenet.com / admin123');
}

console.log('✅ Base de datos lista:', DB_PATH);

module.exports = db;

const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

// ── GET /api/stock ────────────────────────────────────────────
router.get('/', (req, res) => {
  const { producto_id, proveedor_id, tipo, desde, hasta, buscar } = req.query;

  let query = `
    SELECT s.*,
           p.nombre        AS producto_nombre,
           p.unidad        AS producto_unidad,
           pv.razon_social AS proveedor_nombre
    FROM stock s
    LEFT JOIN productos   p  ON p.id  = s.producto_id
    LEFT JOIN proveedores pv ON pv.id = s.proveedor_id
    WHERE 1=1
  `;
  const params = [];

  if (producto_id)  { query += ` AND s.producto_id = ?`;  params.push(producto_id); }
  if (proveedor_id) { query += ` AND s.proveedor_id = ?`; params.push(proveedor_id); }
  if (tipo)         { query += ` AND s.tipo = ?`;          params.push(tipo); }
  if (desde)        { query += ` AND s.fecha >= ?`;        params.push(desde); }
  if (hasta)        { query += ` AND s.fecha <= ?`;        params.push(hasta); }

  if (buscar) {
    query += ` AND (p.nombre LIKE ? OR pv.razon_social LIKE ? OR s.referencia LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b, b);
  }

  query += ` ORDER BY s.fecha DESC, s.id DESC`;

  const movimientos = db.prepare(query).all(...params);
  res.json({ ok: true, data: movimientos });
});

// ── GET /api/stock/actual ─────────────────────────────────────
// Stock disponible por producto (entradas - salidas)
router.get('/actual', (req, res) => {
  const { buscar } = req.query;

  let query = `
    SELECT p.id,
           p.nombre,
           p.unidad,
           p.activo,
           COALESCE(SUM(CASE WHEN s.tipo = 'entrada' THEN s.cantidad ELSE 0 END), 0) AS entradas,
           COALESCE(SUM(CASE WHEN s.tipo = 'salida'  THEN s.cantidad ELSE 0 END), 0) AS salidas,
           COALESCE(SUM(CASE WHEN s.tipo = 'entrada' THEN s.cantidad ELSE 0 END), 0) -
           COALESCE(SUM(CASE WHEN s.tipo = 'salida'  THEN s.cantidad ELSE 0 END), 0) AS disponible,
           COALESCE(
             SUM(CASE WHEN s.tipo = 'entrada' THEN s.total ELSE 0 END) /
             NULLIF(SUM(CASE WHEN s.tipo = 'entrada' THEN s.cantidad ELSE 0 END), 0),
             0
           ) AS precio_promedio
    FROM productos p
    LEFT JOIN stock s ON s.producto_id = p.id
    WHERE p.activo = 1
  `;
  const params = [];

  if (buscar) {
    query += ` AND p.nombre LIKE ?`;
    params.push(`%${buscar}%`);
  }

  query += ` GROUP BY p.id ORDER BY p.nombre ASC`;

  const stockActual = db.prepare(query).all(...params);
  res.json({ ok: true, data: stockActual });
});

// ── GET /api/stock/resumen ────────────────────────────────────
router.get('/resumen', (req, res) => {
  const { desde, hasta } = req.query;

  let where = `WHERE 1=1`;
  const params = [];

  if (desde) { where += ` AND s.fecha >= ?`; params.push(desde); }
  if (hasta) { where += ` AND s.fecha <= ?`; params.push(hasta); }

  const porProducto = db.prepare(`
    SELECT p.nombre,
           p.unidad,
           COALESCE(SUM(CASE WHEN s.tipo = 'entrada' THEN s.cantidad ELSE 0 END), 0) AS entradas,
           COALESCE(SUM(CASE WHEN s.tipo = 'salida'  THEN s.cantidad ELSE 0 END), 0) AS salidas,
           COALESCE(SUM(CASE WHEN s.tipo = 'entrada' THEN s.total    ELSE 0 END), 0) AS valor_entradas,
           COALESCE(SUM(CASE WHEN s.tipo = 'salida'  THEN s.total    ELSE 0 END), 0) AS valor_salidas
    FROM stock s
    JOIN productos p ON p.id = s.producto_id
    ${where}
    GROUP BY p.id
    ORDER BY entradas DESC
  `).all(...params);

  const totalGeneral = db.prepare(`
    SELECT
      COUNT(*)                                                              AS operaciones,
      COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN total ELSE 0 END), 0)   AS valor_entradas,
      COALESCE(SUM(CASE WHEN tipo = 'salida'  THEN total ELSE 0 END), 0)   AS valor_salidas
    FROM stock s
    ${where.replace(/s\./g, '')}
  `).get(...params);

  res.json({ ok: true, data: porProducto, total: totalGeneral });
});

// ── GET /api/stock/:id ────────────────────────────────────────
router.get('/:id', (req, res) => {
  const movimiento = db.prepare(`
    SELECT s.*,
           p.nombre        AS producto_nombre,
           p.unidad        AS producto_unidad,
           pv.razon_social AS proveedor_nombre
    FROM stock s
    LEFT JOIN productos   p  ON p.id  = s.producto_id
    LEFT JOIN proveedores pv ON pv.id = s.proveedor_id
    WHERE s.id = ?
  `).get(req.params.id);

  if (!movimiento) return res.status(404).json({ error: 'Movimiento de stock no encontrado' });

  res.json({ ok: true, data: movimiento });
});

// ── POST /api/stock ───────────────────────────────────────────
router.post('/', requierePermiso('stock', 'crear'), (req, res) => {
  const {
    producto_id, proveedor_id, fecha,
    tipo, cantidad, precio_unitario, referencia
  } = req.body;

  if (!producto_id || !fecha || !tipo || !cantidad) {
    return res.status(400).json({
      error: 'Producto, fecha, tipo y cantidad son requeridos'
    });
  }

  if (!['entrada', 'salida'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido. Opciones: entrada, salida' });
  }

  if (isNaN(cantidad) || Number(cantidad) <= 0) {
    return res.status(400).json({ error: 'La cantidad debe ser un número mayor a 0' });
  }

  // Verificar que el producto existe
  const producto = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(producto_id);
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

  // Si es salida verificar stock suficiente
  if (tipo === 'salida') {
    const stockActual = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN cantidad ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN tipo = 'salida'  THEN cantidad ELSE 0 END), 0) AS disponible
      FROM stock WHERE producto_id = ?
    `).get(producto_id);

    if (stockActual.disponible < Number(cantidad)) {
      return res.status(409).json({
        error: `Stock insuficiente. Disponible: ${stockActual.disponible} ${producto.unidad}`
      });
    }
  }

  const total = precio_unitario
    ? Number((Number(cantidad) * Number(precio_unitario)).toFixed(2))
    : null;

  const result = db.prepare(`
    INSERT INTO stock (
      producto_id, proveedor_id, fecha,
      tipo, cantidad, precio_unitario, total, referencia
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    producto_id,
    proveedor_id    || null,
    fecha,
    tipo,
    Number(cantidad),
    precio_unitario ? Number(precio_unitario) : null,
    total,
    referencia      || null
  );

  const nuevo = db.prepare(`
    SELECT s.*,
           p.nombre        AS producto_nombre,
           p.unidad        AS producto_unidad,
           pv.razon_social AS proveedor_nombre
    FROM stock s
    LEFT JOIN productos   p  ON p.id  = s.producto_id
    LEFT JOIN proveedores pv ON pv.id = s.proveedor_id
    WHERE s.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/stock/:id ────────────────────────────────────────
router.put('/:id', requierePermiso('stock', 'editar'), (req, res) => {
  const movimiento = db.prepare(`SELECT * FROM stock WHERE id = ?`).get(req.params.id);
  if (!movimiento) return res.status(404).json({ error: 'Movimiento no encontrado' });

  const {
    producto_id, proveedor_id, fecha,
    tipo, cantidad, precio_unitario, referencia
  } = req.body;

  if (tipo && !['entrada', 'salida'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido. Opciones: entrada, salida' });
  }

  const nuevaCantidad    = cantidad       ? Number(cantidad)       : movimiento.cantidad;
  const nuevoPrecio      = precio_unitario? Number(precio_unitario): movimiento.precio_unitario;
  const nuevoTotal       = nuevoPrecio
    ? Number((nuevaCantidad * nuevoPrecio).toFixed(2))
    : null;

  db.prepare(`
    UPDATE stock SET
      producto_id     = COALESCE(?, producto_id),
      proveedor_id    = COALESCE(?, proveedor_id),
      fecha           = COALESCE(?, fecha),
      tipo            = COALESCE(?, tipo),
      cantidad        = ?,
      precio_unitario = ?,
      total           = ?,
      referencia      = COALESCE(?, referencia)
    WHERE id = ?
  `).run(
    producto_id  || null,
    proveedor_id || null,
    fecha        || null,
    tipo         || null,
    nuevaCantidad,
    nuevoPrecio  || null,
    nuevoTotal,
    referencia   || null,
    req.params.id
  );

  const actualizado = db.prepare(`
    SELECT s.*,
           p.nombre        AS producto_nombre,
           p.unidad        AS producto_unidad,
           pv.razon_social AS proveedor_nombre
    FROM stock s
    LEFT JOIN productos   p  ON p.id  = s.producto_id
    LEFT JOIN proveedores pv ON pv.id = s.proveedor_id
    WHERE s.id = ?
  `).get(req.params.id);

  res.json({ ok: true, data: actualizado });
});

// ── DELETE /api/stock/:id ─────────────────────────────────────
router.delete('/:id', requierePermiso('stock', 'eliminar'), (req, res) => {
  const movimiento = db.prepare(`SELECT * FROM stock WHERE id = ?`).get(req.params.id);
  if (!movimiento) return res.status(404).json({ error: 'Movimiento no encontrado' });

  db.prepare(`DELETE FROM stock WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Movimiento de stock eliminado correctamente' });
});

module.exports = router;

const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

// ── GET /api/productos ────────────────────────────────────────
router.get('/', (req, res) => {
  const { activo, buscar } = req.query;

  let query = `SELECT * FROM productos WHERE 1=1`;
  const params = [];

  if (activo !== undefined) {
    query += ` AND activo = ?`;
    params.push(activo === 'true' ? 1 : 0);
  }

  if (buscar) {
    query += ` AND (nombre LIKE ? OR descripcion LIKE ? OR unidad LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b, b);
  }

  query += ` ORDER BY nombre ASC`;

  const productos = db.prepare(query).all(...params);
  res.json({ ok: true, data: productos });
});

// ── GET /api/productos/:id ────────────────────────────────────
router.get('/:id', (req, res) => {
  const producto = db.prepare(
    `SELECT * FROM productos WHERE id = ?`
  ).get(req.params.id);

  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

  res.json({ ok: true, data: producto });
});

// ── GET /api/productos/:id/stock ──────────────────────────────
router.get('/:id/stock', (req, res) => {
  const { desde, hasta } = req.query;

  let query = `
    SELECT s.*,
           pv.razon_social AS proveedor_nombre
    FROM stock s
    LEFT JOIN proveedores pv ON pv.id = s.proveedor_id
    WHERE s.producto_id = ?
  `;
  const params = [req.params.id];

  if (desde) { query += ` AND s.fecha >= ?`; params.push(desde); }
  if (hasta) { query += ` AND s.fecha <= ?`; params.push(hasta); }

  query += ` ORDER BY s.fecha DESC`;

  const movimientos = db.prepare(query).all(...params);

  // Calcular stock actual
  const stockActual = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN cantidad ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo = 'salida'  THEN cantidad ELSE 0 END), 0) AS salidas
    FROM stock WHERE producto_id = ?
  `).get(req.params.id);

  const disponible = stockActual.entradas - stockActual.salidas;

  res.json({
    ok: true,
    data: movimientos,
    resumen: {
      entradas:   stockActual.entradas,
      salidas:    stockActual.salidas,
      disponible
    }
  });
});

// ── GET /api/productos/:id/viajes ─────────────────────────────
router.get('/:id/viajes', (req, res) => {
  const { desde, hasta } = req.query;

  let query = `
    SELECT v.*,
           ch.nombre      AS chofer_nombre,
           c.razon_social AS cliente_nombre,
           ve.patente     AS vehiculo_patente
    FROM viajes v
    LEFT JOIN choferes  ch ON ch.id = v.chofer_id
    LEFT JOIN clientes   c ON c.id  = v.cliente_id
    LEFT JOIN vehiculos ve ON ve.id = v.vehiculo_id
    WHERE v.producto_id = ?
  `;
  const params = [req.params.id];

  if (desde) { query += ` AND v.fecha >= ?`; params.push(desde); }
  if (hasta) { query += ` AND v.fecha <= ?`; params.push(hasta); }

  query += ` ORDER BY v.fecha DESC`;

  const viajes = db.prepare(query).all(...params);
  res.json({ ok: true, data: viajes });
});

// ── GET /api/productos/:id/resumen ────────────────────────────
router.get('/:id/resumen', (req, res) => {
  const id = req.params.id;

  const producto = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(id);
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

  const stockActual = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN cantidad ELSE 0 END), 0) AS entradas,
      COALESCE(SUM(CASE WHEN tipo = 'salida'  THEN cantidad ELSE 0 END), 0) AS salidas
    FROM stock WHERE producto_id = ?
  `).get(id);

  const totalViajes = db.prepare(`
    SELECT COUNT(*) as total,
           COALESCE(SUM(peso_carga), 0) as peso_total
    FROM viajes
    WHERE producto_id = ? AND estado = 'completado'
  `).get(id);

  res.json({
    ok: true,
    data: {
      producto,
      stock_disponible: stockActual.entradas - stockActual.salidas,
      stock_entradas:   stockActual.entradas,
      stock_salidas:    stockActual.salidas,
      viajes_completados: totalViajes.total,
      peso_total_transportado: totalViajes.peso_total
    }
  });
});

// ── GET /api/productos/unidades/lista ─────────────────────────
router.get('/unidades/lista', (req, res) => {
  const unidades = ['kg', 'tn', 'lt', 'm3', 'unidad', 'bolsa', 'pallet', 'otro'];
  res.json({ ok: true, data: unidades });
});

// ── POST /api/productos ───────────────────────────────────────
router.post('/', requierePermiso('productos', 'crear'), (req, res) => {
  const { nombre, unidad, descripcion } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del producto es requerido' });
  }

  const existe = db.prepare(
    `SELECT id FROM productos WHERE nombre = ?`
  ).get(nombre.trim());

  if (existe) {
    return res.status(409).json({ error: `Ya existe un producto llamado "${nombre}"` });
  }

  const result = db.prepare(`
    INSERT INTO productos (nombre, unidad, descripcion)
    VALUES (?, ?, ?)
  `).run(
    nombre.trim(),
    unidad      || 'kg',
    descripcion || null
  );

  const nuevo = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/productos/:id ────────────────────────────────────
router.put('/:id', requierePermiso('productos', 'editar'), (req, res) => {
  const { nombre, unidad, descripcion, activo } = req.body;

  const producto = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(req.params.id);
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

  if (nombre && nombre.trim() !== producto.nombre) {
    const existe = db.prepare(
      `SELECT id FROM productos WHERE nombre = ? AND id != ?`
    ).get(nombre.trim(), req.params.id);
    if (existe) {
      return res.status(409).json({ error: `Ya existe otro producto llamado "${nombre}"` });
    }
  }

  db.prepare(`
    UPDATE productos SET
      nombre      = COALESCE(?, nombre),
      unidad      = COALESCE(?, unidad),
      descripcion = COALESCE(?, descripcion),
      activo      = COALESCE(?, activo)
    WHERE id = ?
  `).run(
    nombre ? nombre.trim() : null,
    unidad, descripcion,
    activo !== undefined ? (activo ? 1 : 0) : null,
    req.params.id
  );

  const actualizado = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, data: actualizado });
});

// ── DELETE /api/productos/:id ─────────────────────────────────
router.delete('/:id', requierePermiso('productos', 'eliminar'), (req, res) => {
  const producto = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(req.params.id);
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

  const tieneViajes = db.prepare(
    `SELECT COUNT(*) as total FROM viajes WHERE producto_id = ?`
  ).get(req.params.id);

  const tieneStock = db.prepare(
    `SELECT COUNT(*) as total FROM stock WHERE producto_id = ?`
  ).get(req.params.id);

  if (tieneViajes.total > 0 || tieneStock.total > 0) {
    db.prepare(`UPDATE productos SET activo = 0 WHERE id = ?`).run(req.params.id);
    return res.json({ ok: true, mensaje: 'Producto desactivado (tiene registros asociados)' });
  }

  db.prepare(`DELETE FROM productos WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Producto eliminado correctamente' });
});

module.exports = router;

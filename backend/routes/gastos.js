const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

const CATEGORIAS = ['combustible', 'peaje', 'comida', 'alojamiento', 'reparacion', 'otro'];

// ── GET /api/gastos ───────────────────────────────────────────
router.get('/', (req, res) => {
  const { viaje_id, chofer_id, categoria, desde, hasta, buscar } = req.query;

  let query = `
    SELECT g.*,
           ch.nombre  AS chofer_nombre,
           v.numero   AS viaje_numero
    FROM gastos g
    LEFT JOIN choferes ch ON ch.id = g.chofer_id
    LEFT JOIN viajes    v ON v.id  = g.viaje_id
    WHERE 1=1
  `;
  const params = [];

  // Chofer solo ve sus gastos
  if (req.usuario.rol === 'chofer') {
    query += ` AND g.chofer_id = ?`;
    params.push(req.usuario.id);
  }

  if (viaje_id)  { query += ` AND g.viaje_id = ?`;   params.push(viaje_id); }
  if (chofer_id) { query += ` AND g.chofer_id = ?`;  params.push(chofer_id); }
  if (categoria) { query += ` AND g.categoria = ?`;  params.push(categoria); }
  if (desde)     { query += ` AND g.fecha >= ?`;      params.push(desde); }
  if (hasta)     { query += ` AND g.fecha <= ?`;      params.push(hasta); }

  if (buscar) {
    query += ` AND (g.descripcion LIKE ? OR g.categoria LIKE ? OR ch.nombre LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b, b);
  }

  query += ` ORDER BY g.fecha DESC, g.id DESC`;

  const gastos = db.prepare(query).all(...params);

  // Totales por categoría
  const totales = db.prepare(`
    SELECT categoria,
           COUNT(*)          AS cantidad,
           SUM(importe)      AS total
    FROM gastos
    WHERE 1=1
    ${req.usuario.rol === 'chofer' ? 'AND chofer_id = ' + req.usuario.id : ''}
    GROUP BY categoria
    ORDER BY total DESC
  `).all();

  res.json({ ok: true, data: gastos, totales });
});

// ── GET /api/gastos/:id ───────────────────────────────────────
router.get('/:id', (req, res) => {
  const gasto = db.prepare(`
    SELECT g.*,
           ch.nombre  AS chofer_nombre,
           v.numero   AS viaje_numero,
           v.origen   AS viaje_origen,
           v.destino  AS viaje_destino
    FROM gastos g
    LEFT JOIN choferes ch ON ch.id = g.chofer_id
    LEFT JOIN viajes    v ON v.id  = g.viaje_id
    WHERE g.id = ?
  `).get(req.params.id);

  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

  // Chofer solo puede ver sus propios gastos
  if (req.usuario.rol === 'chofer' && gasto.chofer_id !== req.usuario.id) {
    return res.status(403).json({ error: 'Sin acceso a este gasto' });
  }

  res.json({ ok: true, data: gasto });
});

// ── GET /api/gastos/resumen/por-periodo ───────────────────────
router.get('/resumen/por-periodo', (req, res) => {
  const { desde, hasta, chofer_id } = req.query;

  let whereClause = `WHERE 1=1`;
  const params = [];

  if (req.usuario.rol === 'chofer') {
    whereClause += ` AND chofer_id = ?`;
    params.push(req.usuario.id);
  } else if (chofer_id) {
    whereClause += ` AND chofer_id = ?`;
    params.push(chofer_id);
  }

  if (desde) { whereClause += ` AND fecha >= ?`; params.push(desde); }
  if (hasta) { whereClause += ` AND fecha <= ?`; params.push(hasta); }

  const resumen = db.prepare(`
    SELECT categoria,
           COUNT(*)     AS cantidad,
           SUM(importe) AS total
    FROM gastos
    ${whereClause}
    GROUP BY categoria
    ORDER BY total DESC
  `).all(...params);

  const totalGeneral = db.prepare(`
    SELECT COUNT(*) AS cantidad, COALESCE(SUM(importe),0) AS total
    FROM gastos ${whereClause}
  `).get(...params);

  res.json({ ok: true, data: resumen, total: totalGeneral });
});

// ── POST /api/gastos ──────────────────────────────────────────
router.post('/', requierePermiso('gastos', 'crear'), (req, res) => {
  const { viaje_id, chofer_id, fecha, categoria, descripcion, importe, comprobante } = req.body;

  if (!fecha || !categoria || !importe) {
    return res.status(400).json({ error: 'Fecha, categoría e importe son requeridos' });
  }

  if (!CATEGORIAS.includes(categoria)) {
    return res.status(400).json({
      error: `Categoría inválida. Opciones: ${CATEGORIAS.join(', ')}`
    });
  }

  if (isNaN(importe) || Number(importe) <= 0) {
    return res.status(400).json({ error: 'El importe debe ser un número mayor a 0' });
  }

  // Si es chofer, solo puede cargar gastos propios
  const choferId = req.usuario.rol === 'chofer' ? req.usuario.id : (chofer_id || null);

  // Verificar que el viaje existe si se envía viaje_id
  if (viaje_id) {
    const viaje = db.prepare(`SELECT id FROM viajes WHERE id = ?`).get(viaje_id);
    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });
  }

  const result = db.prepare(`
    INSERT INTO gastos (viaje_id, chofer_id, fecha, categoria, descripcion, importe, comprobante)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    viaje_id    || null,
    choferId,
    fecha,
    categoria,
    descripcion || null,
    Number(importe),
    comprobante || null
  );

  const nuevo = db.prepare(`
    SELECT g.*, ch.nombre AS chofer_nombre, v.numero AS viaje_numero
    FROM gastos g
    LEFT JOIN choferes ch ON ch.id = g.chofer_id
    LEFT JOIN viajes    v ON v.id  = g.viaje_id
    WHERE g.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/gastos/:id ───────────────────────────────────────
router.put('/:id', requierePermiso('gastos', 'editar'), (req, res) => {
  const gasto = db.prepare(`SELECT * FROM gastos WHERE id = ?`).get(req.params.id);
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

  // Chofer solo puede editar sus propios gastos
  if (req.usuario.rol === 'chofer' && gasto.chofer_id !== req.usuario.id) {
    return res.status(403).json({ error: 'Sin acceso a este gasto' });
  }

  const { viaje_id, chofer_id, fecha, categoria, descripcion, importe, comprobante } = req.body;

  if (categoria && !CATEGORIAS.includes(categoria)) {
    return res.status(400).json({
      error: `Categoría inválida. Opciones: ${CATEGORIAS.join(', ')}`
    });
  }

  if (importe && (isNaN(importe) || Number(importe) <= 0)) {
    return res.status(400).json({ error: 'El importe debe ser un número mayor a 0' });
  }

  db.prepare(`
    UPDATE gastos SET
      viaje_id    = COALESCE(?, viaje_id),
      chofer_id   = COALESCE(?, chofer_id),
      fecha       = COALESCE(?, fecha),
      categoria   = COALESCE(?, categoria),
      descripcion = COALESCE(?, descripcion),
      importe     = COALESCE(?, importe),
      comprobante = COALESCE(?, comprobante)
    WHERE id = ?
  `).run(
    viaje_id, chofer_id, fecha, categoria, descripcion,
    importe ? Number(importe) : null,
    comprobante, req.params.id
  );

  const actualizado = db.prepare(`
    SELECT g.*, ch.nombre AS chofer_nombre, v.numero AS viaje_numero
    FROM gastos g
    LEFT JOIN choferes ch ON ch.id = g.chofer_id
    LEFT JOIN viajes    v ON v.id  = g.viaje_id
    WHERE g.id = ?
  `).get(req.params.id);

  res.json({ ok: true, data: actualizado });
});

// ── DELETE /api/gastos/:id ────────────────────────────────────
router.delete('/:id', requierePermiso('gastos', 'eliminar'), (req, res) => {
  const gasto = db.prepare(`SELECT * FROM gastos WHERE id = ?`).get(req.params.id);
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

  db.prepare(`DELETE FROM gastos WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Gasto eliminado correctamente' });
});

module.exports = router;

const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

// ── GET /api/anticipos ────────────────────────────────────────
router.get('/', (req, res) => {
  const { chofer_id, viaje_id, liquidado, desde, hasta } = req.query;

  let query = `
    SELECT a.*,
           ch.nombre AS chofer_nombre,
           v.numero  AS viaje_numero
    FROM anticipos a
    LEFT JOIN choferes ch ON ch.id = a.chofer_id
    LEFT JOIN viajes    v ON v.id  = a.viaje_id
    WHERE 1=1
  `;
  const params = [];

  // Chofer solo ve sus propios anticipos
  if (req.usuario.rol === 'chofer') {
    query += ` AND a.chofer_id = ?`;
    params.push(req.usuario.id);
  }

  if (chofer_id) { query += ` AND a.chofer_id = ?`;  params.push(chofer_id); }
  if (viaje_id)  { query += ` AND a.viaje_id = ?`;   params.push(viaje_id); }
  if (desde)     { query += ` AND a.fecha >= ?`;      params.push(desde); }
  if (hasta)     { query += ` AND a.fecha <= ?`;      params.push(hasta); }

  if (liquidado !== undefined) {
    query += ` AND a.liquidado = ?`;
    params.push(liquidado === 'true' ? 1 : 0);
  }

  query += ` ORDER BY a.fecha DESC, a.id DESC`;

  const anticipos = db.prepare(query).all(...params);

  // Totales
  const totales = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN liquidado = 0 THEN importe ELSE 0 END), 0) AS pendientes,
      COALESCE(SUM(CASE WHEN liquidado = 1 THEN importe ELSE 0 END), 0) AS liquidados,
      COALESCE(SUM(importe), 0) AS total
    FROM anticipos
    ${req.usuario.rol === 'chofer' ? 'WHERE chofer_id = ' + req.usuario.id : ''}
  `).get();

  res.json({ ok: true, data: anticipos, totales });
});

// ── GET /api/anticipos/:id ────────────────────────────────────
router.get('/:id', (req, res) => {
  const anticipo = db.prepare(`
    SELECT a.*,
           ch.nombre AS chofer_nombre,
           v.numero  AS viaje_numero,
           v.origen  AS viaje_origen,
           v.destino AS viaje_destino
    FROM anticipos a
    LEFT JOIN choferes ch ON ch.id = a.chofer_id
    LEFT JOIN viajes    v ON v.id  = a.viaje_id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!anticipo) return res.status(404).json({ error: 'Anticipo no encontrado' });

  // Chofer solo ve sus propios anticipos
  if (req.usuario.rol === 'chofer' && anticipo.chofer_id !== req.usuario.id) {
    return res.status(403).json({ error: 'Sin acceso a este anticipo' });
  }

  res.json({ ok: true, data: anticipo });
});

// ── GET /api/anticipos/chofer/:chofer_id/pendientes ───────────
router.get('/chofer/:chofer_id/pendientes', (req, res) => {
  const pendientes = db.prepare(`
    SELECT a.*,
           v.numero  AS viaje_numero,
           v.origen  AS viaje_origen,
           v.destino AS viaje_destino
    FROM anticipos a
    LEFT JOIN viajes v ON v.id = a.viaje_id
    WHERE a.chofer_id = ? AND a.liquidado = 0
    ORDER BY a.fecha ASC
  `).all(req.params.chofer_id);

  const total = db.prepare(`
    SELECT COALESCE(SUM(importe), 0) AS total
    FROM anticipos
    WHERE chofer_id = ? AND liquidado = 0
  `).get(req.params.chofer_id);

  res.json({ ok: true, data: pendientes, total: total.total });
});

// ── POST /api/anticipos ───────────────────────────────────────
router.post('/', requierePermiso('anticipos', 'crear'), (req, res) => {
  const { chofer_id, viaje_id, fecha, importe, descripcion } = req.body;

  if (!chofer_id || !fecha || !importe) {
    return res.status(400).json({ error: 'Chofer, fecha e importe son requeridos' });
  }

  if (isNaN(importe) || Number(importe) <= 0) {
    return res.status(400).json({ error: 'El importe debe ser un número mayor a 0' });
  }

  // Verificar que el chofer existe
  const chofer = db.prepare(`SELECT id FROM choferes WHERE id = ?`).get(chofer_id);
  if (!chofer) return res.status(404).json({ error: 'Chofer no encontrado' });

  // Verificar que el viaje existe si se envía viaje_id
  if (viaje_id) {
    const viaje = db.prepare(`SELECT id FROM viajes WHERE id = ?`).get(viaje_id);
    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });
  }

  const result = db.prepare(`
    INSERT INTO anticipos (chofer_id, viaje_id, fecha, importe, descripcion, liquidado)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(
    chofer_id,
    viaje_id    || null,
    fecha,
    Number(importe),
    descripcion || null
  );

  const nuevo = db.prepare(`
    SELECT a.*,
           ch.nombre AS chofer_nombre,
           v.numero  AS viaje_numero
    FROM anticipos a
    LEFT JOIN choferes ch ON ch.id = a.chofer_id
    LEFT JOIN viajes    v ON v.id  = a.viaje_id
    WHERE a.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/anticipos/:id ────────────────────────────────────
router.put('/:id', requierePermiso('anticipos', 'editar'), (req, res) => {
  const anticipo = db.prepare(`SELECT * FROM anticipos WHERE id = ?`).get(req.params.id);
  if (!anticipo) return res.status(404).json({ error: 'Anticipo no encontrado' });

  if (anticipo.liquidado) {
    return res.status(409).json({ error: 'No se puede editar un anticipo ya liquidado' });
  }

  const { chofer_id, viaje_id, fecha, importe, descripcion } = req.body;

  if (importe && (isNaN(importe) || Number(importe) <= 0)) {
    return res.status(400).json({ error: 'El importe debe ser un número mayor a 0' });
  }

  db.prepare(`
    UPDATE anticipos SET
      chofer_id   = COALESCE(?, chofer_id),
      viaje_id    = COALESCE(?, viaje_id),
      fecha       = COALESCE(?, fecha),
      importe     = COALESCE(?, importe),
      descripcion = COALESCE(?, descripcion)
    WHERE id = ?
  `).run(
    chofer_id   || null,
    viaje_id    || null,
    fecha       || null,
    importe ? Number(importe) : null,
    descripcion || null,
    req.params.id
  );

  const actualizado = db.prepare(`
    SELECT a.*,
           ch.nombre AS chofer_nombre,
           v.numero  AS viaje_numero
    FROM anticipos a
    LEFT JOIN choferes ch ON ch.id = a.chofer_id
    LEFT JOIN viajes    v ON v.id  = a.viaje_id
    WHERE a.id = ?
  `).get(req.params.id);

  res.json({ ok: true, data: actualizado });
});

// ── PATCH /api/anticipos/:id/liquidar ─────────────────────────
router.patch('/:id/liquidar', requierePermiso('anticipos', 'editar'), (req, res) => {
  const anticipo = db.prepare(`SELECT * FROM anticipos WHERE id = ?`).get(req.params.id);
  if (!anticipo) return res.status(404).json({ error: 'Anticipo no encontrado' });

  if (anticipo.liquidado) {
    return res.status(409).json({ error: 'El anticipo ya fue liquidado' });
  }

  db.prepare(`UPDATE anticipos SET liquidado = 1 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Anticipo marcado como liquidado' });
});

// ── DELETE /api/anticipos/:id ─────────────────────────────────
router.delete('/:id', requierePermiso('anticipos', 'eliminar'), (req, res) => {
  const anticipo = db.prepare(`SELECT * FROM anticipos WHERE id = ?`).get(req.params.id);
  if (!anticipo) return res.status(404).json({ error: 'Anticipo no encontrado' });

  if (anticipo.liquidado) {
    return res.status(409).json({ error: 'No se puede eliminar un anticipo ya liquidado' });
  }

  db.prepare(`DELETE FROM anticipos WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Anticipo eliminado correctamente' });
});

module.exports = router;

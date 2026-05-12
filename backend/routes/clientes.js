const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

// ── GET /api/clientes ─────────────────────────────────────────
router.get('/', (req, res) => {
  const { activo, buscar } = req.query;

  let query = `SELECT * FROM clientes WHERE 1=1`;
  const params = [];

  if (activo !== undefined) {
    query += ` AND activo = ?`;
    params.push(activo === 'true' ? 1 : 0);
  }

  if (buscar) {
    query += ` AND (razon_social LIKE ? OR cuit LIKE ? OR telefono LIKE ? OR email LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b, b, b);
  }

  query += ` ORDER BY razon_social ASC`;

  const clientes = db.prepare(query).all(...params);
  res.json({ ok: true, data: clientes });
});

// ── GET /api/clientes/:id ─────────────────────────────────────
router.get('/:id', (req, res) => {
  const cliente = db.prepare(
    `SELECT * FROM clientes WHERE id = ?`
  ).get(req.params.id);

  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  res.json({ ok: true, data: cliente });
});

// ── GET /api/clientes/:id/viajes ──────────────────────────────
router.get('/:id/viajes', (req, res) => {
  const { desde, hasta, estado } = req.query;

  let query = `
    SELECT v.*,
           ch.nombre  AS chofer_nombre,
           ve.patente AS vehiculo_patente,
           p.nombre   AS producto_nombre
    FROM viajes v
    LEFT JOIN choferes  ch ON ch.id = v.chofer_id
    LEFT JOIN vehiculos ve ON ve.id = v.vehiculo_id
    LEFT JOIN productos  p ON p.id  = v.producto_id
    WHERE v.cliente_id = ?
  `;
  const params = [req.params.id];

  if (desde)  { query += ` AND v.fecha >= ?`;  params.push(desde); }
  if (hasta)  { query += ` AND v.fecha <= ?`;  params.push(hasta); }
  if (estado) { query += ` AND v.estado = ?`;  params.push(estado); }

  query += ` ORDER BY v.fecha DESC`;

  const viajes = db.prepare(query).all(...params);
  res.json({ ok: true, data: viajes });
});

// ── GET /api/clientes/:id/resumen ─────────────────────────────
router.get('/:id/resumen', (req, res) => {
  const id = req.params.id;

  const cliente = db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  const totalViajes = db.prepare(`
    SELECT COUNT(*) as total,
           COALESCE(SUM(importe_flete), 0) as importe_total,
           COALESCE(SUM(km_reales), 0)     as km_total
    FROM viajes
    WHERE cliente_id = ? AND estado = 'completado'
  `).get(id);

  const pendientes = db.prepare(`
    SELECT COUNT(*) as total
    FROM viajes
    WHERE cliente_id = ? AND estado IN ('pendiente','en_curso')
  `).get(id);

  res.json({
    ok: true,
    data: {
      cliente,
      viajes_completados: totalViajes.total,
      importe_total:      totalViajes.importe_total,
      km_total:           totalViajes.km_total,
      viajes_pendientes:  pendientes.total
    }
  });
});

// ── POST /api/clientes ────────────────────────────────────────
router.post('/', requierePermiso('clientes', 'crear'), (req, res) => {
  const { razon_social, cuit, telefono, email, direccion } = req.body;

  if (!razon_social) {
    return res.status(400).json({ error: 'La razón social es requerida' });
  }

  if (cuit) {
    const existe = db.prepare(`SELECT id FROM clientes WHERE cuit = ?`).get(cuit);
    if (existe) {
      return res.status(409).json({ error: `Ya existe un cliente con CUIT ${cuit}` });
    }
  }

  const result = db.prepare(`
    INSERT INTO clientes (razon_social, cuit, telefono, email, direccion)
    VALUES (?, ?, ?, ?, ?)
  `).run(razon_social.trim(), cuit || null, telefono || null, email || null, direccion || null);

  const nuevo = db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/clientes/:id ─────────────────────────────────────
router.put('/:id', requierePermiso('clientes', 'editar'), (req, res) => {
  const { razon_social, cuit, telefono, email, direccion, activo } = req.body;

  const cliente = db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  if (cuit && cuit !== cliente.cuit) {
    const existe = db.prepare(
      `SELECT id FROM clientes WHERE cuit = ? AND id != ?`
    ).get(cuit, req.params.id);
    if (existe) return res.status(409).json({ error: `CUIT ${cuit} ya pertenece a otro cliente` });
  }

  db.prepare(`
    UPDATE clientes SET
      razon_social = COALESCE(?, razon_social),
      cuit         = COALESCE(?, cuit),
      telefono     = COALESCE(?, telefono),
      email        = COALESCE(?, email),
      direccion    = COALESCE(?, direccion),
      activo       = COALESCE(?, activo)
    WHERE id = ?
  `).run(
    razon_social, cuit, telefono, email, direccion,
    activo !== undefined ? (activo ? 1 : 0) : null,
    req.params.id
  );

  const actualizado = db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, data: actualizado });
});

// ── DELETE /api/clientes/:id ──────────────────────────────────
router.delete('/:id', requierePermiso('clientes', 'eliminar'), (req, res) => {
  const cliente = db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  const tieneViajes = db.prepare(
    `SELECT COUNT(*) as total FROM viajes WHERE cliente_id = ?`
  ).get(req.params.id);

  if (tieneViajes.total > 0) {
    db.prepare(`UPDATE clientes SET activo = 0 WHERE id = ?`).run(req.params.id);
    return res.json({ ok: true, mensaje: 'Cliente desactivado (tiene viajes asociados)' });
  }

  db.prepare(`DELETE FROM clientes WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Cliente eliminado correctamente' });
});

module.exports = router;

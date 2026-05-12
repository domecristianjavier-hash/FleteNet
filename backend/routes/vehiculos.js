const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

// ── GET /api/vehiculos ────────────────────────────────────────
router.get('/', (req, res) => {
  const { activo, tipo, buscar } = req.query;

  let query = `SELECT * FROM vehiculos WHERE 1=1`;
  const params = [];

  if (activo !== undefined) {
    query += ` AND activo = ?`;
    params.push(activo === 'true' ? 1 : 0);
  }

  if (tipo) {
    query += ` AND tipo = ?`;
    params.push(tipo);
  }

  if (buscar) {
    query += ` AND (patente LIKE ? OR marca LIKE ? OR modelo LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b, b);
  }

  query += ` ORDER BY patente ASC`;

  const vehiculos = db.prepare(query).all(...params);
  res.json({ ok: true, data: vehiculos });
});

// ── GET /api/vehiculos/:id ────────────────────────────────────
router.get('/:id', (req, res) => {
  const vehiculo = db.prepare(
    `SELECT * FROM vehiculos WHERE id = ?`
  ).get(req.params.id);

  if (!vehiculo) {
    return res.status(404).json({ error: 'Vehículo no encontrado' });
  }

  res.json({ ok: true, data: vehiculo });
});

// ── GET /api/vehiculos/:id/viajes ─────────────────────────────
router.get('/:id/viajes', (req, res) => {
  const { desde, hasta } = req.query;

  let query = `
    SELECT v.*, ch.nombre AS chofer_nombre,
           c.razon_social AS cliente_nombre,
           p.nombre AS producto_nombre
    FROM viajes v
    LEFT JOIN choferes  ch ON ch.id = v.chofer_id
    LEFT JOIN clientes   c ON c.id  = v.cliente_id
    LEFT JOIN productos  p ON p.id  = v.producto_id
    WHERE v.vehiculo_id = ?
  `;
  const params = [req.params.id];

  if (desde) { query += ` AND v.fecha >= ?`; params.push(desde); }
  if (hasta) { query += ` AND v.fecha <= ?`; params.push(hasta); }

  query += ` ORDER BY v.fecha DESC`;

  const viajes = db.prepare(query).all(...params);
  res.json({ ok: true, data: viajes });
});

// ── GET /api/vehiculos/:id/combustible ───────────────────────
router.get('/:id/combustible', (req, res) => {
  const { desde, hasta } = req.query;

  let query = `
    SELECT cb.*, v.numero AS viaje_numero
    FROM combustible cb
    LEFT JOIN viajes v ON v.id = cb.viaje_id
    WHERE cb.vehiculo_id = ?
  `;
  const params = [req.params.id];

  if (desde) { query += ` AND cb.fecha >= ?`; params.push(desde); }
  if (hasta) { query += ` AND cb.fecha <= ?`; params.push(hasta); }

  query += ` ORDER BY cb.fecha DESC`;

  const registros = db.prepare(query).all(...params);

  const resumen = db.prepare(`
    SELECT
      COUNT(*)            AS cargas,
      COALESCE(SUM(litros), 0)  AS total_litros,
      COALESCE(SUM(total), 0)   AS total_importe
    FROM combustible WHERE vehiculo_id = ?
  `).get(req.params.id);

  res.json({ ok: true, data: registros, resumen });
});

// ── GET /api/vehiculos/:id/resumen ────────────────────────────
router.get('/:id/resumen', (req, res) => {
  const id = req.params.id;

  const vehiculo = db.prepare(`SELECT * FROM vehiculos WHERE id = ?`).get(id);
  if (!vehiculo) return res.status(404).json({ error: 'Vehículo no encontrado' });

  const totalViajes = db.prepare(`
    SELECT COUNT(*) as total,
           COALESCE(SUM(km_reales), 0) as km_total
    FROM viajes WHERE vehiculo_id = ? AND estado = 'completado'
  `).get(id);

  const totalCombustible = db.prepare(`
    SELECT COALESCE(SUM(litros), 0) as litros,
           COALESCE(SUM(total), 0)  as importe
    FROM combustible WHERE vehiculo_id = ?
  `).get(id);

  const consumo = totalViajes.km_total > 0 && totalCombustible.litros > 0
    ? (totalCombustible.litros / totalViajes.km_total * 100).toFixed(2)
    : null;

  res.json({
    ok: true,
    data: {
      vehiculo,
      viajes_completados: totalViajes.total,
      km_total:           totalViajes.km_total,
      litros_total:       totalCombustible.litros,
      combustible_importe: totalCombustible.importe,
      consumo_cada_100km: consumo
    }
  });
});

// ── POST /api/vehiculos ───────────────────────────────────────
router.post('/', requierePermiso('vehiculos', 'crear'), (req, res) => {
  const { patente, marca, modelo, anio, tipo } = req.body;

  if (!patente) {
    return res.status(400).json({ error: 'La patente es requerida' });
  }

  const existe = db.prepare(
    `SELECT id FROM vehiculos WHERE patente = ?`
  ).get(patente.toUpperCase());

  if (existe) {
    return res.status(409).json({ error: `Ya existe un vehículo con patente ${patente}` });
  }

  const result = db.prepare(`
    INSERT INTO vehiculos (patente, marca, modelo, anio, tipo)
    VALUES (?, ?, ?, ?, ?)
  `).run(patente.toUpperCase().trim(), marca, modelo, anio, tipo || 'camion');

  const nuevo = db.prepare(`SELECT * FROM vehiculos WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/vehiculos/:id ────────────────────────────────────
router.put('/:id', requierePermiso('vehiculos', 'editar'), (req, res) => {
  const { patente, marca, modelo, anio, tipo, activo } = req.body;

  const vehiculo = db.prepare(`SELECT * FROM vehiculos WHERE id = ?`).get(req.params.id);
  if (!vehiculo) return res.status(404).json({ error: 'Vehículo no encontrado' });

  if (patente && patente.toUpperCase() !== vehiculo.patente) {
    const existe = db.prepare(
      `SELECT id FROM vehiculos WHERE patente = ? AND id != ?`
    ).get(patente.toUpperCase(), req.params.id);
    if (existe) return res.status(409).json({ error: `Patente ${patente} ya registrada` });
  }

  db.prepare(`
    UPDATE vehiculos SET
      patente = COALESCE(?, patente),
      marca   = COALESCE(?, marca),
      modelo  = COALESCE(?, modelo),
      anio    = COALESCE(?, anio),
      tipo    = COALESCE(?, tipo),
      activo  = COALESCE(?, activo)
    WHERE id = ?
  `).run(
    patente ? patente.toUpperCase().trim() : null,
    marca, modelo, anio, tipo,
    activo !== undefined ? (activo ? 1 : 0) : null,
    req.params.id
  );

  const actualizado = db.prepare(`SELECT * FROM vehiculos WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, data: actualizado });
});

// ── DELETE /api/vehiculos/:id ─────────────────────────────────
router.delete('/:id', requierePermiso('vehiculos', 'eliminar'), (req, res) => {
  const vehiculo = db.prepare(`SELECT * FROM vehiculos WHERE id = ?`).get(req.params.id);
  if (!vehiculo) return res.status(404).json({ error: 'Vehículo no encontrado' });

  const tieneViajes = db.prepare(
    `SELECT COUNT(*) as total FROM viajes WHERE vehiculo_id = ?`
  ).get(req.params.id);

  if (tieneViajes.total > 0) {
    db.prepare(`UPDATE vehiculos SET activo = 0 WHERE id = ?`).run(req.params.id);
    return res.json({ ok: true, mensaje: 'Vehículo desactivado (tiene viajes asociados)' });
  }

  db.prepare(`DELETE FROM vehiculos WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Vehículo eliminado correctamente' });
});

module.exports = router;

const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

// ── GET /api/combustible ──────────────────────────────────────
router.get('/', (req, res) => {
  const { viaje_id, vehiculo_id, desde, hasta, buscar } = req.query;

  let query = `
    SELECT cb.*,
           v.numero   AS viaje_numero,
           ve.patente AS vehiculo_patente,
           ve.marca   AS vehiculo_marca,
           ve.modelo  AS vehiculo_modelo
    FROM combustible cb
    LEFT JOIN viajes    v  ON v.id  = cb.viaje_id
    LEFT JOIN vehiculos ve ON ve.id = cb.vehiculo_id
    WHERE 1=1
  `;
  const params = [];

  if (viaje_id)   { query += ` AND cb.viaje_id = ?`;   params.push(viaje_id); }
  if (vehiculo_id){ query += ` AND cb.vehiculo_id = ?`; params.push(vehiculo_id); }
  if (desde)      { query += ` AND cb.fecha >= ?`;       params.push(desde); }
  if (hasta)      { query += ` AND cb.fecha <= ?`;       params.push(hasta); }

  if (buscar) {
    query += ` AND (ve.patente LIKE ? OR cb.estacion LIKE ? OR v.numero LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b, b);
  }

  query += ` ORDER BY cb.fecha DESC, cb.id DESC`;

  const registros = db.prepare(query).all(...params);

  // Totales generales
  const totales = db.prepare(`
    SELECT COUNT(*)               AS cargas,
           COALESCE(SUM(litros),0) AS total_litros,
           COALESCE(SUM(total),0)  AS total_importe,
           CASE
             WHEN SUM(litros) > 0
             THEN ROUND(SUM(total) / SUM(litros), 2)
             ELSE 0
           END AS precio_promedio
    FROM combustible
  `).get();

  res.json({ ok: true, data: registros, totales });
});

// ── GET /api/combustible/:id ──────────────────────────────────
router.get('/:id', (req, res) => {
  const registro = db.prepare(`
    SELECT cb.*,
           v.numero   AS viaje_numero,
           v.origen   AS viaje_origen,
           v.destino  AS viaje_destino,
           ve.patente AS vehiculo_patente,
           ve.marca   AS vehiculo_marca,
           ve.modelo  AS vehiculo_modelo
    FROM combustible cb
    LEFT JOIN viajes    v  ON v.id  = cb.viaje_id
    LEFT JOIN vehiculos ve ON ve.id = cb.vehiculo_id
    WHERE cb.id = ?
  `).get(req.params.id);

  if (!registro) return res.status(404).json({ error: 'Registro de combustible no encontrado' });

  res.json({ ok: true, data: registro });
});

// ── GET /api/combustible/resumen/por-vehiculo ─────────────────
router.get('/resumen/por-vehiculo', (req, res) => {
  const { desde, hasta } = req.query;

  let where = `WHERE 1=1`;
  const params = [];

  if (desde) { where += ` AND cb.fecha >= ?`; params.push(desde); }
  if (hasta) { where += ` AND cb.fecha <= ?`; params.push(hasta); }

  const resumen = db.prepare(`
    SELECT ve.id,
           ve.patente,
           ve.marca,
           ve.modelo,
           COUNT(cb.id)           AS cargas,
           COALESCE(SUM(cb.litros),0) AS total_litros,
           COALESCE(SUM(cb.total),0)  AS total_importe,
           CASE
             WHEN SUM(cb.litros) > 0
             THEN ROUND(SUM(cb.total) / SUM(cb.litros), 2)
             ELSE 0
           END AS precio_promedio
    FROM combustible cb
    JOIN vehiculos ve ON ve.id = cb.vehiculo_id
    ${where}
    GROUP BY ve.id
    ORDER BY total_importe DESC
  `).all(...params);

  res.json({ ok: true, data: resumen });
});

// ── GET /api/combustible/resumen/por-mes ──────────────────────
router.get('/resumen/por-mes', (req, res) => {
  const { anio, vehiculo_id } = req.query;

  let where = `WHERE 1=1`;
  const params = [];

  if (anio)       { where += ` AND strftime('%Y', fecha) = ?`; params.push(String(anio)); }
  if (vehiculo_id){ where += ` AND vehiculo_id = ?`;            params.push(vehiculo_id); }

  const porMes = db.prepare(`
    SELECT strftime('%Y-%m', fecha)    AS mes,
           COUNT(*)                    AS cargas,
           COALESCE(SUM(litros),0)     AS total_litros,
           COALESCE(SUM(total),0)      AS total_importe
    FROM combustible
    ${where}
    GROUP BY mes
    ORDER BY mes ASC
  `).all(...params);

  res.json({ ok: true, data: porMes });
});

// ── POST /api/combustible ─────────────────────────────────────
router.post('/', requierePermiso('combustible', 'crear'), (req, res) => {
  const { viaje_id, vehiculo_id, fecha, litros, precio_litro, estacion } = req.body;

  if (!vehiculo_id || !fecha || !litros || !precio_litro) {
    return res.status(400).json({
      error: 'Vehículo, fecha, litros y precio por litro son requeridos'
    });
  }

  if (isNaN(litros) || Number(litros) <= 0) {
    return res.status(400).json({ error: 'Los litros deben ser un número mayor a 0' });
  }

  if (isNaN(precio_litro) || Number(precio_litro) <= 0) {
    return res.status(400).json({ error: 'El precio por litro debe ser un número mayor a 0' });
  }

  // Verificar que el vehículo existe
  const vehiculo = db.prepare(`SELECT id FROM vehiculos WHERE id = ?`).get(vehiculo_id);
  if (!vehiculo) return res.status(404).json({ error: 'Vehículo no encontrado' });

  // Verificar que el viaje existe si se envía viaje_id
  if (viaje_id) {
    const viaje = db.prepare(`SELECT id FROM viajes WHERE id = ?`).get(viaje_id);
    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });
  }

  const total = Number(litros) * Number(precio_litro);

  const result = db.prepare(`
    INSERT INTO combustible (viaje_id, vehiculo_id, fecha, litros, precio_litro, total, estacion)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    viaje_id    || null,
    vehiculo_id,
    fecha,
    Number(litros),
    Number(precio_litro),
    Number(total.toFixed(2)),
    estacion    || null
  );

  const nuevo = db.prepare(`
    SELECT cb.*,
           v.numero   AS viaje_numero,
           ve.patente AS vehiculo_patente
    FROM combustible cb
    LEFT JOIN viajes    v  ON v.id  = cb.viaje_id
    LEFT JOIN vehiculos ve ON ve.id = cb.vehiculo_id
    WHERE cb.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/combustible/:id ──────────────────────────────────
router.put('/:id', requierePermiso('combustible', 'editar'), (req, res) => {
  const registro = db.prepare(`SELECT * FROM combustible WHERE id = ?`).get(req.params.id);
  if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });

  const { viaje_id, vehiculo_id, fecha, litros, precio_litro, estacion } = req.body;

  // Recalcular total si cambian litros o precio
  const nuevosLitros     = litros      ? Number(litros)      : registro.litros;
  const nuevoPrecio      = precio_litro? Number(precio_litro): registro.precio_litro;
  const nuevoTotal       = Number((nuevosLitros * nuevoPrecio).toFixed(2));

  db.prepare(`
    UPDATE combustible SET
      viaje_id    = COALESCE(?, viaje_id),
      vehiculo_id = COALESCE(?, vehiculo_id),
      fecha       = COALESCE(?, fecha),
      litros      = ?,
      precio_litro= ?,
      total       = ?,
      estacion    = COALESCE(?, estacion)
    WHERE id = ?
  `).run(
    viaje_id || null,
    vehiculo_id || null,
    fecha || null,
    nuevosLitros,
    nuevoPrecio,
    nuevoTotal,
    estacion || null,
    req.params.id
  );

  const actualizado = db.prepare(`
    SELECT cb.*,
           v.numero   AS viaje_numero,
           ve.patente AS vehiculo_patente
    FROM combustible cb
    LEFT JOIN viajes    v  ON v.id  = cb.viaje_id
    LEFT JOIN vehiculos ve ON ve.id = cb.vehiculo_id
    WHERE cb.id = ?
  `).get(req.params.id);

  res.json({ ok: true, data: actualizado });
});

// ── DELETE /api/combustible/:id ───────────────────────────────
router.delete('/:id', requierePermiso('combustible', 'eliminar'), (req, res) => {
  const registro = db.prepare(`SELECT * FROM combustible WHERE id = ?`).get(req.params.id);
  if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });

  db.prepare(`DELETE FROM combustible WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Registro de combustible eliminado correctamente' });
});

module.exports = router;

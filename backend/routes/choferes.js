const express = require('express');
const db      = require('../database/db');
const { verificarToken, soloAdmin, adminOOperador } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

// Todos los endpoints requieren token
router.use(verificarToken);

// ── GET /api/choferes ─────────────────────────────────────────
router.get('/', (req, res) => {
  const { activo, buscar } = req.query;

  let query = `SELECT * FROM choferes WHERE 1=1`;
  const params = [];

  if (activo !== undefined) {
    query += ` AND activo = ?`;
    params.push(activo === 'true' ? 1 : 0);
  }

  if (buscar) {
    query += ` AND (nombre LIKE ? OR dni LIKE ? OR telefono LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b, b);
  }

  query += ` ORDER BY nombre ASC`;

  const choferes = db.prepare(query).all(...params);
  res.json({ ok: true, data: choferes });
});

// ── GET /api/choferes/:id ─────────────────────────────────────
router.get('/:id', (req, res) => {
  const chofer = db.prepare(
    `SELECT * FROM choferes WHERE id = ?`
  ).get(req.params.id);

  if (!chofer) {
    return res.status(404).json({ error: 'Chofer no encontrado' });
  }

  res.json({ ok: true, data: chofer });
});

// ── GET /api/choferes/:id/viajes ──────────────────────────────
router.get('/:id/viajes', (req, res) => {
  const { desde, hasta, estado } = req.query;

  let query = `
    SELECT v.*, c.razon_social AS cliente_nombre,
           ve.patente AS vehiculo_patente,
           p.nombre AS producto_nombre
    FROM viajes v
    LEFT JOIN clientes  c  ON c.id  = v.cliente_id
    LEFT JOIN vehiculos ve ON ve.id = v.vehiculo_id
    LEFT JOIN productos p  ON p.id  = v.producto_id
    WHERE v.chofer_id = ?
  `;
  const params = [req.params.id];

  if (desde) { query += ` AND v.fecha >= ?`; params.push(desde); }
  if (hasta) { query += ` AND v.fecha <= ?`; params.push(hasta); }
  if (estado) { query += ` AND v.estado = ?`; params.push(estado); }

  query += ` ORDER BY v.fecha DESC`;

  const viajes = db.prepare(query).all(...params);
  res.json({ ok: true, data: viajes });
});

// ── GET /api/choferes/:id/resumen ─────────────────────────────
router.get('/:id/resumen', (req, res) => {
  const id = req.params.id;

  const chofer = db.prepare(`SELECT * FROM choferes WHERE id = ?`).get(id);
  if (!chofer) return res.status(404).json({ error: 'Chofer no encontrado' });

  const totalViajes = db.prepare(
    `SELECT COUNT(*) as total, COALESCE(SUM(importe_flete),0) as importe
     FROM viajes WHERE chofer_id = ? AND estado = 'completado'`
  ).get(id);

  const totalGastos = db.prepare(
    `SELECT COALESCE(SUM(importe),0) as total FROM gastos WHERE chofer_id = ?`
  ).get(id);

  const totalAnticipos = db.prepare(
    `SELECT COALESCE(SUM(importe),0) as total FROM anticipos
     WHERE chofer_id = ? AND liquidado = 0`
  ).get(id);

  res.json({
    ok: true,
    data: {
      chofer,
      viajes_completados: totalViajes.total,
      importe_total:      totalViajes.importe,
      gastos_total:       totalGastos.total,
      anticipos_pendientes: totalAnticipos.total
    }
  });
});

// ── POST /api/choferes ────────────────────────────────────────
router.post('/', requierePermiso('choferes', 'crear'), (req, res) => {
  const { nombre, dni, telefono, licencia, vencimiento_licencia } = req.body;

  if (!nombre || !dni) {
    return res.status(400).json({ error: 'Nombre y DNI son requeridos' });
  }

  const existe = db.prepare(`SELECT id FROM choferes WHERE dni = ?`).get(dni);
  if (existe) {
    return res.status(409).json({ error: `Ya existe un chofer con DNI ${dni}` });
  }

  const result = db.prepare(`
    INSERT INTO choferes (nombre, dni, telefono, licencia, vencimiento_licencia)
    VALUES (?, ?, ?, ?, ?)
  `).run(nombre.trim(), dni.trim(), telefono, licencia, vencimiento_licencia);

  const nuevo = db.prepare(`SELECT * FROM choferes WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/choferes/:id ─────────────────────────────────────
router.put('/:id', requierePermiso('choferes', 'editar'), (req, res) => {
  const { nombre, dni, telefono, licencia, vencimiento_licencia, activo } = req.body;

  const chofer = db.prepare(`SELECT * FROM choferes WHERE id = ?`).get(req.params.id);
  if (!chofer) return res.status(404).json({ error: 'Chofer no encontrado' });

  // Verificar DNI duplicado (otro chofer)
  if (dni && dni !== chofer.dni) {
    const existe = db.prepare(
      `SELECT id FROM choferes WHERE dni = ? AND id != ?`
    ).get(dni, req.params.id);
    if (existe) return res.status(409).json({ error: `DNI ${dni} ya pertenece a otro chofer` });
  }

  db.prepare(`
    UPDATE choferes SET
      nombre               = COALESCE(?, nombre),
      dni                  = COALESCE(?, dni),
      telefono             = COALESCE(?, telefono),
      licencia             = COALESCE(?, licencia),
      vencimiento_licencia = COALESCE(?, vencimiento_licencia),
      activo               = COALESCE(?, activo)
    WHERE id = ?
  `).run(nombre, dni, telefono, licencia, vencimiento_licencia,
         activo !== undefined ? (activo ? 1 : 0) : null,
         req.params.id);

  const actualizado = db.prepare(`SELECT * FROM choferes WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, data: actualizado });
});

// ── DELETE /api/choferes/:id ──────────────────────────────────
router.delete('/:id', requierePermiso('choferes', 'eliminar'), (req, res) => {
  const chofer = db.prepare(`SELECT * FROM choferes WHERE id = ?`).get(req.params.id);
  if (!chofer) return res.status(404).json({ error: 'Chofer no encontrado' });

  // Verificar si tiene viajes asociados
  const tieneViajes = db.prepare(
    `SELECT COUNT(*) as total FROM viajes WHERE chofer_id = ?`
  ).get(req.params.id);

  if (tieneViajes.total > 0) {
    // Baja lógica en lugar de eliminar
    db.prepare(`UPDATE choferes SET activo = 0 WHERE id = ?`).run(req.params.id);
    return res.json({ ok: true, mensaje: 'Chofer desactivado (tiene viajes asociados)' });
  }

  db.prepare(`DELETE FROM choferes WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Chofer eliminado correctamente' });
});

module.exports = router;

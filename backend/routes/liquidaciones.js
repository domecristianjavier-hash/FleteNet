const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

// ── Generar número de liquidación ─────────────────────────────
const generarNumero = () => {
  const ultima = db.prepare(
    `SELECT numero FROM liquidaciones ORDER BY id DESC LIMIT 1`
  ).get();
  if (!ultima) return 'LIQ-0001';
  const num = parseInt(ultima.numero.split('-')[1] || '0') + 1;
  return `LIQ-${String(num).padStart(4, '0')}`;
};

// ── GET /api/liquidaciones ────────────────────────────────────
router.get('/', (req, res) => {
  const { chofer_id, estado, desde, hasta } = req.query;

  let query = `
    SELECT l.*,
           ch.nombre AS chofer_nombre,
           ch.dni    AS chofer_dni
    FROM liquidaciones l
    LEFT JOIN choferes ch ON ch.id = l.chofer_id
    WHERE 1=1
  `;
  const params = [];

  // Chofer solo ve sus propias liquidaciones
  if (req.usuario.rol === 'chofer') {
    query += ` AND l.chofer_id = ?`;
    params.push(req.usuario.id);
  }

  if (chofer_id) { query += ` AND l.chofer_id = ?`; params.push(chofer_id); }
  if (estado)    { query += ` AND l.estado = ?`;    params.push(estado); }
  if (desde)     { query += ` AND l.fecha_desde >= ?`; params.push(desde); }
  if (hasta)     { query += ` AND l.fecha_hasta <= ?`; params.push(hasta); }

  query += ` ORDER BY l.id DESC`;

  const liquidaciones = db.prepare(query).all(...params);
  res.json({ ok: true, data: liquidaciones });
});

// ── GET /api/liquidaciones/:id ────────────────────────────────
router.get('/:id', (req, res) => {
  const liquidacion = db.prepare(`
    SELECT l.*,
           ch.nombre   AS chofer_nombre,
           ch.dni      AS chofer_dni,
           ch.telefono AS chofer_telefono
    FROM liquidaciones l
    LEFT JOIN choferes ch ON ch.id = l.chofer_id
    WHERE l.id = ?
  `).get(req.params.id);

  if (!liquidacion) return res.status(404).json({ error: 'Liquidación no encontrada' });

  // Chofer solo ve sus propias liquidaciones
  if (req.usuario.rol === 'chofer' && liquidacion.chofer_id !== req.usuario.id) {
    return res.status(403).json({ error: 'Sin acceso a esta liquidación' });
  }

  // Viajes incluidos en la liquidación
  const viajes = db.prepare(`
    SELECT v.*,
           c.razon_social AS cliente_nombre,
           ve.patente     AS vehiculo_patente,
           p.nombre       AS producto_nombre
    FROM liquidacion_viajes lv
    JOIN viajes     v  ON v.id  = lv.viaje_id
    LEFT JOIN clientes  c  ON c.id  = v.cliente_id
    LEFT JOIN vehiculos ve ON ve.id = v.vehiculo_id
    LEFT JOIN productos p  ON p.id  = v.producto_id
    WHERE lv.liquidacion_id = ?
    ORDER BY v.fecha ASC
  `).all(req.params.id);

  // Anticipos liquidados en este período
  const anticipos = db.prepare(`
    SELECT a.*
    FROM anticipos a
    WHERE a.chofer_id = ?
      AND a.liquidado = 1
      AND a.fecha BETWEEN ? AND ?
    ORDER BY a.fecha ASC
  `).all(liquidacion.chofer_id, liquidacion.fecha_desde, liquidacion.fecha_hasta);

  // Gastos del período
  const gastos = db.prepare(`
    SELECT g.*
    FROM gastos g
    WHERE g.chofer_id = ?
      AND g.fecha BETWEEN ? AND ?
    ORDER BY g.fecha ASC
  `).all(liquidacion.chofer_id, liquidacion.fecha_desde, liquidacion.fecha_hasta);

  res.json({
    ok: true,
    data: { ...liquidacion, viajes, anticipos, gastos }
  });
});

// ── POST /api/liquidaciones ───────────────────────────────────
// Calcula automáticamente los montos a partir de viajes y anticipos
router.post('/', requierePermiso('liquidaciones', 'crear'), (req, res) => {
  const {
    chofer_id,
    fecha_desde,
    fecha_hasta,
    porcentaje,
    viajes_ids,
    observaciones
  } = req.body;

  if (!chofer_id || !fecha_desde || !fecha_hasta || !porcentaje) {
    return res.status(400).json({
      error: 'Chofer, período y porcentaje son requeridos'
    });
  }

  if (!viajes_ids || !Array.isArray(viajes_ids) || viajes_ids.length === 0) {
    return res.status(400).json({ error: 'Debe incluir al menos un viaje' });
  }

  // Verificar que el chofer existe
  const chofer = db.prepare(`SELECT * FROM choferes WHERE id = ?`).get(chofer_id);
  if (!chofer) return res.status(404).json({ error: 'Chofer no encontrado' });

  // Sumar importe de los viajes seleccionados
  const placeholders = viajes_ids.map(() => '?').join(',');
  const totalFletes = db.prepare(`
    SELECT COALESCE(SUM(importe_flete), 0) AS total
    FROM viajes
    WHERE id IN (${placeholders}) AND chofer_id = ? AND estado = 'completado'
  `).get(...viajes_ids, chofer_id);

  // Anticipos pendientes del chofer en el período
  const totalAnticipos = db.prepare(`
    SELECT COALESCE(SUM(importe), 0) AS total
    FROM anticipos
    WHERE chofer_id = ? AND liquidado = 0
      AND fecha BETWEEN ? AND ?
  `).get(chofer_id, fecha_desde, fecha_hasta);

  // Gastos del chofer en el período
  const totalGastos = db.prepare(`
    SELECT COALESCE(SUM(importe), 0) AS total
    FROM gastos
    WHERE chofer_id = ?
      AND fecha BETWEEN ? AND ?
  `).get(chofer_id, fecha_desde, fecha_hasta);

  const importeBruto = (totalFletes.total * Number(porcentaje)) / 100;
  const importeNeto  = importeBruto - totalAnticipos.total - totalGastos.total;
  const numero       = generarNumero();

  // Transacción: crear liquidación + detalles + marcar anticipos
  const crearLiquidacion = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO liquidaciones (
        numero, chofer_id, fecha_desde, fecha_hasta,
        total_fletes, porcentaje, importe_bruto,
        total_anticipos, total_gastos, importe_neto,
        estado, observaciones
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?)
    `).run(
      numero, chofer_id, fecha_desde, fecha_hasta,
      totalFletes.total,
      Number(porcentaje),
      Number(importeBruto.toFixed(2)),
      totalAnticipos.total,
      totalGastos.total,
      Number(importeNeto.toFixed(2)),
      observaciones || null
    );

    const liquidacionId = result.lastInsertRowid;

    // Insertar viajes en el detalle
    const insertViaje = db.prepare(`
      INSERT INTO liquidacion_viajes (liquidacion_id, viaje_id) VALUES (?, ?)
    `);
    for (const viajeId of viajes_ids) {
      insertViaje.run(liquidacionId, viajeId);
    }

    // Marcar anticipos como liquidados
    db.prepare(`
      UPDATE anticipos SET liquidado = 1
      WHERE chofer_id = ? AND liquidado = 0
        AND fecha BETWEEN ? AND ?
    `).run(chofer_id, fecha_desde, fecha_hasta);

    return liquidacionId;
  });

  const liquidacionId = crearLiquidacion();
  const nueva = db.prepare(`SELECT * FROM liquidaciones WHERE id = ?`).get(liquidacionId);

  res.status(201).json({ ok: true, data: nueva });
});

// ── PATCH /api/liquidaciones/:id/estado ───────────────────────
router.patch('/:id/estado', requierePermiso('liquidaciones', 'crear'), (req, res) => {
  const { estado } = req.body;
  const estados = ['borrador', 'confirmada', 'pagada'];

  if (!estados.includes(estado)) {
    return res.status(400).json({
      error: `Estado inválido. Opciones: ${estados.join(', ')}`
    });
  }

  const liquidacion = db.prepare(`SELECT * FROM liquidaciones WHERE id = ?`).get(req.params.id);
  if (!liquidacion) return res.status(404).json({ error: 'Liquidación no encontrada' });

  if (liquidacion.estado === 'pagada') {
    return res.status(409).json({ error: 'Una liquidación pagada no puede modificarse' });
  }

  db.prepare(`UPDATE liquidaciones SET estado = ? WHERE id = ?`).run(estado, req.params.id);
  res.json({ ok: true, mensaje: `Liquidación marcada como: ${estado}` });
});

// ── PUT /api/liquidaciones/:id ────────────────────────────────
router.put('/:id', requierePermiso('liquidaciones', 'crear'), (req, res) => {
  const liquidacion = db.prepare(`SELECT * FROM liquidaciones WHERE id = ?`).get(req.params.id);
  if (!liquidacion) return res.status(404).json({ error: 'Liquidación no encontrada' });

  if (liquidacion.estado !== 'borrador') {
    return res.status(409).json({ error: 'Solo se pueden editar liquidaciones en borrador' });
  }

  const { observaciones, porcentaje } = req.body;

  db.prepare(`
    UPDATE liquidaciones SET
      observaciones = COALESCE(?, observaciones),
      porcentaje    = COALESCE(?, porcentaje)
    WHERE id = ?
  `).run(observaciones || null, porcentaje || null, req.params.id);

  const actualizada = db.prepare(`SELECT * FROM liquidaciones WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, data: actualizada });
});

// ── DELETE /api/liquidaciones/:id ─────────────────────────────
router.delete('/:id', requierePermiso('liquidaciones', 'eliminar'), (req, res) => {
  const liquidacion = db.prepare(`SELECT * FROM liquidaciones WHERE id = ?`).get(req.params.id);
  if (!liquidacion) return res.status(404).json({ error: 'Liquidación no encontrada' });

  if (liquidacion.estado === 'pagada') {
    return res.status(409).json({ error: 'No se puede eliminar una liquidación pagada' });
  }

  const eliminar = db.transaction(() => {
    // Revertir anticipos marcados en esta liquidación
    db.prepare(`
      UPDATE anticipos SET liquidado = 0
      WHERE chofer_id = ? AND liquidado = 1
        AND fecha BETWEEN ? AND ?
    `).run(liquidacion.chofer_id, liquidacion.fecha_desde, liquidacion.fecha_hasta);

    db.prepare(`DELETE FROM liquidacion_viajes WHERE liquidacion_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM liquidaciones WHERE id = ?`).run(req.params.id);
  });

  eliminar();
  res.json({ ok: true, mensaje: 'Liquidación eliminada correctamente' });
});

module.exports = router;

const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

// ── Generar número de viaje automático ────────────────────────
const generarNumero = () => {
  const ultimo = db.prepare(
    `SELECT numero FROM viajes ORDER BY id DESC LIMIT 1`
  ).get();
  if (!ultimo) return 'V-0001';
  const num = parseInt(ultimo.numero.split('-')[1] || '0') + 1;
  return `V-${String(num).padStart(4, '0')}`;
};

// ── GET /api/viajes ───────────────────────────────────────────
router.get('/', (req, res) => {
  const { estado, chofer_id, vehiculo_id, cliente_id, desde, hasta, buscar } = req.query;

  let query = `
    SELECT v.*,
           ch.nombre        AS chofer_nombre,
           ve.patente       AS vehiculo_patente,
           c.razon_social   AS cliente_nombre,
           p.nombre         AS producto_nombre
    FROM viajes v
    LEFT JOIN choferes  ch ON ch.id = v.chofer_id
    LEFT JOIN vehiculos ve ON ve.id = v.vehiculo_id
    LEFT JOIN clientes   c ON c.id  = v.cliente_id
    LEFT JOIN productos  p ON p.id  = v.producto_id
    WHERE 1=1
  `;
  const params = [];

  // Si es chofer solo ve sus viajes
  if (req.usuario.rol === 'chofer') {
    query += ` AND v.chofer_id = ?`;
    params.push(req.usuario.id);
  }

  if (estado)      { query += ` AND v.estado = ?`;      params.push(estado); }
  if (chofer_id)   { query += ` AND v.chofer_id = ?`;   params.push(chofer_id); }
  if (vehiculo_id) { query += ` AND v.vehiculo_id = ?`; params.push(vehiculo_id); }
  if (cliente_id)  { query += ` AND v.cliente_id = ?`;  params.push(cliente_id); }
  if (desde)       { query += ` AND v.fecha >= ?`;       params.push(desde); }
  if (hasta)       { query += ` AND v.fecha <= ?`;       params.push(hasta); }

  if (buscar) {
    query += ` AND (v.numero LIKE ? OR v.origen LIKE ? OR v.destino LIKE ?
                    OR ch.nombre LIKE ? OR c.razon_social LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b, b, b, b);
  }

  query += ` ORDER BY v.fecha DESC, v.id DESC`;

  const viajes = db.prepare(query).all(...params);
  res.json({ ok: true, data: viajes });
});

// ── GET /api/viajes/:id ───────────────────────────────────────
router.get('/:id', (req, res) => {
  const viaje = db.prepare(`
    SELECT v.*,
           ch.nombre        AS chofer_nombre,
           ch.dni           AS chofer_dni,
           ve.patente       AS vehiculo_patente,
           ve.marca         AS vehiculo_marca,
           ve.modelo        AS vehiculo_modelo,
           c.razon_social   AS cliente_nombre,
           c.telefono       AS cliente_telefono,
           p.nombre         AS producto_nombre,
           p.unidad         AS producto_unidad
    FROM viajes v
    LEFT JOIN choferes  ch ON ch.id = v.chofer_id
    LEFT JOIN vehiculos ve ON ve.id = v.vehiculo_id
    LEFT JOIN clientes   c ON c.id  = v.cliente_id
    LEFT JOIN productos  p ON p.id  = v.producto_id
    WHERE v.id = ?
  `).get(req.params.id);

  if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });

  // Gastos del viaje
  const gastos = db.prepare(
    `SELECT * FROM gastos WHERE viaje_id = ? ORDER BY fecha DESC`
  ).all(req.params.id);

  // Combustible del viaje
  const combustible = db.prepare(
    `SELECT * FROM combustible WHERE viaje_id = ? ORDER BY fecha DESC`
  ).all(req.params.id);

  // Anticipos del viaje
  const anticipos = db.prepare(
    `SELECT * FROM anticipos WHERE viaje_id = ? ORDER BY fecha DESC`
  ).all(req.params.id);

  res.json({ ok: true, data: { ...viaje, gastos, combustible, anticipos } });
});

// ── POST /api/viajes ──────────────────────────────────────────
router.post('/', requierePermiso('viajes', 'crear'), (req, res) => {
  const {
    fecha, chofer_id, vehiculo_id, cliente_id, producto_id,
    origen, destino, km_estimados, peso_carga,
    tarifa, importe_flete, observaciones
  } = req.body;

  if (!fecha || !chofer_id || !vehiculo_id || !cliente_id) {
    return res.status(400).json({
      error: 'Fecha, chofer, vehículo y cliente son requeridos'
    });
  }

  const numero = generarNumero();

  const result = db.prepare(`
    INSERT INTO viajes (
      numero, fecha, chofer_id, vehiculo_id, cliente_id, producto_id,
      origen, destino, km_estimados, peso_carga,
      tarifa, importe_flete, estado, observaciones
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)
  `).run(
    numero, fecha, chofer_id, vehiculo_id, cliente_id, producto_id || null,
    origen, destino, km_estimados || null, peso_carga || null,
    tarifa || null, importe_flete || null, observaciones || null
  );

  const nuevo = db.prepare(`SELECT * FROM viajes WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/viajes/:id ───────────────────────────────────────
router.put('/:id', requierePermiso('viajes', 'editar'), (req, res) => {
  const viaje = db.prepare(`SELECT * FROM viajes WHERE id = ?`).get(req.params.id);
  if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });

  const {
    fecha, chofer_id, vehiculo_id, cliente_id, producto_id,
    origen, destino, km_estimados, km_reales, peso_carga,
    tarifa, importe_flete, estado, observaciones
  } = req.body;

  db.prepare(`
    UPDATE viajes SET
      fecha          = COALESCE(?, fecha),
      chofer_id      = COALESCE(?, chofer_id),
      vehiculo_id    = COALESCE(?, vehiculo_id),
      cliente_id     = COALESCE(?, cliente_id),
      producto_id    = COALESCE(?, producto_id),
      origen         = COALESCE(?, origen),
      destino        = COALESCE(?, destino),
      km_estimados   = COALESCE(?, km_estimados),
      km_reales      = COALESCE(?, km_reales),
      peso_carga     = COALESCE(?, peso_carga),
      tarifa         = COALESCE(?, tarifa),
      importe_flete  = COALESCE(?, importe_flete),
      estado         = COALESCE(?, estado),
      observaciones  = COALESCE(?, observaciones)
    WHERE id = ?
  `).run(
    fecha, chofer_id, vehiculo_id, cliente_id, producto_id,
    origen, destino, km_estimados, km_reales, peso_carga,
    tarifa, importe_flete, estado, observaciones,
    req.params.id
  );

  const actualizado = db.prepare(`SELECT * FROM viajes WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, data: actualizado });
});

// ── PATCH /api/viajes/:id/estado ──────────────────────────────
router.patch('/:id/estado', requierePermiso('viajes', 'editar'), (req, res) => {
  const { estado } = req.body;
  const estados = ['pendiente', 'en_curso', 'completado', 'cancelado'];

  if (!estados.includes(estado)) {
    return res.status(400).json({ error: `Estado inválido. Opciones: ${estados.join(', ')}` });
  }

  const viaje = db.prepare(`SELECT * FROM viajes WHERE id = ?`).get(req.params.id);
  if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });

  db.prepare(`UPDATE viajes SET estado = ? WHERE id = ?`).run(estado, req.params.id);
  res.json({ ok: true, mensaje: `Viaje marcado como: ${estado}` });
});

// ── DELETE /api/viajes/:id ────────────────────────────────────
router.delete('/:id', requierePermiso('viajes', 'eliminar'), (req, res) => {
  const viaje = db.prepare(`SELECT * FROM viajes WHERE id = ?`).get(req.params.id);
  if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });

  if (viaje.estado === 'completado') {
    return res.status(409).json({ error: 'No se puede eliminar un viaje completado' });
  }

  // Eliminar registros relacionados
  db.prepare(`DELETE FROM gastos      WHERE viaje_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM combustible WHERE viaje_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM anticipos   WHERE viaje_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM viajes      WHERE id = ?`).run(req.params.id);

  res.json({ ok: true, mensaje: 'Viaje eliminado correctamente' });
});

module.exports = router;

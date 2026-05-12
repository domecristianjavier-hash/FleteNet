const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

router.use(verificarToken);

// ── GET /api/dashboard ────────────────────────────────────────
// Resumen general del sistema
router.get('/', (req, res) => {
  const hoy       = new Date().toISOString().split('T')[0];
  const inicioMes = hoy.substring(0, 7) + '-01';

  // ── Viajes ────────────────────────────────────────────────
  const viajesHoy = db.prepare(`
    SELECT COUNT(*) AS total
    FROM viajes
    WHERE fecha = ?
  `).get(hoy);

  const viajesMes = db.prepare(`
    SELECT COUNT(*)                            AS total,
           COALESCE(SUM(importe_flete), 0)    AS facturado,
           COALESCE(SUM(km_reales), 0)        AS km_total
    FROM viajes
    WHERE fecha >= ? AND estado = 'completado'
  `).get(inicioMes);

  const viajesPorEstado = db.prepare(`
    SELECT estado, COUNT(*) AS total
    FROM viajes
    GROUP BY estado
  `).all();

  // ── Choferes ──────────────────────────────────────────────
  const choferes = db.prepare(`
    SELECT COUNT(*) AS total_activos
    FROM choferes WHERE activo = 1
  `).get();

  const choferesEnRuta = db.prepare(`
    SELECT COUNT(DISTINCT chofer_id) AS total
    FROM viajes
    WHERE estado = 'en_curso'
  `).get();

  // ── Vehículos ─────────────────────────────────────────────
  const vehiculos = db.prepare(`
    SELECT COUNT(*) AS total_activos
    FROM vehiculos WHERE activo = 1
  `).get();

  const vehiculosEnRuta = db.prepare(`
    SELECT COUNT(DISTINCT vehiculo_id) AS total
    FROM viajes
    WHERE estado = 'en_curso'
  `).get();

  // ── Gastos del mes ────────────────────────────────────────
  const gastosMes = db.prepare(`
    SELECT COALESCE(SUM(importe), 0) AS total,
           COUNT(*)                  AS cantidad
    FROM gastos
    WHERE fecha >= ?
  `).get(inicioMes);

  const gastosPorCategoria = db.prepare(`
    SELECT categoria,
           COUNT(*)          AS cantidad,
           SUM(importe)      AS total
    FROM gastos
    WHERE fecha >= ?
    GROUP BY categoria
    ORDER BY total DESC
  `).all(inicioMes);

  // ── Combustible del mes ───────────────────────────────────
  const combustibleMes = db.prepare(`
    SELECT COALESCE(SUM(litros), 0) AS litros,
           COALESCE(SUM(total),  0) AS importe
    FROM combustible
    WHERE fecha >= ?
  `).get(inicioMes);

  // ── Anticipos pendientes ──────────────────────────────────
  const anticiposPendientes = db.prepare(`
    SELECT COUNT(*)               AS cantidad,
           COALESCE(SUM(importe), 0) AS total
    FROM anticipos
    WHERE liquidado = 0
  `).get();

  // ── Liquidaciones ─────────────────────────────────────────
  const liquidacionesMes = db.prepare(`
    SELECT COUNT(*)                       AS total,
           COALESCE(SUM(importe_neto), 0) AS importe
    FROM liquidaciones
    WHERE fecha_desde >= ?
  `).get(inicioMes);

  // ── Top 5 clientes del mes ────────────────────────────────
  const topClientes = db.prepare(`
    SELECT c.razon_social,
           COUNT(v.id)                   AS viajes,
           COALESCE(SUM(v.importe_flete), 0) AS facturado
    FROM viajes v
    JOIN clientes c ON c.id = v.cliente_id
    WHERE v.fecha >= ? AND v.estado = 'completado'
    GROUP BY c.id
    ORDER BY facturado DESC
    LIMIT 5
  `).all(inicioMes);

  // ── Top 5 choferes del mes ────────────────────────────────
  const topChoferes = db.prepare(`
    SELECT ch.nombre,
           COUNT(v.id)                      AS viajes,
           COALESCE(SUM(v.importe_flete), 0) AS facturado,
           COALESCE(SUM(v.km_reales), 0)     AS km_total
    FROM viajes v
    JOIN choferes ch ON ch.id = v.chofer_id
    WHERE v.fecha >= ? AND v.estado = 'completado'
    GROUP BY ch.id
    ORDER BY facturado DESC
    LIMIT 5
  `).all(inicioMes);

  // ── Evolución de viajes últimos 6 meses ───────────────────
  const evolucionViajes = db.prepare(`
    SELECT strftime('%Y-%m', fecha)       AS mes,
           COUNT(*)                       AS total,
           COALESCE(SUM(importe_flete),0) AS facturado,
           COALESCE(SUM(km_reales),0)     AS km_total
    FROM viajes
    WHERE fecha >= date('now', '-6 months')
      AND estado = 'completado'
    GROUP BY mes
    ORDER BY mes ASC
  `).all();

  // ── Evolución de gastos últimos 6 meses ───────────────────
  const evolucionGastos = db.prepare(`
    SELECT strftime('%Y-%m', fecha)  AS mes,
           COALESCE(SUM(importe), 0) AS total
    FROM gastos
    WHERE fecha >= date('now', '-6 months')
    GROUP BY mes
    ORDER BY mes ASC
  `).all();

  // ── Stock crítico (disponible <= 0) ───────────────────────
  const stockCritico = db.prepare(`
    SELECT p.nombre,
           p.unidad,
           COALESCE(SUM(CASE WHEN s.tipo = 'entrada' THEN s.cantidad ELSE 0 END), 0) -
           COALESCE(SUM(CASE WHEN s.tipo = 'salida'  THEN s.cantidad ELSE 0 END), 0) AS disponible
    FROM productos p
    LEFT JOIN stock s ON s.producto_id = p.id
    WHERE p.activo = 1
    GROUP BY p.id
    HAVING disponible <= 0
    ORDER BY p.nombre ASC
  `).all();

  // ── Viajes recientes (últimos 10) ─────────────────────────
  const viajesRecientes = db.prepare(`
    SELECT v.numero, v.fecha, v.estado,
           v.origen, v.destino,
           v.importe_flete,
           ch.nombre      AS chofer_nombre,
           c.razon_social AS cliente_nombre,
           ve.patente     AS vehiculo_patente
    FROM viajes v
    LEFT JOIN choferes  ch ON ch.id = v.chofer_id
    LEFT JOIN clientes   c ON c.id  = v.cliente_id
    LEFT JOIN vehiculos ve ON ve.id = v.vehiculo_id
    ORDER BY v.fecha DESC, v.id DESC
    LIMIT 10
  `).all();

  res.json({
    ok: true,
    data: {
      periodo: { hoy, inicio_mes: inicioMes },

      viajes: {
        hoy:          viajesHoy.total,
        mes_total:    viajesMes.total,
        mes_facturado: viajesMes.facturado,
        mes_km:       viajesMes.km_total,
        por_estado:   viajesPorEstado,
        recientes:    viajesRecientes,
        evolucion:    evolucionViajes
      },

      choferes: {
        activos:   choferes.total_activos,
        en_ruta:   choferesEnRuta.total
      },

      vehiculos: {
        activos:   vehiculos.total_activos,
        en_ruta:   vehiculosEnRuta.total
      },

      gastos: {
        mes_total:    gastosMes.total,
        mes_cantidad: gastosMes.cantidad,
        por_categoria: gastosPorCategoria,
        evolucion:    evolucionGastos
      },

      combustible: {
        mes_litros:  combustibleMes.litros,
        mes_importe: combustibleMes.importe
      },

      anticipos: {
        pendientes_cantidad: anticiposPendientes.cantidad,
        pendientes_total:    anticiposPendientes.total
      },

      liquidaciones: {
        mes_total:   liquidacionesMes.total,
        mes_importe: liquidacionesMes.importe
      },

      rankings: {
        top_clientes: topClientes,
        top_choferes: topChoferes
      },

      stock_critico: stockCritico
    }
  });
});

// ── GET /api/dashboard/chofer ─────────────────────────────────
// Vista reducida para el rol chofer
router.get('/chofer', (req, res) => {
  if (req.usuario.rol !== 'chofer' && req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Sin acceso' });
  }

  const choferId  = req.usuario.rol === 'chofer' ? req.usuario.id : req.query.chofer_id;
  const inicioMes = new Date().toISOString().substring(0, 7) + '-01';

  const viajesMes = db.prepare(`
    SELECT COUNT(*)                        AS total,
           COALESCE(SUM(importe_flete), 0) AS facturado,
           COALESCE(SUM(km_reales), 0)     AS km_total
    FROM viajes
    WHERE chofer_id = ? AND fecha >= ? AND estado = 'completado'
  `).get(choferId, inicioMes);

  const viajesEnCurso = db.prepare(`
    SELECT v.*,
           c.razon_social AS cliente_nombre,
           ve.patente     AS vehiculo_patente
    FROM viajes v
    LEFT JOIN clientes  c  ON c.id  = v.cliente_id
    LEFT JOIN vehiculos ve ON ve.id = v.vehiculo_id
    WHERE v.chofer_id = ? AND v.estado = 'en_curso'
    ORDER BY v.fecha DESC
  `).all(choferId);

  const gastosMes = db.prepare(`
    SELECT COALESCE(SUM(importe), 0) AS total
    FROM gastos
    WHERE chofer_id = ? AND fecha >= ?
  `).get(choferId, inicioMes);

  const anticiposPendientes = db.prepare(`
    SELECT COALESCE(SUM(importe), 0) AS total
    FROM anticipos
    WHERE chofer_id = ? AND liquidado = 0
  `).get(choferId);

  res.json({
    ok: true,
    data: {
      viajes_mes:          viajesMes,
      viajes_en_curso:     viajesEnCurso,
      gastos_mes:          gastosMes.total,
      anticipos_pendientes: anticiposPendientes.total
    }
  });
});

module.exports = router;

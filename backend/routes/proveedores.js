const express = require('express');
const db      = require('../database/db');
const { verificarToken } = require('../middleware/auth');
const { requierePermiso } = require('../middleware/permisos');

const router = express.Router();

router.use(verificarToken);

// ── GET /api/proveedores ──────────────────────────────────────
router.get('/', (req, res) => {
  const { activo, rubro, buscar } = req.query;

  let query = `SELECT * FROM proveedores WHERE 1=1`;
  const params = [];

  if (activo !== undefined) {
    query += ` AND activo = ?`;
    params.push(activo === 'true' ? 1 : 0);
  }

  if (rubro) {
    query += ` AND rubro = ?`;
    params.push(rubro);
  }

  if (buscar) {
    query += ` AND (razon_social LIKE ? OR cuit LIKE ? OR telefono LIKE ? OR rubro LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b, b, b);
  }

  query += ` ORDER BY razon_social ASC`;

  const proveedores = db.prepare(query).all(...params);
  res.json({ ok: true, data: proveedores });
});

// ── GET /api/proveedores/:id ──────────────────────────────────
router.get('/:id', (req, res) => {
  const proveedor = db.prepare(
    `SELECT * FROM proveedores WHERE id = ?`
  ).get(req.params.id);

  if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado' });

  res.json({ ok: true, data: proveedor });
});

// ── GET /api/proveedores/:id/compras ──────────────────────────
router.get('/:id/compras', (req, res) => {
  const { desde, hasta } = req.query;

  let query = `
    SELECT s.*,
           p.nombre AS producto_nombre,
           p.unidad AS producto_unidad
    FROM stock s
    LEFT JOIN productos p ON p.id = s.producto_id
    WHERE s.proveedor_id = ? AND s.tipo = 'entrada'
  `;
  const params = [req.params.id];

  if (desde) { query += ` AND s.fecha >= ?`; params.push(desde); }
  if (hasta) { query += ` AND s.fecha <= ?`; params.push(hasta); }

  query += ` ORDER BY s.fecha DESC`;

  const compras = db.prepare(query).all(...params);

  const resumen = db.prepare(`
    SELECT COUNT(*)               AS total_operaciones,
           COALESCE(SUM(total),0) AS importe_total
    FROM stock
    WHERE proveedor_id = ? AND tipo = 'entrada'
  `).get(req.params.id);

  res.json({ ok: true, data: compras, resumen });
});

// ── GET /api/proveedores/:id/resumen ──────────────────────────
router.get('/:id/resumen', (req, res) => {
  const id = req.params.id;

  const proveedor = db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(id);
  if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado' });

  const compras = db.prepare(`
    SELECT COUNT(*)               AS total_compras,
           COALESCE(SUM(total),0) AS importe_total
    FROM stock
    WHERE proveedor_id = ? AND tipo = 'entrada'
  `).get(id);

  const productosProveedor = db.prepare(`
    SELECT DISTINCT p.nombre
    FROM stock s
    JOIN productos p ON p.id = s.producto_id
    WHERE s.proveedor_id = ?
  `).all(id);

  res.json({
    ok: true,
    data: {
      proveedor,
      total_compras:  compras.total_compras,
      importe_total:  compras.importe_total,
      productos:      productosProveedor.map(p => p.nombre)
    }
  });
});

// ── GET /api/proveedores/rubros/lista ─────────────────────────
router.get('/rubros/lista', (req, res) => {
  const rubros = db.prepare(`
    SELECT DISTINCT rubro FROM proveedores
    WHERE rubro IS NOT NULL AND rubro != ''
    ORDER BY rubro ASC
  `).all();

  res.json({ ok: true, data: rubros.map(r => r.rubro) });
});

// ── POST /api/proveedores ─────────────────────────────────────
router.post('/', requierePermiso('proveedores', 'crear'), (req, res) => {
  const { razon_social, cuit, telefono, email, rubro } = req.body;

  if (!razon_social) {
    return res.status(400).json({ error: 'La razón social es requerida' });
  }

  if (cuit) {
    const existe = db.prepare(`SELECT id FROM proveedores WHERE cuit = ?`).get(cuit);
    if (existe) {
      return res.status(409).json({ error: `Ya existe un proveedor con CUIT ${cuit}` });
    }
  }

  const result = db.prepare(`
    INSERT INTO proveedores (razon_social, cuit, telefono, email, rubro)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    razon_social.trim(),
    cuit     || null,
    telefono || null,
    email    || null,
    rubro    || null
  );

  const nuevo = db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/proveedores/:id ──────────────────────────────────
router.put('/:id', requierePermiso('proveedores', 'editar'), (req, res) => {
  const { razon_social, cuit, telefono, email, rubro, activo } = req.body;

  const proveedor = db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(req.params.id);
  if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado' });

  if (cuit && cuit !== proveedor.cuit) {
    const existe = db.prepare(
      `SELECT id FROM proveedores WHERE cuit = ? AND id != ?`
    ).get(cuit, req.params.id);
    if (existe) {
      return res.status(409).json({ error: `CUIT ${cuit} ya pertenece a otro proveedor` });
    }
  }

  db.prepare(`
    UPDATE proveedores SET
      razon_social = COALESCE(?, razon_social),
      cuit         = COALESCE(?, cuit),
      telefono     = COALESCE(?, telefono),
      email        = COALESCE(?, email),
      rubro        = COALESCE(?, rubro),
      activo       = COALESCE(?, activo)
    WHERE id = ?
  `).run(
    razon_social, cuit, telefono, email, rubro,
    activo !== undefined ? (activo ? 1 : 0) : null,
    req.params.id
  );

  const actualizado = db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(req.params.id);
  res.json({ ok: true, data: actualizado });
});

// ── DELETE /api/proveedores/:id ───────────────────────────────
router.delete('/:id', requierePermiso('proveedores', 'eliminar'), (req, res) => {
  const proveedor = db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(req.params.id);
  if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado' });

  const tieneStock = db.prepare(
    `SELECT COUNT(*) as total FROM stock WHERE proveedor_id = ?`
  ).get(req.params.id);

  if (tieneStock.total > 0) {
    db.prepare(`UPDATE proveedores SET activo = 0 WHERE id = ?`).run(req.params.id);
    return res.json({ ok: true, mensaje: 'Proveedor desactivado (tiene movimientos de stock asociados)' });
  }

  db.prepare(`DELETE FROM proveedores WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Proveedor eliminado correctamente' });
});

module.exports = router;

const express  = require('express');
const bcrypt   = require('bcryptjs');
const db       = require('../database/db');
const { verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(verificarToken);
router.use(soloAdmin); // Solo admin puede gestionar usuarios

// ── GET /api/usuarios ─────────────────────────────────────────
router.get('/', (req, res) => {
  const { activo, rol, buscar } = req.query;

  let query = `
    SELECT id, nombre, email, rol, activo, creado_en
    FROM usuarios
    WHERE 1=1
  `;
  const params = [];

  if (activo !== undefined) {
    query += ` AND activo = ?`;
    params.push(activo === 'true' ? 1 : 0);
  }

  if (rol) {
    query += ` AND rol = ?`;
    params.push(rol);
  }

  if (buscar) {
    query += ` AND (nombre LIKE ? OR email LIKE ?)`;
    const b = `%${buscar}%`;
    params.push(b, b);
  }

  query += ` ORDER BY nombre ASC`;

  const usuarios = db.prepare(query).all(...params);
  res.json({ ok: true, data: usuarios });
});

// ── GET /api/usuarios/:id ─────────────────────────────────────
router.get('/:id', (req, res) => {
  const usuario = db.prepare(`
    SELECT id, nombre, email, rol, activo, creado_en
    FROM usuarios WHERE id = ?
  `).get(req.params.id);

  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  res.json({ ok: true, data: usuario });
});

// ── POST /api/usuarios ────────────────────────────────────────
router.post('/', (req, res) => {
  const { nombre, email, password, rol } = req.body;

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos' });
  }

  const rolesValidos = ['admin', 'operador', 'chofer'];
  if (rol && !rolesValidos.includes(rol)) {
    return res.status(400).json({
      error: `Rol inválido. Opciones: ${rolesValidos.join(', ')}`
    });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  }

  const existe = db.prepare(
    `SELECT id FROM usuarios WHERE email = ?`
  ).get(email.trim().toLowerCase());

  if (existe) {
    return res.status(409).json({ error: `Ya existe un usuario con email ${email}` });
  }

  const hash = bcrypt.hashSync(password, 10);

  const result = db.prepare(`
    INSERT INTO usuarios (nombre, email, password, rol)
    VALUES (?, ?, ?, ?)
  `).run(
    nombre.trim(),
    email.trim().toLowerCase(),
    hash,
    rol || 'operador'
  );

  const nuevo = db.prepare(`
    SELECT id, nombre, email, rol, activo, creado_en
    FROM usuarios WHERE id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ ok: true, data: nuevo });
});

// ── PUT /api/usuarios/:id ─────────────────────────────────────
router.put('/:id', (req, res) => {
  const usuario = db.prepare(`SELECT * FROM usuarios WHERE id = ?`).get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { nombre, email, rol, activo } = req.body;

  const rolesValidos = ['admin', 'operador', 'chofer'];
  if (rol && !rolesValidos.includes(rol)) {
    return res.status(400).json({
      error: `Rol inválido. Opciones: ${rolesValidos.join(', ')}`
    });
  }

  // Evitar que el admin se quite el rol a sí mismo
  if (String(req.params.id) === String(req.usuario.id) && rol && rol !== 'admin') {
    return res.status(409).json({ error: 'No podés cambiar tu propio rol de administrador' });
  }

  if (email && email.toLowerCase() !== usuario.email) {
    const existe = db.prepare(
      `SELECT id FROM usuarios WHERE email = ? AND id != ?`
    ).get(email.trim().toLowerCase(), req.params.id);
    if (existe) {
      return res.status(409).json({ error: `Email ${email} ya pertenece a otro usuario` });
    }
  }

  db.prepare(`
    UPDATE usuarios SET
      nombre = COALESCE(?, nombre),
      email  = COALESCE(?, email),
      rol    = COALESCE(?, rol),
      activo = COALESCE(?, activo)
    WHERE id = ?
  `).run(
    nombre ? nombre.trim()            : null,
    email  ? email.trim().toLowerCase(): null,
    rol    || null,
    activo !== undefined ? (activo ? 1 : 0) : null,
    req.params.id
  );

  const actualizado = db.prepare(`
    SELECT id, nombre, email, rol, activo, creado_en
    FROM usuarios WHERE id = ?
  `).get(req.params.id);

  res.json({ ok: true, data: actualizado });
});

// ── PATCH /api/usuarios/:id/password ─────────────────────────
router.patch('/:id/password', (req, res) => {
  const { password_nuevo } = req.body;

  if (!password_nuevo || password_nuevo.length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  }

  const usuario = db.prepare(`SELECT id FROM usuarios WHERE id = ?`).get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  const hash = bcrypt.hashSync(password_nuevo, 10);
  db.prepare(`UPDATE usuarios SET password = ? WHERE id = ?`).run(hash, req.params.id);

  res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
});

// ── PATCH /api/usuarios/:id/activar ───────────────────────────
router.patch('/:id/activar', (req, res) => {
  const usuario = db.prepare(`SELECT * FROM usuarios WHERE id = ?`).get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  // No puede desactivarse a sí mismo
  if (String(req.params.id) === String(req.usuario.id)) {
    return res.status(409).json({ error: 'No podés desactivar tu propia cuenta' });
  }

  const nuevoEstado = usuario.activo ? 0 : 1;
  db.prepare(`UPDATE usuarios SET activo = ? WHERE id = ?`).run(nuevoEstado, req.params.id);

  res.json({
    ok: true,
    mensaje: nuevoEstado ? 'Usuario activado' : 'Usuario desactivado'
  });
});

// ── DELETE /api/usuarios/:id ──────────────────────────────────
router.delete('/:id', (req, res) => {
  const usuario = db.prepare(`SELECT * FROM usuarios WHERE id = ?`).get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  // No puede eliminarse a sí mismo
  if (String(req.params.id) === String(req.usuario.id)) {
    return res.status(409).json({ error: 'No podés eliminar tu propia cuenta' });
  }

  // Baja lógica en lugar de eliminar
  db.prepare(`UPDATE usuarios SET activo = 0 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, mensaje: 'Usuario desactivado correctamente' });
});

module.exports = router;

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../database/db');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'fletenet_secret_2024';

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  const usuario = db.prepare(
    `SELECT * FROM usuarios WHERE email = ? AND activo = 1`
  ).get(email.trim().toLowerCase());

  if (!usuario) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const passwordOk = bcrypt.compareSync(password, usuario.password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const token = jwt.sign(
    { id: usuario.id, rol: usuario.rol, nombre: usuario.nombre },
    SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    ok: true,
    token,
    usuario: {
      id:     usuario.id,
      nombre: usuario.nombre,
      email:  usuario.email,
      rol:    usuario.rol
    }
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', verificarToken, (req, res) => {
  const usuario = db.prepare(
    `SELECT id, nombre, email, rol, creado_en FROM usuarios WHERE id = ?`
  ).get(req.usuario.id);

  if (!usuario) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  res.json({ ok: true, usuario });
});

// ── POST /api/auth/cambiar-password ──────────────────────────
router.post('/cambiar-password', verificarToken, (req, res) => {
  const { password_actual, password_nuevo } = req.body;

  if (!password_actual || !password_nuevo) {
    return res.status(400).json({ error: 'Ambas contraseñas son requeridas' });
  }

  if (password_nuevo.length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  }

  const usuario = db.prepare(
    `SELECT * FROM usuarios WHERE id = ?`
  ).get(req.usuario.id);

  const passwordOk = bcrypt.compareSync(password_actual, usuario.password);
  if (!passwordOk) {
    return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
  }

  const nuevoHash = bcrypt.hashSync(password_nuevo, 10);
  db.prepare(
    `UPDATE usuarios SET password = ? WHERE id = ?`
  ).run(nuevoHash, req.usuario.id);

  res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente' });
});

// ── POST /api/auth/logout ─────────────────────────────────────
// JWT es stateless — el logout lo maneja el frontend eliminando el token
router.post('/logout', verificarToken, (req, res) => {
  res.json({ ok: true, mensaje: 'Sesión cerrada' });
});

module.exports = router;

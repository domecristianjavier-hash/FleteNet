const jwt = require('jsonwebtoken');
const db  = require('../database/db');

const SECRET = process.env.JWT_SECRET || 'fletenet_secret_2024';

// ── Verificar token JWT ───────────────────────────────────────
const verificarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, SECRET);

    // Verificar que el usuario sigue activo en la DB
    const usuario = db.prepare(
      `SELECT id, nombre, email, rol, activo FROM usuarios WHERE id = ?`
    ).get(decoded.id);

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ error: 'Usuario inactivo o no encontrado' });
    }

    req.usuario = usuario;
    next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado, iniciá sesión nuevamente' });
    }
    return res.status(403).json({ error: 'Token inválido' });
  }
};

// ── Solo Admin ────────────────────────────────────────────────
const soloAdmin = (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso restringido a administradores' });
  }
  next();
};

// ── Admin u Operador ──────────────────────────────────────────
const adminOOperador = (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (!['admin', 'operador'].includes(req.usuario.rol)) {
    return res.status(403).json({ error: 'Sin permisos suficientes' });
  }
  next();
};

module.exports = { verificarToken, soloAdmin, adminOOperador };

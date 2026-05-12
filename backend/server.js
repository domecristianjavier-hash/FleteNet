require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares globales ──────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Archivos estáticos (frontend) ─────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Rutas API ─────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/viajes',        require('./routes/viajes'));
app.use('/api/choferes',      require('./routes/choferes'));
app.use('/api/vehiculos',     require('./routes/vehiculos'));
app.use('/api/clientes',      require('./routes/clientes'));
app.use('/api/proveedores',   require('./routes/proveedores'));
app.use('/api/productos',     require('./routes/productos'));
app.use('/api/gastos',        require('./routes/gastos'));
app.use('/api/combustible',   require('./routes/combustible'));
app.use('/api/anticipos',     require('./routes/anticipos'));
app.use('/api/liquidaciones', require('./routes/liquidaciones'));
app.use('/api/stock',         require('./routes/stock'));
app.use('/api/dashboard',     require('./routes/dashboard'));
app.use('/api/usuarios',      require('./routes/usuarios'));

// ── Ruta raíz → login ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

// ── Catch-all: SPA fallback ───────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Ruta no encontrada' });
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Manejo global de errores ──────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor'
  });
});

// ── Iniciar servidor ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════╗');
  console.log('║        FleteNet - Iniciado         ║');
  console.log(`║   http://localhost:${PORT}           ║`);
  console.log('╚════════════════════════════════════╝');
  console.log('');
});

module.exports = app;

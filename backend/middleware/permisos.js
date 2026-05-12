// ── Permisos por rol y recurso ────────────────────────────────
//
//  admin    → acceso total
//  operador → puede leer y escribir, no puede eliminar usuarios
//             ni cambiar roles
//  chofer   → solo lectura de sus propios viajes y gastos
// ─────────────────────────────────────────────────────────────

const PERMISOS = {
  admin: {
    viajes:        ['leer', 'crear', 'editar', 'eliminar'],
    choferes:      ['leer', 'crear', 'editar', 'eliminar'],
    vehiculos:     ['leer', 'crear', 'editar', 'eliminar'],
    clientes:      ['leer', 'crear', 'editar', 'eliminar'],
    proveedores:   ['leer', 'crear', 'editar', 'eliminar'],
    productos:     ['leer', 'crear', 'editar', 'eliminar'],
    gastos:        ['leer', 'crear', 'editar', 'eliminar'],
    combustible:   ['leer', 'crear', 'editar', 'eliminar'],
    anticipos:     ['leer', 'crear', 'editar', 'eliminar'],
    liquidaciones: ['leer', 'crear', 'editar', 'eliminar'],
    stock:         ['leer', 'crear', 'editar', 'eliminar'],
    usuarios:      ['leer', 'crear', 'editar', 'eliminar'],
    dashboard:     ['leer'],
  },
  operador: {
    viajes:        ['leer', 'crear', 'editar'],
    choferes:      ['leer', 'crear', 'editar'],
    vehiculos:     ['leer', 'crear', 'editar'],
    clientes:      ['leer', 'crear', 'editar'],
    proveedores:   ['leer', 'crear', 'editar'],
    productos:     ['leer', 'crear', 'editar'],
    gastos:        ['leer', 'crear', 'editar'],
    combustible:   ['leer', 'crear', 'editar'],
    anticipos:     ['leer', 'crear', 'editar'],
    liquidaciones: ['leer', 'crear'],
    stock:         ['leer', 'crear', 'editar'],
    usuarios:      [],
    dashboard:     ['leer'],
  },
  chofer: {
    viajes:        ['leer'],
    gastos:        ['leer', 'crear'],
    combustible:   ['leer', 'crear'],
    anticipos:     ['leer'],
    liquidaciones: ['leer'],
    dashboard:     [],
    choferes:      [],
    vehiculos:     [],
    clientes:      [],
    proveedores:   [],
    productos:     [],
    stock:         [],
    usuarios:      [],
  }
};

// ── Factory: verificar permiso específico ─────────────────────
const requierePermiso = (recurso, accion) => {
  return (req, res, next) => {
    const rol = req.usuario?.rol;

    if (!rol) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    const permisosRol = PERMISOS[rol];
    if (!permisosRol) {
      return res.status(403).json({ error: `Rol desconocido: ${rol}` });
    }

    const permisosRecurso = permisosRol[recurso] || [];
    if (!permisosRecurso.includes(accion)) {
      return res.status(403).json({
        error: `Sin permiso para "${accion}" en "${recurso}"`
      });
    }

    next();
  };
};

// ── Verificar si el chofer solo accede a sus propios datos ────
const soloSuyos = (campoId = 'chofer_id') => {
  return (req, res, next) => {
    if (req.usuario.rol === 'admin' || req.usuario.rol === 'operador') {
      return next(); // admin y operador ven todo
    }

    // Para chofer: el id del recurso debe coincidir con su usuario
    const idRecurso = req.params[campoId] || req.body[campoId];
    if (String(idRecurso) !== String(req.usuario.id)) {
      return res.status(403).json({
        error: 'Solo podés acceder a tus propios datos'
      });
    }

    next();
  };
};

module.exports = { requierePermiso, PERMISOS, soloSuyos };

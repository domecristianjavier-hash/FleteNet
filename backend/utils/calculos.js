// ══════════════════════════════════════════════════════════════
//  FleteNet — Utilidades de cálculo
// ══════════════════════════════════════════════════════════════

// ── Redondear a N decimales ───────────────────────────────────
const redondear = (valor, decimales = 2) => {
  return Math.round(Number(valor) * Math.pow(10, decimales)) / Math.pow(10, decimales);
};

// ── Formatear moneda ARS ──────────────────────────────────────
const formatearMoneda = (valor, simbolo = '$') => {
  if (valor === null || valor === undefined || isNaN(valor)) return `${simbolo} 0,00`;
  return `${simbolo} ${Number(valor).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};

// ── Formatear número con separadores ─────────────────────────
const formatearNumero = (valor, decimales = 2) => {
  if (valor === null || valor === undefined || isNaN(valor)) return '0';
  return Number(valor).toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  });
};

// ── Calcular liquidación de chofer ────────────────────────────
/**
 * @param {number} totalFletes    - Suma de importe_flete de los viajes
 * @param {number} porcentaje     - % que corresponde al chofer (ej: 30)
 * @param {number} totalAnticipos - Anticipos pendientes a descontar
 * @param {number} totalGastos    - Gastos del período a descontar
 * @returns {object}
 */
const calcularLiquidacion = (totalFletes, porcentaje, totalAnticipos = 0, totalGastos = 0) => {
  const importeBruto  = redondear((totalFletes * porcentaje) / 100);
  const descuentos    = redondear(totalAnticipos + totalGastos);
  const importeNeto   = redondear(importeBruto - descuentos);

  return {
    total_fletes:    redondear(totalFletes),
    porcentaje,
    importe_bruto:   importeBruto,
    total_anticipos: redondear(totalAnticipos),
    total_gastos:    redondear(totalGastos),
    descuentos,
    importe_neto:    importeNeto
  };
};

// ── Calcular consumo de combustible ───────────────────────────
/**
 * @param {number} litros   - Litros cargados
 * @param {number} km       - Kilómetros recorridos
 * @returns {number|null}   - Litros cada 100 km
 */
const calcularConsumoCombustible = (litros, km) => {
  if (!litros || !km || km === 0) return null;
  return redondear((litros / km) * 100);
};

// ── Calcular costo por km ─────────────────────────────────────
/**
 * @param {number} totalGastos - Total de gastos del viaje
 * @param {number} km          - Kilómetros recorridos
 * @returns {number|null}
 */
const calcularCostoPorKm = (totalGastos, km) => {
  if (!totalGastos || !km || km === 0) return null;
  return redondear(totalGastos / km);
};

// ── Calcular rentabilidad de un viaje ─────────────────────────
/**
 * @param {number} importe_flete  - Lo que cobra el cliente
 * @param {number} gastos_viaje   - Gastos asociados al viaje
 * @param {number} porcentaje_chofer - % para el chofer
 * @returns {object}
 */
const calcularRentabilidadViaje = (importe_flete, gastos_viaje = 0, porcentaje_chofer = 0) => {
  const costo_chofer    = redondear((importe_flete * porcentaje_chofer) / 100);
  const costo_total     = redondear(gastos_viaje + costo_chofer);
  const ganancia_bruta  = redondear(importe_flete - gastos_viaje);
  const ganancia_neta   = redondear(importe_flete - costo_total);
  const margen          = importe_flete > 0
    ? redondear((ganancia_neta / importe_flete) * 100)
    : 0;

  return {
    importe_flete:   redondear(importe_flete),
    gastos_viaje:    redondear(gastos_viaje),
    costo_chofer,
    costo_total,
    ganancia_bruta,
    ganancia_neta,
    margen_porcentaje: margen
  };
};

// ── Calcular precio promedio de combustible ───────────────────
/**
 * @param {Array} cargas - Array de { litros, total }
 * @returns {number}
 */
const calcularPrecioProm = (cargas = []) => {
  const totalLitros  = cargas.reduce((sum, c) => sum + Number(c.litros), 0);
  const totalImporte = cargas.reduce((sum, c) => sum + Number(c.total),  0);
  if (totalLitros === 0) return 0;
  return redondear(totalImporte / totalLitros);
};

// ── Calcular totales de un período ───────────────────────────
/**
 * @param {Array} viajes - Array de viajes con importe_flete y km_reales
 * @returns {object}
 */
const calcularTotalesPeriodo = (viajes = []) => {
  return {
    cantidad:        viajes.length,
    importe_total:   redondear(viajes.reduce((s, v) => s + Number(v.importe_flete || 0), 0)),
    km_total:        redondear(viajes.reduce((s, v) => s + Number(v.km_reales || 0), 0)),
    promedio_flete:  viajes.length > 0
      ? redondear(viajes.reduce((s, v) => s + Number(v.importe_flete || 0), 0) / viajes.length)
      : 0
  };
};

// ── Validar rango de fechas ───────────────────────────────────
const validarRangoFechas = (desde, hasta) => {
  if (!desde || !hasta) return { ok: false, error: 'Fechas requeridas' };
  const d = new Date(desde);
  const h = new Date(hasta);
  if (isNaN(d.getTime()) || isNaN(h.getTime())) {
    return { ok: false, error: 'Fechas inválidas' };
  }
  if (d > h) {
    return { ok: false, error: 'La fecha desde debe ser anterior a la fecha hasta' };
  }
  const diffMs   = h - d;
  const diffDias = diffMs / (1000 * 60 * 60 * 24);
  if (diffDias > 365) {
    return { ok: false, error: 'El rango no puede superar 365 días' };
  }
  return { ok: true };
};

// ── Obtener primer y último día del mes actual ────────────────
const getMesActual = () => {
  const hoy     = new Date();
  const anio    = hoy.getFullYear();
  const mes     = String(hoy.getMonth() + 1).padStart(2, '0');
  const ultimo  = new Date(anio, hoy.getMonth() + 1, 0).getDate();
  return {
    desde: `${anio}-${mes}-01`,
    hasta: `${anio}-${mes}-${ultimo}`
  };
};

// ── Obtener primer y último día de la semana actual ───────────
const getSemanaActual = () => {
  const hoy    = new Date();
  const dia    = hoy.getDay(); // 0=dom
  const lunes  = new Date(hoy);
  lunes.setDate(hoy.getDate() - (dia === 0 ? 6 : dia - 1));
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);

  const fmt = (d) => d.toISOString().split('T')[0];
  return { desde: fmt(lunes), hasta: fmt(domingo) };
};

module.exports = {
  redondear,
  formatearMoneda,
  formatearNumero,
  calcularLiquidacion,
  calcularConsumoCombustible,
  calcularCostoPorKm,
  calcularRentabilidadViaje,
  calcularPrecioProm,
  calcularTotalesPeriodo,
  validarRangoFechas,
  getMesActual,
  getSemanaActual
};

// ══════════════════════════════════════════════════════════════
//  FleteNet — Generación de PDFs con PDFKit
// ══════════════════════════════════════════════════════════════
const PDFDocument = require('pdfkit');

// ── Colores y estilos ─────────────────────────────────────────
const COLORES = {
  primario:    '#1a56db',
  secundario:  '#374151',
  acento:      '#f3f4f6',
  texto:       '#111827',
  textoClaro:  '#6b7280',
  borde:       '#e5e7eb',
  exito:       '#059669',
  alerta:      '#d97706'
};

const FUENTE = {
  titulo:    18,
  subtitulo: 13,
  normal:    10,
  pequeño:   8
};

// ── Helper: nueva página con encabezado ───────────────────────
const agregarEncabezado = (doc, titulo, subtitulo = '') => {
  // Banda de color superior
  doc.rect(0, 0, doc.page.width, 55).fill(COLORES.primario);

  // Logo / nombre sistema
  doc.fontSize(16)
     .fillColor('#ffffff')
     .font('Helvetica-Bold')
     .text('FleteNet', 40, 15);

  doc.fontSize(FUENTE.pequeño)
     .fillColor('#bfdbfe')
     .font('Helvetica')
     .text('Sistema de Gestión de Fletes', 40, 34);

  // Título del documento
  doc.fontSize(FUENTE.titulo)
     .fillColor(COLORES.texto)
     .font('Helvetica-Bold')
     .text(titulo, 40, 70);

  if (subtitulo) {
    doc.fontSize(FUENTE.normal)
       .fillColor(COLORES.textoClaro)
       .font('Helvetica')
       .text(subtitulo, 40, 92);
  }

  // Fecha de emisión
  const fecha = new Date().toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  doc.fontSize(FUENTE.pequeño)
     .fillColor(COLORES.textoClaro)
     .text(`Emitido: ${fecha}`, 40, subtitulo ? 108 : 92, { align: 'right' });

  // Línea separadora
  doc.moveTo(40, 120).lineTo(doc.page.width - 40, 120)
     .strokeColor(COLORES.borde).lineWidth(1).stroke();

  return 135; // y inicial para el contenido
};

// ── Helper: pie de página ─────────────────────────────────────
const agregarPie = (doc) => {
  const y = doc.page.height - 40;
  doc.moveTo(40, y - 8).lineTo(doc.page.width - 40, y - 8)
     .strokeColor(COLORES.borde).lineWidth(0.5).stroke();

  doc.fontSize(FUENTE.pequeño)
     .fillColor(COLORES.textoClaro)
     .text('FleteNet — Sistema de Gestión de Fletes', 40, y, { align: 'left' })
     .text(`Página ${doc.bufferedPageRange().start + 1}`, 40, y, { align: 'right' });
};

// ── Helper: tabla ─────────────────────────────────────────────
const dibujarTabla = (doc, y, columnas, filas, opciones = {}) => {
  const margenIzq  = opciones.margenIzq  || 40;
  const anchoTotal = opciones.anchoTotal || doc.page.width - 80;
  const alturaFila = opciones.alturaFila || 20;
  const colorCabecera = opciones.colorCabecera || COLORES.primario;

  // Calcular anchos
  const anchos = columnas.map(col =>
    col.ancho ? (col.ancho / 100) * anchoTotal : anchoTotal / columnas.length
  );

  // Cabecera
  doc.rect(margenIzq, y, anchoTotal, alturaFila + 2).fill(colorCabecera);
  let x = margenIzq;
  columnas.forEach((col, i) => {
    doc.fontSize(FUENTE.pequeño)
       .fillColor('#ffffff')
       .font('Helvetica-Bold')
       .text(col.titulo, x + 4, y + 5, {
         width: anchos[i] - 8,
         align: col.alinear || 'left'
       });
    x += anchos[i];
  });
  y += alturaFila + 2;

  // Filas
  filas.forEach((fila, idxFila) => {
    // Verificar si necesita nueva página
    if (y + alturaFila > doc.page.height - 60) {
      agregarPie(doc);
      doc.addPage();
      y = agregarEncabezado(doc, opciones.tituloContinuacion || 'Continuación...', '');
    }

    // Fondo alternado
    if (idxFila % 2 === 0) {
      doc.rect(margenIzq, y, anchoTotal, alturaFila).fill(COLORES.acento);
    }

    x = margenIzq;
    columnas.forEach((col, i) => {
      const valor = fila[col.campo] !== undefined && fila[col.campo] !== null
        ? String(fila[col.campo])
        : '-';

      doc.fontSize(FUENTE.pequeño)
         .fillColor(COLORES.texto)
         .font('Helvetica')
         .text(valor, x + 4, y + 5, {
           width: anchos[i] - 8,
           align: col.alinear || 'left'
         });
      x += anchos[i];
    });

    // Borde inferior de fila
    doc.moveTo(margenIzq, y + alturaFila)
       .lineTo(margenIzq + anchoTotal, y + alturaFila)
       .strokeColor(COLORES.borde).lineWidth(0.3).stroke();

    y += alturaFila;
  });

  return y + 10;
};

// ── Helper: caja de datos ─────────────────────────────────────
const dibujarCaja = (doc, y, titulo, datos, opciones = {}) => {
  const margenIzq  = opciones.margenIzq || 40;
  const ancho      = opciones.ancho     || doc.page.width - 80;

  doc.rect(margenIzq, y, ancho, 18).fill(COLORES.acento);
  doc.fontSize(FUENTE.normal)
     .fillColor(COLORES.secundario)
     .font('Helvetica-Bold')
     .text(titulo, margenIzq + 6, y + 4);
  y += 22;

  datos.forEach(([etiqueta, valor]) => {
    doc.fontSize(FUENTE.normal)
       .fillColor(COLORES.textoClaro)
       .font('Helvetica')
       .text(etiqueta + ':', margenIzq + 6, y, { width: 160 });

    doc.fontSize(FUENTE.normal)
       .fillColor(COLORES.texto)
       .font('Helvetica-Bold')
       .text(String(valor || '-'), margenIzq + 170, y, { width: ancho - 180 });

    y += 16;
  });

  return y + 8;
};

// ══════════════════════════════════════════════════════════════
//  DOCUMENTOS
// ══════════════════════════════════════════════════════════════

// ── PDF: Liquidación de chofer ────────────────────────────────
const generarPDFLiquidacion = (liquidacion) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];

    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', err   => reject(err));

    let y = agregarEncabezado(
      doc,
      `Liquidación ${liquidacion.numero}`,
      `Período: ${liquidacion.fecha_desde} al ${liquidacion.fecha_hasta}`
    );

    // Datos del chofer
    y = dibujarCaja(doc, y, 'DATOS DEL CHOFER', [
      ['Nombre',    liquidacion.chofer_nombre],
      ['DNI',       liquidacion.chofer_dni],
      ['Teléfono',  liquidacion.chofer_telefono],
      ['Estado',    liquidacion.estado.toUpperCase()]
    ]);

    y += 10;

    // Resumen financiero
    y = dibujarCaja(doc, y, 'RESUMEN FINANCIERO', [
      ['Total Fletes',    `$ ${Number(liquidacion.total_fletes).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`],
      ['Porcentaje',      `${liquidacion.porcentaje}%`],
      ['Importe Bruto',   `$ ${Number(liquidacion.importe_bruto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`],
      ['Total Anticipos', `$ ${Number(liquidacion.total_anticipos).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`],
      ['Total Gastos',    `$ ${Number(liquidacion.total_gastos).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`],
      ['IMPORTE NETO',    `$ ${Number(liquidacion.importe_neto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`]
    ]);

    y += 10;

    // Tabla de viajes
    if (liquidacion.viajes && liquidacion.viajes.length > 0) {
      doc.fontSize(FUENTE.subtitulo)
         .fillColor(COLORES.secundario)
         .font('Helvetica-Bold')
         .text('VIAJES INCLUIDOS', 40, y);
      y += 16;

      y = dibujarTabla(doc, y, [
        { titulo: 'Nro',      campo: 'numero',         ancho: 10 },
        { titulo: 'Fecha',    campo: 'fecha',           ancho: 12 },
        { titulo: 'Origen',   campo: 'origen',          ancho: 18 },
        { titulo: 'Destino',  campo: 'destino',         ancho: 18 },
        { titulo: 'Cliente',  campo: 'cliente_nombre',  ancho: 22 },
        { titulo: 'KM',       campo: 'km_reales',       ancho: 8,  alinear: 'right' },
        { titulo: 'Importe',  campo: 'importe_flete',   ancho: 12, alinear: 'right' }
      ], liquidacion.viajes, {
        tituloContinuacion: `Liquidación ${liquidacion.numero} — Viajes`
      });
    }

    // Observaciones
    if (liquidacion.observaciones) {
      y += 6;
      doc.fontSize(FUENTE.normal)
         .fillColor(COLORES.textoClaro)
         .font('Helvetica-Bold')
         .text('Observaciones:', 40, y);
      y += 14;
      doc.fontSize(FUENTE.normal)
         .fillColor(COLORES.texto)
         .font('Helvetica')
         .text(liquidacion.observaciones, 40, y, { width: doc.page.width - 80 });
    }

    agregarPie(doc);
    doc.end();
  });
};

// ── PDF: Resumen de viaje ─────────────────────────────────────
const generarPDFViaje = (viaje) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];

    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', err   => reject(err));

    let y = agregarEncabezado(
      doc,
      `Viaje ${viaje.numero}`,
      `Fecha: ${viaje.fecha} — Estado: ${viaje.estado.toUpperCase()}`
    );

    y = dibujarCaja(doc, y, 'DATOS DEL VIAJE', [
      ['Origen',    viaje.origen],
      ['Destino',   viaje.destino],
      ['Cliente',   viaje.cliente_nombre],
      ['Producto',  `${viaje.producto_nombre || '-'} (${viaje.producto_unidad || ''})`],
      ['Peso',      viaje.peso_carga ? `${viaje.peso_carga} kg` : '-'],
      ['KM Est.',   viaje.km_estimados || '-'],
      ['KM Reales', viaje.km_reales    || '-']
    ]);

    y += 6;

    y = dibujarCaja(doc, y, 'CHOFER Y VEHÍCULO', [
      ['Chofer',    viaje.chofer_nombre],
      ['DNI',       viaje.chofer_dni],
      ['Vehículo',  `${viaje.vehiculo_marca || ''} ${viaje.vehiculo_modelo || ''} — ${viaje.vehiculo_patente || ''}`]
    ]);

    y += 6;

    y = dibujarCaja(doc, y, 'FINANCIERO', [
      ['Tarifa',         viaje.tarifa        ? `$ ${Number(viaje.tarifa).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '-'],
      ['Importe Flete',  viaje.importe_flete ? `$ ${Number(viaje.importe_flete).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '-']
    ]);

    y += 10;

    // Gastos del viaje
    if (viaje.gastos && viaje.gastos.length > 0) {
      doc.fontSize(FUENTE.subtitulo)
         .fillColor(COLORES.secundario)
         .font('Helvetica-Bold')
         .text('GASTOS DEL VIAJE', 40, y);
      y += 16;

      y = dibujarTabla(doc, y, [
        { titulo: 'Fecha',      campo: 'fecha',       ancho: 15 },
        { titulo: 'Categoría',  campo: 'categoria',   ancho: 20 },
        { titulo: 'Descripción',campo: 'descripcion', ancho: 45 },
        { titulo: 'Importe',    campo: 'importe',     ancho: 20, alinear: 'right' }
      ], viaje.gastos);
    }

    // Combustible del viaje
    if (viaje.combustible && viaje.combustible.length > 0) {
      y += 6;
      doc.fontSize(FUENTE.subtitulo)
         .fillColor(COLORES.secundario)
         .font('Helvetica-Bold')
         .text('COMBUSTIBLE', 40, y);
      y += 16;

      y = dibujarTabla(doc, y, [
        { titulo: 'Fecha',        campo: 'fecha',        ancho: 18 },
        { titulo: 'Estación',     campo: 'estacion',     ancho: 30 },
        { titulo: 'Litros',       campo: 'litros',       ancho: 17, alinear: 'right' },
        { titulo: 'Precio/Lt',    campo: 'precio_litro', ancho: 17, alinear: 'right' },
        { titulo: 'Total',        campo: 'total',        ancho: 18, alinear: 'right' }
      ], viaje.combustible);
    }

    if (viaje.observaciones) {
      y += 6;
      doc.fontSize(FUENTE.normal)
         .fillColor(COLORES.textoClaro)
         .font('Helvetica-Bold')
         .text('Observaciones:', 40, y);
      y += 14;
      doc.fontSize(FUENTE.normal)
         .fillColor(COLORES.texto)
         .font('Helvetica')
         .text(viaje.observaciones, 40, y, { width: doc.page.width - 80 });
    }

    agregarPie(doc);
    doc.end();
  });
};

// ── PDF: Reporte de gastos ────────────────────────────────────
const generarPDFGastos = (gastos, filtros = {}) => {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];

    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', err   => reject(err));

    const subtitulo = filtros.desde && filtros.hasta
      ? `Período: ${filtros.desde} al ${filtros.hasta}`
      : 'Todos los registros';

    let y = agregarEncabezado(doc, 'Reporte de Gastos', subtitulo);

    // Total general
    const totalGeneral = gastos.reduce((s, g) => s + Number(g.importe || 0), 0);
    doc.fontSize(FUENTE.subtitulo)
       .fillColor(COLORES.primario)
       .font('Helvetica-Bold')
       .text(
         `Total: $ ${totalGeneral.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`,
         40, y
       );
    y += 22;

    y = dibujarTabla(doc, y, [
      { titulo: 'Fecha',      campo: 'fecha',          ancho: 13 },
      { titulo: 'Categoría',  campo: 'categoria',      ancho: 15 },
      { titulo: 'Chofer',     campo: 'chofer_nombre',  ancho: 20 },
      { titulo: 'Viaje',      campo: 'viaje_numero',   ancho: 12 },
      { titulo: 'Descripción',campo: 'descripcion',    ancho: 25 },
      { titulo: 'Importe',    campo: 'importe',        ancho: 15, alinear: 'right' }
    ], gastos, {
      tituloContinuacion: 'Reporte de Gastos — Continuación'
    });

    agregarPie(doc);
    doc.end();
  });
};

module.exports = {
  generarPDFLiquidacion,
  generarPDFViaje,
  generarPDFGastos
};

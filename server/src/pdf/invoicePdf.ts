/**
 * Generación del PDF del comprobante.
 *
 * Incluye los datos obligatorios verificables (emisor, receptor, detalle, totales,
 * CAE, vencimiento del CAE y el código QR de la R.G. 4892). Ver docs/ARCA.md §7:
 * el diseño del impreso tiene requisitos formales adicionales que conviene que
 * valide un contador antes de usarlo en producción.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  CBTE_TIPO_LABEL,
  CONCEPTO_LABEL,
  CONDICION_EMISOR_LABEL,
  DOC_TIPO_LABEL,
  alicuotaPorId,
  condicionReceptorPorId,
  discriminaIva,
  letraDeComprobante,
} from '../domain/catalogs.js';
import { fromArcaDate } from '../domain/dates.js';
import { formatCuit } from '../lib/cuit.js';
import { centsToDisplay } from '../lib/money.js';
import type { InvoiceRow } from '../services/invoices.js';
import type { PublicIssuer } from '../services/issuers.js';
import { buildQrUrl } from './qr.js';

interface ItemPdf {
  descripcion: string;
  cantidadMilli: number;
  precioUnitarioCents: number;
  netoCents: number;
  ivaCents: number;
  subtotalCents: number;
  rateBps: number;
  ivaId: number;
}

interface AlicuotaPdf {
  id: number;
  rateBps: number;
  baseImpCents: number;
  importeCents: number;
}

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const MARGIN = 40;

export async function generarPdf(invoice: InvoiceRow, issuer: PublicIssuer): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const items = JSON.parse(invoice.items) as ItemPdf[];
  const alicuotas = JSON.parse(invoice.alicuotas) as AlicuotaPdf[];
  const letra = letraDeComprobante(invoice.cbte_tipo);
  const discrimina = discriminaIva(invoice.cbte_tipo);
  const width = doc.page.width - MARGIN * 2;

  drawHeader(doc, invoice, issuer, letra, width);
  let y = 200;
  y = drawParties(doc, invoice, issuer, y, width);
  y = drawItems(doc, items, y, width, discrimina);
  y = drawTotals(doc, invoice, alicuotas, y, width, discrimina);
  await drawFooter(doc, invoice, issuer, width);

  doc.end();
  return done;
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  invoice: InvoiceRow,
  issuer: PublicIssuer,
  letra: string,
  width: number,
): void {
  const half = width / 2 - 20;

  // Recuadro con la letra del comprobante, centrado sobre la línea divisoria.
  doc.rect(MARGIN, MARGIN, width, 130).lineWidth(1).stroke(LINE);
  doc.moveTo(MARGIN + width / 2, MARGIN).lineTo(MARGIN + width / 2, MARGIN + 130).stroke(LINE);

  const boxW = 52;
  const boxX = MARGIN + width / 2 - boxW / 2;
  doc.rect(boxX, MARGIN - 12, boxW, 52).fillAndStroke('#ffffff', LINE);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(30).text(letra, boxX, MARGIN + 2, {
    width: boxW,
    align: 'center',
  });
  doc.font('Helvetica').fontSize(6).fillColor(MUTED).text(
    `COD. ${String(invoice.cbte_tipo).padStart(3, '0')}`,
    boxX,
    MARGIN + 34,
    { width: boxW, align: 'center' },
  );

  // Emisor.
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(issuer.razonSocial, MARGIN + 16, MARGIN + 50, {
    width: half,
  });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  const emisorLineas = [
    issuer.domicilio,
    `Condición frente al IVA: ${CONDICION_EMISOR_LABEL[issuer.condicionIva] ?? issuer.condicionIva}`,
    issuer.ingresosBrutos ? `Ingresos Brutos: ${issuer.ingresosBrutos}` : '',
    issuer.inicioActividades ? `Inicio de actividades: ${issuer.inicioActividades}` : '',
  ].filter(Boolean);
  doc.text(emisorLineas.join('\n'), MARGIN + 16, doc.y + 2, { width: half });

  // Comprobante.
  const rightX = MARGIN + width / 2 + 16;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(
    CBTE_TIPO_LABEL[invoice.cbte_tipo] ?? `Comprobante ${invoice.cbte_tipo}`,
    rightX,
    MARGIN + 50,
    { width: half },
  );
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  const numero =
    invoice.cbte_nro === null
      ? 'sin número'
      : `${String(invoice.punto_venta).padStart(5, '0')}-${String(invoice.cbte_nro).padStart(8, '0')}`;
  doc.text(`N° ${numero}`, rightX, doc.y + 4, { width: half });
  doc.fontSize(8).fillColor(MUTED);
  doc.text(`Fecha de emisión: ${fromArcaDate(invoice.cbte_fecha)}`, rightX, doc.y + 2, { width: half });
  doc.text(`CUIT: ${formatCuit(issuer.cuit)}`, rightX, doc.y + 1, { width: half });
  doc.text(`Concepto: ${CONCEPTO_LABEL[invoice.concepto] ?? invoice.concepto}`, rightX, doc.y + 1, {
    width: half,
  });

  if (invoice.fch_serv_desde && invoice.fch_serv_hasta) {
    doc.text(
      `Período: ${fromArcaDate(invoice.fch_serv_desde)} a ${fromArcaDate(invoice.fch_serv_hasta)}`,
      rightX,
      doc.y + 1,
      { width: half },
    );
  }
  if (invoice.fch_vto_pago) {
    doc.text(`Vencimiento de pago: ${fromArcaDate(invoice.fch_vto_pago)}`, rightX, doc.y + 1, {
      width: half,
    });
  }

  if (invoice.environment !== 'produccion') {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#b91c1c')
      .text('COMPROBANTE EMITIDO EN HOMOLOGACIÓN — SIN VALIDEZ FISCAL', MARGIN, MARGIN + 136, {
        width,
        align: 'center',
      });
  }
}

function drawParties(
  doc: PDFKit.PDFDocument,
  invoice: InvoiceRow,
  _issuer: PublicIssuer,
  y: number,
  width: number,
): number {
  const condicion = condicionReceptorPorId(invoice.condicion_iva_receptor_id);
  doc.rect(MARGIN, y, width, 58).stroke(LINE);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7).text('CLIENTE', MARGIN + 10, y + 8);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(invoice.cliente_nombre, MARGIN + 10, y + 19, {
    width: width - 20,
  });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);

  const docLabel = DOC_TIPO_LABEL[invoice.doc_tipo] ?? 'Documento';
  const docValue =
    invoice.doc_tipo === 80 || invoice.doc_tipo === 86
      ? formatCuit(invoice.doc_nro)
      : invoice.doc_nro || '—';
  const detalle = [
    `${docLabel}: ${docValue}`,
    `Condición frente al IVA: ${condicion?.label ?? invoice.condicion_iva_receptor_id}`,
    invoice.cliente_domicilio ? `Domicilio: ${invoice.cliente_domicilio}` : '',
  ].filter(Boolean);
  doc.text(detalle.join('   ·   '), MARGIN + 10, y + 36, { width: width - 20 });

  return y + 74;
}

function drawItems(
  doc: PDFKit.PDFDocument,
  items: ItemPdf[],
  y: number,
  width: number,
  discrimina: boolean,
): number {
  // Columnas: descripción / cantidad / precio unit. / [alícuota] / subtotal.
  const cols = discrimina
    ? [{ w: 0.44 }, { w: 0.12 }, { w: 0.18 }, { w: 0.11 }, { w: 0.15 }]
    : [{ w: 0.52 }, { w: 0.13 }, { w: 0.2 }, { w: 0 }, { w: 0.15 }];
  const xs: number[] = [];
  let acc = MARGIN;
  for (const c of cols) {
    xs.push(acc);
    acc += c.w * width;
  }
  const headers = discrimina
    ? ['Descripción', 'Cantidad', 'Precio unit.', 'IVA', 'Subtotal']
    : ['Descripción', 'Cantidad', 'Precio unit.', '', 'Importe'];

  doc.rect(MARGIN, y, width, 20).fill('#f3f4f6');
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7.5);
  headers.forEach((h, i) => {
    if (h === '') return;
    doc.text(h.toUpperCase(), xs[i]! + 6, y + 6.5, {
      width: cols[i]!.w * width - 12,
      align: i === 0 ? 'left' : 'right',
    });
  });

  y += 20;
  doc.font('Helvetica').fontSize(8.5);

  for (const item of items) {
    // Salto de página si el ítem no entra.
    if (y > doc.page.height - 260) {
      doc.addPage();
      y = MARGIN;
    }
    const cantidad = (item.cantidadMilli / 1000).toLocaleString('es-AR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
    const alic = alicuotaPorId(item.ivaId);
    const cells = [
      item.descripcion,
      cantidad,
      centsToDisplay(item.precioUnitarioCents),
      discrimina ? (alic?.label ?? '') : '',
      centsToDisplay(discrimina ? item.netoCents : item.subtotalCents),
    ];

    const alturaTexto = doc.heightOfString(item.descripcion, { width: cols[0]!.w * width - 12 });
    const rowH = Math.max(18, alturaTexto + 8);

    doc.fillColor(INK);
    cells.forEach((c, i) => {
      if (c === '') return;
      doc.text(c, xs[i]! + 6, y + 5, {
        width: cols[i]!.w * width - 12,
        align: i === 0 ? 'left' : 'right',
      });
    });
    y += rowH;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + width, y).lineWidth(0.5).stroke(LINE);
  }

  return y + 14;
}

function drawTotals(
  doc: PDFKit.PDFDocument,
  invoice: InvoiceRow,
  alicuotas: AlicuotaPdf[],
  y: number,
  width: number,
  discrimina: boolean,
): number {
  if (y > doc.page.height - 240) {
    doc.addPage();
    y = MARGIN;
  }
  const boxW = 230;
  const x = MARGIN + width - boxW;

  const filas: Array<[string, string, boolean]> = [];
  if (discrimina) {
    filas.push(['Subtotal neto', centsToDisplay(invoice.imp_neto_cents), false]);
    for (const a of alicuotas) {
      const label = alicuotaPorId(a.id)?.label ?? `${a.rateBps / 100}%`;
      filas.push([`IVA ${label}`, centsToDisplay(a.importeCents), false]);
    }
  }
  if (invoice.imp_trib_cents > 0) {
    filas.push(['Otros tributos', centsToDisplay(invoice.imp_trib_cents), false]);
  }
  filas.push(['TOTAL', centsToDisplay(invoice.imp_total_cents), true]);

  let ty = y;
  for (const [label, value, bold] of filas) {
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 12 : 9)
      .fillColor(bold ? INK : MUTED)
      .text(label, x, ty, { width: boxW * 0.5 });
    doc
      .fillColor(INK)
      .text(value, x + boxW * 0.5, ty, { width: boxW * 0.5, align: 'right' });
    ty += bold ? 22 : 15;
  }

  if (!discrimina) {
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        'El IVA no se discrimina: régimen simplificado / sujeto exento.',
        MARGIN,
        y,
        { width: width - boxW - 20 },
      );
  }

  return ty + 10;
}

async function drawFooter(
  doc: PDFKit.PDFDocument,
  invoice: InvoiceRow,
  issuer: PublicIssuer,
  width: number,
): Promise<void> {
  const y = doc.page.height - 150;

  if (invoice.cae && invoice.cbte_nro !== null) {
    const qrUrl = buildQrUrl({
      fecha: invoice.cbte_fecha,
      cuitEmisor: issuer.cuit,
      ptoVta: invoice.punto_venta,
      tipoCmp: invoice.cbte_tipo,
      nroCmp: invoice.cbte_nro,
      importeCents: invoice.imp_total_cents,
      moneda: invoice.moneda,
      cotizacion: invoice.cotizacion,
      tipoDocRec: invoice.doc_tipo,
      nroDocRec: invoice.doc_nro,
      tipoCodAut: 'E',
      codAut: invoice.cae,
    });

    const qrPng = await QRCode.toBuffer(qrUrl, { margin: 0, width: 300, errorCorrectionLevel: 'M' });
    doc.image(qrPng, MARGIN, y, { width: 90, height: 90 });

    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
    doc.text(`CAE N°: ${invoice.cae}`, MARGIN + 105, y + 20, { width: width - 105 });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    doc.text(`Vencimiento del CAE: ${fromArcaDate(invoice.cae_vto)}`, MARGIN + 105, doc.y + 3, {
      width: width - 105,
    });
    doc.fontSize(7).text(
      'Comprobante autorizado por ARCA. Verificable escaneando el código QR (R.G. 4892).',
      MARGIN + 105,
      doc.y + 6,
      { width: width - 105 },
    );
  } else {
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#b91c1c')
      .text('COMPROBANTE SIN CAE — NO AUTORIZADO POR ARCA', MARGIN, y + 30, {
        width,
        align: 'center',
      });
  }
}

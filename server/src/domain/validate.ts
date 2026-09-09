/**
 * Validación de la solicitud de factura. Se corre entera antes de tocar ARCA, para
 * que los errores de carga se vean como mensajes de formulario y no como códigos de
 * rechazo del web service.
 */
import { z } from 'zod';
import { isValidCuit, isValidDni, normalizeDoc } from '../lib/cuit.js';
import {
  ALICUOTAS_IVA,
  CONCEPTO,
  DOC_TIPO,
  discriminaIva,
  letraDeComprobante,
  requiereFechasDeServicio,
} from './catalogs.js';
import { diffDias, esFechaValida, hoyArca } from './dates.js';

export const lineaSchema = z.object({
  descripcion: z.string().trim().min(1, 'La descripción del ítem es obligatoria.').max(200),
  cantidad: z.union([z.number(), z.string()]),
  precioUnitario: z.union([z.number(), z.string()]),
  ivaId: z.number().int(),
  descuentoPct: z.union([z.number(), z.string()]).optional(),
});

export const emitirSchema = z.object({
  issuerId: z.number().int().positive(),
  concepto: z.number().int().refine((v) => [1, 2, 3].includes(v), 'Concepto inválido.'),
  cbteTipo: z.number().int().positive().optional(),
  docTipo: z.number().int(),
  docNro: z.string().trim(),
  clienteNombre: z.string().trim().max(200).default(''),
  clienteDomicilio: z.string().trim().max(200).default(''),
  condicionIvaReceptorId: z.number().int().positive(),
  fecha: z.string().optional(),
  fchServDesde: z.string().optional(),
  fchServHasta: z.string().optional(),
  fchVtoPago: z.string().optional(),
  preciosConIva: z.boolean().default(false),
  otrosTributos: z.union([z.number(), z.string()]).optional(),
  lineas: z.array(lineaSchema).min(1, 'Agregá al menos un ítem.'),
  guardarCliente: z.boolean().default(false),
});

export type EmitirInput = z.infer<typeof emitirSchema>;

export interface ValidationIssue {
  campo: string;
  mensaje: string;
}

/**
 * Validaciones de negocio que Zod no cubre: reglas fiscales y de ARCA.
 * Devuelve todos los problemas juntos para que el formulario los muestre de una vez.
 */
export function validarEmision(input: EmitirInput, cbteTipo: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const letra = letraDeComprobante(cbteTipo);
  const docNro = normalizeDoc(input.docNro);

  // --- Identificación del receptor ---
  if (input.docTipo === DOC_TIPO.CUIT || input.docTipo === DOC_TIPO.CUIL) {
    if (!isValidCuit(docNro)) {
      issues.push({
        campo: 'docNro',
        mensaje:
          input.docTipo === DOC_TIPO.CUIT
            ? 'El CUIT no es válido: revisá los 11 dígitos y el dígito verificador.'
            : 'El CUIL no es válido: revisá los 11 dígitos y el dígito verificador.',
      });
    }
  } else if (input.docTipo === DOC_TIPO.DNI) {
    if (!isValidDni(docNro)) {
      issues.push({ campo: 'docNro', mensaje: 'El DNI debe tener 7 u 8 dígitos.' });
    }
  } else if (input.docTipo === DOC_TIPO.SIN_IDENTIFICAR) {
    if (docNro !== '' && docNro !== '0') {
      issues.push({
        campo: 'docNro',
        mensaje: 'Con "Consumidor Final" sin identificar, el número de documento debe ir vacío.',
      });
    }
  } else {
    issues.push({ campo: 'docTipo', mensaje: 'Tipo de documento no soportado.' });
  }

  // Los comprobantes A y M exigen receptor identificado con CUIT.
  if ((letra === 'A' || letra === 'M') && input.docTipo !== DOC_TIPO.CUIT) {
    issues.push({
      campo: 'docTipo',
      mensaje: `Un comprobante ${letra} requiere que el receptor esté identificado con CUIT.`,
    });
  }

  if (input.docTipo !== DOC_TIPO.SIN_IDENTIFICAR && input.clienteNombre.trim() === '') {
    issues.push({ campo: 'clienteNombre', mensaje: 'Ingresá el nombre o razón social del cliente.' });
  }

  // --- Fechas ---
  const fecha = input.fecha ? input.fecha.replace(/[^\d]/g, '') : hoyArca();
  if (!esFechaValida(fecha)) {
    issues.push({ campo: 'fecha', mensaje: 'La fecha del comprobante no es válida.' });
  } else {
    // ARCA acepta hasta 5 días de antigüedad para productos y 10 para servicios,
    // y no permite fechas futuras más allá de esos mismos márgenes (error 10016).
    const margen = input.concepto === CONCEPTO.PRODUCTOS ? 5 : 10;
    const dias = diffDias(fecha, hoyArca());
    if (dias > margen) {
      issues.push({
        campo: 'fecha',
        mensaje: `La fecha tiene ${dias} días de antigüedad. ARCA acepta hasta ${margen} para este concepto.`,
      });
    }
    if (dias < -margen) {
      issues.push({ campo: 'fecha', mensaje: 'La fecha del comprobante está demasiado adelantada.' });
    }
  }

  if (requiereFechasDeServicio(input.concepto)) {
    for (const [campo, valor, label] of [
      ['fchServDesde', input.fchServDesde, 'inicio del período facturado'],
      ['fchServHasta', input.fchServHasta, 'fin del período facturado'],
      ['fchVtoPago', input.fchVtoPago, 'vencimiento de pago'],
    ] as const) {
      const v = valor ? valor.replace(/[^\d]/g, '') : '';
      if (!v) {
        issues.push({
          campo,
          mensaje: `Para comprobantes de servicios hay que informar el ${label}.`,
        });
      } else if (!esFechaValida(v)) {
        issues.push({ campo, mensaje: `La fecha de ${label} no es válida.` });
      }
    }
    const desde = input.fchServDesde?.replace(/[^\d]/g, '');
    const hasta = input.fchServHasta?.replace(/[^\d]/g, '');
    if (desde && hasta && esFechaValida(desde) && esFechaValida(hasta) && diffDias(desde, hasta) < 0) {
      issues.push({
        campo: 'fchServHasta',
        mensaje: 'El fin del período no puede ser anterior al inicio.',
      });
    }
  }

  // --- Ítems ---
  input.lineas.forEach((linea, i) => {
    if (!ALICUOTAS_IVA.some((a) => a.id === linea.ivaId)) {
      issues.push({ campo: `lineas.${i}.ivaId`, mensaje: `Ítem ${i + 1}: alícuota de IVA inválida.` });
    }
    if (discriminaIva(cbteTipo) === false && linea.ivaId !== 3) {
      // En comprobante C no se discrimina; se normaliza en el cálculo, no es un error.
    }
  });

  return issues;
}

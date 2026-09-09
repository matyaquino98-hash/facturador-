/**
 * Consulta de datos del receptor — servicio "Constancia de Inscripción"
 * (`ws_sr_constancia_inscripcion`), que reemplaza al deprecado Padrón Alcance 5.
 *
 * [NO CONFIRMADO] No pude leer el manual oficial en esta sesión (dominios de ARCA
 * bloqueados por el proxy de egreso). Las URLs y el shape de la respuesta provienen
 * de implementaciones de referencia. Por eso todo el parseo es defensivo: si no
 * coincide, la función devuelve `null` y la carga manual sigue funcionando.
 *
 * Además el servicio requiere habilitación y asociación de certificado propias,
 * distintas de las de `wsfe`. Es una comodidad, nunca un requisito para emitir.
 */
import type { Environment } from './endpoints.js';
import { PADRON_URL } from './endpoints.js';
import { asString, escapeXml, pick, soapCall } from './soap.js';
import type { Auth } from './wsfev1.js';
import { CONDICIONES_IVA_RECEPTOR, DOC_TIPO } from '../domain/catalogs.js';

export interface DatosReceptor {
  docTipo: number;
  docNro: string;
  nombre: string;
  domicilio: string;
  /** CondicionIVAReceptorId inferido, si se pudo determinar. */
  condicionIvaReceptorId?: number;
  /** Texto crudo de la condición que devolvió ARCA, para mostrar al usuario. */
  condicionTexto?: string;
}

export async function consultarPersona(
  environment: Environment,
  auth: Auth,
  cuit: string,
): Promise<DatosReceptor | null> {
  const body =
    '<getPersona xmlns="http://a5.soap.ws.server.puc.sr/">' +
    `<token>${escapeXml(auth.token)}</token>` +
    `<sign>${escapeXml(auth.sign)}</sign>` +
    `<cuitRepresentada>${escapeXml(auth.cuit)}</cuitRepresentada>` +
    `<idPersona>${escapeXml(cuit)}</idPersona>` +
    '</getPersona>';

  const responseBody = await soapCall({
    url: PADRON_URL[environment],
    soapAction: '',
    body,
    timeoutMs: 15_000,
  });

  const response = pick(responseBody, 'getPersonaResponse');
  const personaReturn = response ? pick(response, 'personaReturn') : undefined;
  if (!personaReturn) return null;

  const datos =
    pick(personaReturn, 'datosGenerales') ?? pick(personaReturn, 'persona') ?? personaReturn;
  if (!datos) return null;

  const razonSocial = asString(pick(datos, 'razonSocial'));
  const apellido = asString(pick(datos, 'apellido'));
  const nombreP = asString(pick(datos, 'nombre'));
  const nombre = razonSocial ?? [apellido, nombreP].filter(Boolean).join(', ');
  if (!nombre) return null;

  const domicilioNode = pick(datos, 'domicilioFiscal');
  const domicilio = domicilioNode
    ? [
        asString(pick(domicilioNode, 'direccion')),
        asString(pick(domicilioNode, 'localidad')),
        asString(pick(domicilioNode, 'descripcionProvincia')),
      ]
        .filter(Boolean)
        .join(', ')
    : '';

  const condicionTexto = inferirTextoCondicion(personaReturn, datos);

  return {
    docTipo: DOC_TIPO.CUIT,
    docNro: cuit,
    nombre,
    domicilio,
    condicionIvaReceptorId: mapearCondicion(condicionTexto),
    condicionTexto,
  };
}

function inferirTextoCondicion(
  personaReturn: Record<string, unknown>,
  datos: Record<string, unknown>,
): string | undefined {
  // El servicio expone la condición en distintos lugares según el alcance.
  const candidatos = [
    pick(datos, 'tipoClave'),
    pick(personaReturn, 'datosMonotributo'),
    pick(personaReturn, 'datosRegimenGeneral'),
  ];
  if (pick(personaReturn, 'datosMonotributo')) return 'monotributo';
  const regimen = pick(personaReturn, 'datosRegimenGeneral');
  if (regimen) {
    const impuestos = JSON.stringify(regimen).toLowerCase();
    if (impuestos.includes('exent')) return 'exento';
    return 'responsable inscripto';
  }
  for (const c of candidatos) {
    const s = asString(c);
    if (s) return s.toLowerCase();
  }
  return undefined;
}

/** Mapea el texto de condición al CondicionIVAReceptorId correspondiente. */
export function mapearCondicion(texto: string | undefined): number | undefined {
  if (!texto) return undefined;
  const t = texto.toLowerCase();
  if (t.includes('monotribut')) return 6;
  if (t.includes('exent')) return 4;
  if (t.includes('inscripto') || t.includes('responsable')) return 1;
  if (t.includes('consumidor')) return 5;
  if (t.includes('no alcanzado')) return 15;
  const exacto = CONDICIONES_IVA_RECEPTOR.find((c) => c.label.toLowerCase() === t);
  return exacto?.id;
}

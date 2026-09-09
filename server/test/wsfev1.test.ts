import { describe, expect, it } from 'vitest';
import { DET_FIELD_ORDER, buildDetRequest, parseCaeResponse, parseMessages } from '../src/arca/wsfev1.js';
import { XMLParser } from 'fast-xml-parser';
import { buildTra, parseLoginTicketResponse, toArcaDateTime } from '../src/arca/wsaa.js';

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  transformTagName: (t) => (t.includes(':') ? t.split(':').pop()! : t),
});

const solicitudBase = {
  ptoVta: 1,
  cbteTipo: 1,
  concepto: 1,
  docTipo: 80,
  docNro: '20123456786',
  cbteNro: 15,
  cbteFch: '20260909',
  impTotalCents: 121000,
  impTotConcCents: 0,
  impNetoCents: 100000,
  impOpExCents: 0,
  impTribCents: 0,
  impIvaCents: 21000,
  monId: 'PES',
  monCotiz: 1,
  condicionIvaReceptorId: 1,
  iva: [{ Id: 5, BaseImpCents: 100000, ImporteCents: 21000 }],
};

describe('buildDetRequest', () => {
  it('serializa los importes con dos decimales y punto', () => {
    const xml = buildDetRequest(solicitudBase);
    expect(xml).toContain('<ImpTotal>1210.00</ImpTotal>');
    expect(xml).toContain('<ImpNeto>1000.00</ImpNeto>');
    expect(xml).toContain('<ImpIVA>210.00</ImpIVA>');
    expect(xml).toContain('<ImpTotConc>0.00</ImpTotConc>');
  });

  it('usa el mismo numero en CbteDesde y CbteHasta', () => {
    const xml = buildDetRequest(solicitudBase);
    expect(xml).toContain('<CbteDesde>15</CbteDesde>');
    expect(xml).toContain('<CbteHasta>15</CbteHasta>');
  });

  it('informa CondicionIVAReceptorId (R.G. 5616)', () => {
    expect(buildDetRequest(solicitudBase)).toContain(
      '<CondicionIVAReceptorId>1</CondicionIVAReceptorId>',
    );
  });

  it('serializa el detalle de alicuotas', () => {
    const xml = buildDetRequest(solicitudBase);
    expect(xml).toContain('<Iva><AlicIva><Id>5</Id><BaseImp>1000.00</BaseImp><Importe>210.00</Importe></AlicIva></Iva>');
  });

  it('omite el array Iva en comprobantes C', () => {
    const xml = buildDetRequest({ ...solicitudBase, cbteTipo: 11, iva: [] });
    expect(xml).not.toContain('<Iva>');
    expect(xml).not.toContain('<AlicIva>');
  });

  it('omite las fechas de servicio cuando el concepto es Productos', () => {
    const xml = buildDetRequest(solicitudBase);
    expect(xml).not.toContain('FchServDesde');
    expect(xml).not.toContain('FchVtoPago');
  });

  it('incluye las fechas de servicio cuando corresponden', () => {
    const xml = buildDetRequest({
      ...solicitudBase,
      concepto: 2,
      fchServDesde: '20260901',
      fchServHasta: '20260930',
      fchVtoPago: '20261010',
    });
    expect(xml).toContain('<FchServDesde>20260901</FchServDesde>');
    expect(xml).toContain('<FchServHasta>20260930</FchServHasta>');
    expect(xml).toContain('<FchVtoPago>20261010</FchVtoPago>');
  });

  it('respeta el orden de elementos declarado (xs:sequence del WSDL)', () => {
    const xml = buildDetRequest({
      ...solicitudBase,
      concepto: 2,
      fchServDesde: '20260901',
      fchServHasta: '20260930',
      fchVtoPago: '20261010',
    });
    const presentes = DET_FIELD_ORDER.filter((f) => xml.includes(`<${f}>`));
    const posiciones = presentes.map((f) => xml.indexOf(`<${f}>`));
    const ordenado = [...posiciones].sort((a, b) => a - b);
    expect(posiciones).toEqual(ordenado);
  });

  it('produce XML bien formado', () => {
    const xml = buildDetRequest(solicitudBase);
    const parsed = parser.parse(`<root>${xml}</root>`);
    expect(parsed.root.FECAEDetRequest.CbteFch).toBe('20260909');
  });
});

function envolver(inner: string) {
  return parser.parse(`<FECAESolicitarResult>${inner}</FECAESolicitarResult>`)
    .FECAESolicitarResult as Record<string, unknown>;
}

describe('parseCaeResponse', () => {
  it('extrae el CAE de una respuesta aprobada', () => {
    const r = parseCaeResponse(
      envolver(`
        <FeCabResp><Resultado>A</Resultado><FchProceso>20260909120000</FchProceso><CantReg>1</CantReg></FeCabResp>
        <FeDetResp><FECAEDetResponse>
          <CbteDesde>15</CbteDesde><CbteHasta>15</CbteHasta>
          <Resultado>A</Resultado><CAE>70417054367476</CAE><CAEFchVto>20260919</CAEFchVto>
        </FECAEDetResponse></FeDetResp>`),
    );
    expect(r.resultado).toBe('A');
    expect(r.cae).toBe('70417054367476');
    expect(r.caeFchVto).toBe('20260919');
    expect(r.cbteDesde).toBe(15);
    expect(r.errores).toHaveLength(0);
  });

  it('extrae los errores de una respuesta rechazada', () => {
    const r = parseCaeResponse(
      envolver(`
        <FeCabResp><Resultado>R</Resultado></FeCabResp>
        <Errors><Err><Code>10016</Code><Msg>Fecha de comprobante fuera de rango</Msg></Err></Errors>`),
    );
    expect(r.resultado).toBe('R');
    expect(r.cae).toBeUndefined();
    expect(r.errores).toEqual([{ code: 10016, msg: 'Fecha de comprobante fuera de rango' }]);
  });

  it('normaliza un CAE vacio a undefined', () => {
    const r = parseCaeResponse(
      envolver(`
        <FeCabResp><Resultado>R</Resultado></FeCabResp>
        <FeDetResp><FECAEDetResponse><Resultado>R</Resultado><CAE></CAE><CAEFchVto></CAEFchVto></FECAEDetResponse></FeDetResp>`),
    );
    expect(r.cae).toBeUndefined();
    expect(r.caeFchVto).toBeUndefined();
  });

  it('conserva el CAE cuando hay observaciones pero el resultado es aprobado', () => {
    const r = parseCaeResponse(
      envolver(`
        <FeCabResp><Resultado>A</Resultado></FeCabResp>
        <FeDetResp><FECAEDetResponse>
          <Resultado>A</Resultado><CAE>70417054367476</CAE><CAEFchVto>20260919</CAEFchVto>
          <Observaciones><Obs><Code>10013</Code><Msg>El numero de documento no se corresponde</Msg></Obs></Observaciones>
        </FECAEDetResponse></FeDetResp>`),
    );
    expect(r.resultado).toBe('A');
    expect(r.cae).toBe('70417054367476');
    expect(r.observaciones).toHaveLength(1);
    expect(r.observaciones[0]!.code).toBe(10013);
  });

  it('lee varios errores', () => {
    const r = parseCaeResponse(
      envolver(`
        <FeCabResp><Resultado>R</Resultado></FeCabResp>
        <Errors>
          <Err><Code>10015</Code><Msg>Numeracion incorrecta</Msg></Err>
          <Err><Code>10016</Code><Msg>Fecha fuera de rango</Msg></Err>
        </Errors>`),
    );
    expect(r.errores).toHaveLength(2);
    expect(r.errores.map((e) => e.code)).toEqual([10015, 10016]);
  });

  it('tolera una respuesta sin detalle', () => {
    const r = parseCaeResponse(envolver('<FeCabResp><Resultado>R</Resultado></FeCabResp>'));
    expect(r.resultado).toBe('R');
    expect(r.cae).toBeUndefined();
  });
});

describe('parseMessages', () => {
  it('devuelve vacio cuando no hay contenedor', () => {
    expect(parseMessages(undefined, 'Err')).toEqual([]);
  });
});

describe('WSAA', () => {
  it('el TRA tiene la estructura esperada', () => {
    const tra = buildTra({ service: 'wsfe' });
    const parsed = parser.parse(tra).loginTicketRequest;
    expect(parsed.service).toBe('wsfe');
    expect(parsed.header.uniqueId).toBeTruthy();
    expect(parsed.header.generationTime).toBeTruthy();
    expect(parsed.header.expirationTime).toBeTruthy();
  });

  it('generationTime es anterior a expirationTime', () => {
    const parsed = parser.parse(buildTra({ service: 'wsfe' })).loginTicketRequest;
    expect(new Date(parsed.header.generationTime).getTime()).toBeLessThan(
      new Date(parsed.header.expirationTime).getTime(),
    );
  });

  it('formatea la fecha con offset ISO-8601', () => {
    expect(toArcaDateTime(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it('parsea el LoginTicketResponse', () => {
    const ta = parseLoginTicketResponse(`
      <loginTicketResponse version="1.0">
        <header><expirationTime>2026-09-09T22:00:00-03:00</expirationTime></header>
        <credentials><token>PD94bWw=</token><sign>abc123==</sign></credentials>
      </loginTicketResponse>`);
    expect(ta.token).toBe('PD94bWw=');
    expect(ta.sign).toBe('abc123==');
    expect(ta.expiresAt.toISOString()).toBe('2026-09-10T01:00:00.000Z');
  });

  it('falla si el TA no trae credenciales', () => {
    expect(() => parseLoginTicketResponse('<loginTicketResponse/>')).toThrow(/token y sign/i);
  });
});

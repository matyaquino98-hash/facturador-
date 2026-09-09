/**
 * ARCA simulado: intercepta `fetch` y responde SOAP como lo haría el servicio real.
 * Permite ejercitar el camino completo (firma CMS -> WSAA -> WSFEv1 -> persistencia)
 * sin tocar la red ni necesitar un certificado de ARCA.
 */
import forge from 'node-forge';

export interface FakeArcaOptions {
  /** Respuesta de FECompUltimoAutorizado. */
  ultimoAutorizado?: number;
  /** Fuerza el resultado de FECAESolicitar. */
  cae?: { resultado: 'A' | 'R'; cae?: string; caeFchVto?: string };
  errores?: Array<{ code: number; msg: string }>;
  observaciones?: Array<{ code: number; msg: string }>;
  /** Falla el transporte. */
  networkError?: boolean;
}

export interface FakeArcaHandle {
  requests: Array<{ url: string; action: string; body: string }>;
  restore(): void;
}

function envelope(inner: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="utf-8"?>
     <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
       <soap:Body>${inner}</soap:Body>
     </soap:Envelope>`,
    { status: 200, headers: { 'content-type': 'text/xml' } },
  );
}

export function installFakeArca(options: FakeArcaOptions = {}): FakeArcaHandle {
  const original = globalThis.fetch;
  const requests: FakeArcaHandle['requests'] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? '');
    const action = String((init?.headers as Record<string, string>)?.SOAPAction ?? '');
    requests.push({ url, action, body });

    if (options.networkError) throw new TypeError('fetch failed');

    if (url.includes('LoginCms')) {
      const ta = `<?xml version="1.0"?>
        <loginTicketResponse version="1.0">
          <header><expirationTime>${new Date(Date.now() + 12 * 3600_000).toISOString()}</expirationTime></header>
          <credentials><token>TOKEN-FAKE</token><sign>SIGN-FAKE</sign></credentials>
        </loginTicketResponse>`;
      // El WSAA devuelve el XML del TA como texto escapado.
      const escaped = ta.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return envelope(
        `<loginCmsResponse><loginCmsReturn>${escaped}</loginCmsReturn></loginCmsResponse>`,
      );
    }

    if (action.endsWith('FECompUltimoAutorizado')) {
      return envelope(
        `<FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult>
           <PtoVta>1</PtoVta><CbteTipo>1</CbteTipo>
           <CbteNro>${options.ultimoAutorizado ?? 0}</CbteNro>
         </FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`,
      );
    }

    if (action.endsWith('FECAESolicitar')) {
      const cfg = options.cae ?? {
        resultado: 'A' as const,
        cae: '70417054367476',
        caeFchVto: '20260919',
      };
      const nro = (options.ultimoAutorizado ?? 0) + 1;
      const errores = (options.errores ?? [])
        .map((e) => `<Err><Code>${e.code}</Code><Msg>${e.msg}</Msg></Err>`)
        .join('');
      const obs = (options.observaciones ?? [])
        .map((o) => `<Obs><Code>${o.code}</Code><Msg>${o.msg}</Msg></Obs>`)
        .join('');

      return envelope(
        `<FECAESolicitarResponse><FECAESolicitarResult>
           <FeCabResp><Resultado>${cfg.resultado}</Resultado><CantReg>1</CantReg>
             <FchProceso>20260909120000</FchProceso></FeCabResp>
           <FeDetResp><FECAEDetResponse>
             <CbteDesde>${nro}</CbteDesde><CbteHasta>${nro}</CbteHasta>
             <Resultado>${cfg.resultado}</Resultado>
             <CAE>${cfg.cae ?? ''}</CAE><CAEFchVto>${cfg.caeFchVto ?? ''}</CAEFchVto>
             ${obs ? `<Observaciones>${obs}</Observaciones>` : ''}
           </FECAEDetResponse></FeDetResp>
           ${errores ? `<Errors>${errores}</Errors>` : ''}
         </FECAESolicitarResult></FECAESolicitarResponse>`,
      );
    }

    if (action.endsWith('FEDummy')) {
      return envelope(
        `<FEDummyResponse><FEDummyResult>
           <AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>
         </FEDummyResult></FEDummyResponse>`,
      );
    }

    throw new Error(`SOAPAction no simulada: ${action}`);
  }) as typeof fetch;

  return {
    requests,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Genera un par certificado/clave autofirmado, para no depender de uno real de ARCA. */
export function generarCertificadoDePrueba(cuit = '20123456786'): {
  certPem: string;
  keyPem: string;
} {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [
    { name: 'commonName', value: 'facturador-test' },
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: 'Test' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  api,
  hoy,
  aInputDate,
  pesos,
  type Catalogos,
  type Cliente,
  type Emisor,
  type Factura,
  type Producto,
  type ResultadoArca,
  type Sugerencia,
  type Totales,
} from '../api.ts';
import { Alert, Card, Field, Spinner } from '../components.tsx';

interface LineaForm {
  key: number;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  ivaId: number;
}

let nextKey = 1;
const lineaVacia = (ivaId = 5): LineaForm => ({
  key: nextKey++,
  descripcion: '',
  cantidad: '1',
  precioUnitario: '',
  ivaId,
});

export function NuevaFactura({
  emisores,
  catalogos,
  onEmitida,
}: {
  emisores: Emisor[];
  catalogos: Catalogos;
  onEmitida: (factura: Factura, arca: ResultadoArca) => void;
}) {
  const [issuerId, setIssuerId] = useState(emisores[0]?.id ?? 0);
  const emisor = emisores.find((e) => e.id === issuerId);

  const [concepto, setConcepto] = useState(1);
  const [docTipo, setDocTipo] = useState(80);
  const [docNro, setDocNro] = useState('');
  const [clienteNombre, setClienteNombre] = useState('');
  const [clienteDomicilio, setClienteDomicilio] = useState('');
  const [condicionIvaReceptorId, setCondicion] = useState(5);
  const [fecha, setFecha] = useState(hoy());
  const [fchServDesde, setServDesde] = useState(hoy());
  const [fchServHasta, setServHasta] = useState(hoy());
  const [fchVtoPago, setVtoPago] = useState(hoy());
  const [preciosConIva, setPreciosConIva] = useState(false);
  const [guardarCliente, setGuardarCliente] = useState(true);
  const [cbteTipoManual, setCbteTipoManual] = useState<number | null>(null);
  const [lineas, setLineas] = useState<LineaForm[]>([lineaVacia()]);

  const [sugerencia, setSugerencia] = useState<Sugerencia | null>(null);
  const [totales, setTotales] = useState<Totales | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [buscandoPadron, setBuscandoPadron] = useState(false);
  const [avisoPadron, setAvisoPadron] = useState<string | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ campo: string; mensaje: string }>>([]);
  const [arcaError, setArcaError] = useState<ResultadoArca | null>(null);

  const cbteTipo = cbteTipoManual ?? sugerencia?.cbteTipo ?? 0;
  const letra = cbteTipoManual
    ? (sugerencia?.alternativas.find((a) => a.id === cbteTipoManual)?.label ?? '').slice(-1)
    : (sugerencia?.letra ?? '');
  const discriminaIva = letra !== 'C' && letra !== '';
  const esServicio = concepto === 2 || concepto === 3;

  useEffect(() => {
    api.get<{ clientes: Cliente[] }>('/api/clientes').then((r) => setClientes(r.clientes)).catch(() => {});
    api.get<{ productos: Producto[] }>('/api/productos').then((r) => setProductos(r.productos)).catch(() => {});
  }, []);

  // Sugerencia de tipo de comprobante: se recalcula al cambiar emisor o condición.
  useEffect(() => {
    if (!issuerId) return;
    let vigente = true;
    api
      .post<Sugerencia>('/api/comprobante/sugerir', { issuerId, condicionIvaReceptorId })
      .then((s) => {
        if (!vigente) return;
        setSugerencia(s);
        setCbteTipoManual(null);
      })
      .catch(() => vigente && setSugerencia(null));
    return () => {
      vigente = false;
    };
  }, [issuerId, condicionIvaReceptorId]);

  // Totales en vivo, con el mismo cálculo del backend (una sola fuente de verdad).
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!cbteTipo) return;
    const cargables = lineas.filter((l) => l.precioUnitario.trim() !== '');
    if (cargables.length === 0) {
      setTotales(null);
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api
        .post<Totales>('/api/comprobante/calcular', {
          cbteTipo,
          preciosConIva,
          lineas: cargables.map((l) => ({
            descripcion: l.descripcion,
            cantidad: l.cantidad || '0',
            precioUnitario: l.precioUnitario || '0',
            ivaId: l.ivaId,
          })),
        })
        .then(setTotales)
        .catch(() => setTotales(null));
    }, 220);
    return () => window.clearTimeout(timer.current);
  }, [lineas, cbteTipo, preciosConIva]);

  const setLinea = useCallback((key: number, patch: Partial<LineaForm>) => {
    setLineas((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const buscarPadron = useCallback(async () => {
    const digits = docNro.replace(/\D/g, '');
    if (digits.length !== 11 || !issuerId) return;
    setBuscandoPadron(true);
    setAvisoPadron(null);
    try {
      const r = await api.get<{
        disponible: boolean;
        motivo?: string;
        datos?: { nombre: string; domicilio: string; condicionIvaReceptorId?: number };
      }>(`/api/padron/${digits}?issuerId=${issuerId}`);
      if (r.disponible && r.datos) {
        setClienteNombre(r.datos.nombre);
        if (r.datos.domicilio) setClienteDomicilio(r.datos.domicilio);
        if (r.datos.condicionIvaReceptorId) setCondicion(r.datos.condicionIvaReceptorId);
      } else {
        setAvisoPadron(r.motivo ?? 'No se encontraron datos. Cargalos manualmente.');
      }
    } catch (err) {
      setAvisoPadron(err instanceof ApiError ? err.message : 'No se pudo consultar el padrón.');
    } finally {
      setBuscandoPadron(false);
    }
  }, [docNro, issuerId]);

  const usarCliente = (cliente: Cliente) => {
    setDocTipo(cliente.doc_tipo);
    setDocNro(cliente.doc_nro);
    setClienteNombre(cliente.nombre);
    setClienteDomicilio(cliente.domicilio);
    setCondicion(cliente.condicion_iva_id);
    setAvisoPadron(null);
  };

  const errorDe = (campo: string) => issues.find((i) => i.campo === campo)?.mensaje;

  async function generar() {
    setEmitiendo(true);
    setError(null);
    setIssues([]);
    setArcaError(null);
    try {
      const r = await api.post<{ factura: Factura; arca: ResultadoArca }>('/api/facturas', {
        issuerId,
        concepto,
        cbteTipo: cbteTipoManual ?? undefined,
        docTipo,
        docNro: docNro.replace(/\D/g, ''),
        clienteNombre,
        clienteDomicilio,
        condicionIvaReceptorId,
        fecha,
        fchServDesde: esServicio ? fchServDesde : undefined,
        fchServHasta: esServicio ? fchServHasta : undefined,
        fchVtoPago: esServicio ? fchVtoPago : undefined,
        preciosConIva,
        guardarCliente,
        lineas: lineas
          .filter((l) => l.descripcion.trim() !== '' || l.precioUnitario.trim() !== '')
          .map((l) => ({
            descripcion: l.descripcion,
            cantidad: l.cantidad || '0',
            precioUnitario: l.precioUnitario || '0',
            ivaId: l.ivaId,
          })),
      });
      onEmitida(r.factura, r.arca);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setIssues(err.issues);
        setArcaError(err.arca ?? null);
      } else {
        setError('No se pudo generar la factura.');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setEmitiendo(false);
    }
  }

  const puedeEmitir =
    !emitiendo &&
    Boolean(emisor?.credenciales.cargadas) &&
    cbteTipo > 0 &&
    (totales?.impTotalCents ?? 0) > 0;

  const condicionesValidas = useMemo(
    () =>
      catalogos.condicionesIvaReceptor.filter((c) => letra === '' || c.letras.includes(letra)),
    [catalogos.condicionesIvaReceptor, letra],
  );

  if (!emisor) {
    return (
      <Card title="Configurá tu emisor">
        <p className="muted">
          Antes de facturar necesitás cargar los datos de tu CUIT y el certificado de ARCA.
        </p>
      </Card>
    );
  }

  return (
    <div className="stack">
      {error && (
        <Alert tone="err" title={error}>
          {issues.length > 0 && (
            <ul>
              {issues.map((i, n) => (
                <li key={n}>{i.mensaje}</li>
              ))}
            </ul>
          )}
          {arcaError && arcaError.errores.length > 0 && (
            <ul>
              {arcaError.errores.map((e, n) => (
                <li key={n}>
                  {e.explicacion}
                  {e.code > 0 && <span className="muted"> (código {e.code})</span>}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {!emisor.credenciales.cargadas && (
        <Alert tone="warn" title="Falta el certificado de ARCA">
          <span>Cargalo en Configuración para poder emitir comprobantes.</span>
        </Alert>
      )}

      <Card
        title="Cliente"
        subtitle="Ingresá el CUIT y completamos el resto"
        action={
          emisores.length > 1 ? (
            <select
              value={issuerId}
              onChange={(e) => setIssuerId(Number(e.target.value))}
              style={{ width: 'auto' }}
              aria-label="Emisor"
            >
              {emisores.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.razonSocial} · PV {String(e.puntoVenta).padStart(5, '0')}
                </option>
              ))}
            </select>
          ) : null
        }
      >
        <div className="row c3">
          <Field label="Tipo de documento">
            <select value={docTipo} onChange={(e) => setDocTipo(Number(e.target.value))}>
              {catalogos.tiposDocumento.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Número" error={errorDe('docNro')}>
            <input
              value={docNro}
              onChange={(e) => setDocNro(e.target.value)}
              onBlur={() => docTipo === 80 && buscarPadron()}
              placeholder={docTipo === 96 ? '30123456' : '30-71026042-3'}
              disabled={docTipo === 99}
              inputMode="numeric"
              aria-invalid={Boolean(errorDe('docNro'))}
            />
          </Field>
          <Field label="Condición frente al IVA" error={errorDe('condicionIvaReceptorId')}>
            <select value={condicionIvaReceptorId} onChange={(e) => setCondicion(Number(e.target.value))}>
              {condicionesValidas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="row c2" style={{ marginTop: 12 }}>
          <Field label="Nombre o razón social" error={errorDe('clienteNombre')}>
            <input
              value={clienteNombre}
              onChange={(e) => setClienteNombre(e.target.value)}
              placeholder="Cliente S.A."
              disabled={docTipo === 99}
              aria-invalid={Boolean(errorDe('clienteNombre'))}
            />
          </Field>
          <Field label="Domicilio (opcional)">
            <input
              value={clienteDomicilio}
              onChange={(e) => setClienteDomicilio(e.target.value)}
              placeholder="Av. Corrientes 1234, CABA"
            />
          </Field>
        </div>

        {buscandoPadron && (
          <p className="muted" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Spinner /> Consultando datos en ARCA…
          </p>
        )}
        {avisoPadron && (
          <p className="muted" style={{ marginTop: 10 }}>
            {avisoPadron}
          </p>
        )}

        {clientes.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="muted" style={{ alignSelf: 'center' }}>
              Frecuentes:
            </span>
            {clientes.slice(0, 6).map((c) => (
              <button key={c.id} type="button" className="btn ghost" onClick={() => usarCliente(c)}>
                {c.nombre}
              </button>
            ))}
          </div>
        )}

        {sugerencia && (
          <div className="suggest" style={{ marginTop: 14 }}>
            <strong>{cbteTipoManual ? sugerencia.alternativas.find((a) => a.id === cbteTipoManual)?.label : sugerencia.label}</strong>
            <span>{sugerencia.motivo}</span>
            {sugerencia.alternativas.length > 1 && (
              <select
                value={cbteTipo}
                onChange={(e) => setCbteTipoManual(Number(e.target.value))}
                style={{ width: 'auto', marginLeft: 'auto' }}
                aria-label="Cambiar tipo de comprobante"
              >
                {sugerencia.alternativas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Detalle"
        action={
          <label className="check">
            <input
              type="checkbox"
              checked={preciosConIva}
              onChange={(e) => setPreciosConIva(e.target.checked)}
              disabled={!discriminaIva}
            />
            Precios con IVA incluido
          </label>
        }
      >
        {lineas.map((linea, index) => (
          <div key={linea.key} className={`item-row ${discriminaIva ? '' : 'no-iva'}`}>
            <div className="span">
              <Field label={index === 0 ? 'Descripción' : ''}>
                <input
                  value={linea.descripcion}
                  onChange={(e) => setLinea(linea.key, { descripcion: e.target.value })}
                  placeholder="Producto o servicio"
                  list="productos-frecuentes"
                  onBlur={(e) => {
                    const p = productos.find((x) => x.descripcion === e.target.value);
                    if (p && linea.precioUnitario === '') {
                      setLinea(linea.key, {
                        precioUnitario: (p.precio_cents / 100).toFixed(2),
                        ivaId: p.iva_id,
                      });
                    }
                  }}
                />
              </Field>
            </div>
            <Field label={index === 0 ? 'Cant.' : ''}>
              <input
                value={linea.cantidad}
                onChange={(e) => setLinea(linea.key, { cantidad: e.target.value })}
                inputMode="decimal"
              />
            </Field>
            <Field label={index === 0 ? 'Precio unit.' : ''}>
              <input
                value={linea.precioUnitario}
                onChange={(e) => setLinea(linea.key, { precioUnitario: e.target.value })}
                placeholder="0,00"
                inputMode="decimal"
              />
            </Field>
            {discriminaIva && (
              <Field label={index === 0 ? 'IVA' : ''}>
                <select
                  value={linea.ivaId}
                  onChange={(e) => setLinea(linea.key, { ivaId: Number(e.target.value) })}
                >
                  {catalogos.alicuotasIva.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="item-total">
              {totales?.lineas[index]
                ? pesos(
                    discriminaIva
                      ? totales.lineas[index]!.netoCents
                      : totales.lineas[index]!.subtotalCents,
                  )
                : '—'}
            </div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setLineas((p) => (p.length > 1 ? p.filter((l) => l.key !== linea.key) : p))}
              disabled={lineas.length === 1}
              aria-label={`Quitar ítem ${index + 1}`}
              style={{ paddingBottom: 10 }}
            >
              ✕
            </button>
          </div>
        ))}

        <datalist id="productos-frecuentes">
          {productos.map((p) => (
            <option key={p.id} value={p.descripcion} />
          ))}
        </datalist>

        <button
          type="button"
          className="btn ghost"
          style={{ marginTop: 12 }}
          onClick={() => setLineas((p) => [...p, lineaVacia(p[p.length - 1]?.ivaId ?? 5)])}
        >
          + Agregar ítem
        </button>

        {totales && (
          <div className="totals" style={{ marginTop: 20 }}>
            {discriminaIva && (
              <>
                <div>
                  <span>Neto</span>
                  <span>{pesos(totales.impNetoCents)}</span>
                </div>
                {totales.alicuotas.map((a) => (
                  <div key={a.id}>
                    <span>IVA {a.rateBps / 100}%</span>
                    <span>{pesos(a.importeCents)}</span>
                  </div>
                ))}
              </>
            )}
            <div className="grand">
              <span>Total</span>
              <span>{pesos(totales.impTotalCents)}</span>
            </div>
          </div>
        )}
      </Card>

      <Card title="Fecha y concepto">
        <div className="row c2">
          <Field label="Concepto">
            <select value={concepto} onChange={(e) => setConcepto(Number(e.target.value))}>
              {catalogos.conceptos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fecha del comprobante" error={errorDe('fecha')}>
            <input
              type="date"
              value={aInputDate(fecha)}
              onChange={(e) => setFecha(e.target.value.replace(/-/g, ''))}
            />
          </Field>
        </div>

        {esServicio && (
          <div className="row c3" style={{ marginTop: 12 }}>
            <Field label="Período desde" error={errorDe('fchServDesde')}>
              <input
                type="date"
                value={aInputDate(fchServDesde)}
                onChange={(e) => setServDesde(e.target.value.replace(/-/g, ''))}
              />
            </Field>
            <Field label="Período hasta" error={errorDe('fchServHasta')}>
              <input
                type="date"
                value={aInputDate(fchServHasta)}
                onChange={(e) => setServHasta(e.target.value.replace(/-/g, ''))}
              />
            </Field>
            <Field label="Vencimiento de pago" error={errorDe('fchVtoPago')}>
              <input
                type="date"
                value={aInputDate(fchVtoPago)}
                onChange={(e) => setVtoPago(e.target.value.replace(/-/g, ''))}
              />
            </Field>
          </div>
        )}

        <label className="check" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={guardarCliente}
            onChange={(e) => setGuardarCliente(e.target.checked)}
          />
          Guardar este cliente para próximas facturas
        </label>
      </Card>

      <button type="button" className="btn primary lg" onClick={generar} disabled={!puedeEmitir}>
        {emitiendo ? (
          <>
            <Spinner /> Solicitando CAE a ARCA…
          </>
        ) : (
          `Generar factura${totales ? ` · ${pesos(totales.impTotalCents)}` : ''}`
        )}
      </button>
    </div>
  );
}

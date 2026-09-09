import { useState } from 'react';
import { ApiError, api, type Emisor } from '../api.ts';
import { Alert, Card, Field, Spinner } from '../components.tsx';

const CONDICIONES = [
  { value: 'responsable_inscripto', label: 'IVA Responsable Inscripto' },
  { value: 'monotributo', label: 'Responsable Monotributo' },
  { value: 'exento', label: 'IVA Sujeto Exento' },
] as const;

export function Configuracion({
  emisores,
  onCambio,
}: {
  emisores: Emisor[];
  onCambio: () => void;
}) {
  return (
    <div className="stack">
      {emisores.map((e) => (
        <EmisorCard key={e.id} emisor={e} onCambio={onCambio} />
      ))}
      <NuevoEmisor onCreado={onCambio} yaHay={emisores.length > 0} />
    </div>
  );
}

function EmisorCard({ emisor, onCambio }: { emisor: Emisor; onCambio: () => void }) {
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [abierto, setAbierto] = useState(!emisor.credenciales.cargadas);

  async function guardarCredenciales() {
    setGuardando(true);
    setError(null);
    setOk(false);
    try {
      await api.post(`/api/issuers/${emisor.id}/credentials`, { certPem, keyPem });
      // El material se descarta del navegador apenas se guarda.
      setCertPem('');
      setKeyPem('');
      setOk(true);
      setAbierto(false);
      onCambio();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el certificado.');
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEntorno(environment: string) {
    await api.patch(`/api/issuers/${emisor.id}`, { environment });
    onCambio();
  }

  return (
    <Card
      title={emisor.razonSocial}
      subtitle={`CUIT ${emisor.cuit} · Punto de venta ${String(emisor.puntoVenta).padStart(5, '0')}`}
      action={
        <span className={`badge ${emisor.credenciales.cargadas && !emisor.credenciales.vencido ? 'ok' : 'err'}`}>
          {emisor.credenciales.vencido
            ? 'Certificado vencido'
            : emisor.credenciales.cargadas
              ? 'Certificado OK'
              : 'Sin certificado'}
        </span>
      }
    >
      <div className="row c2">
        <Field label="Entorno de ARCA" hint="Homologación es el entorno de pruebas: los comprobantes no tienen validez fiscal.">
          <select value={emisor.environment} onChange={(e) => cambiarEntorno(e.target.value)}>
            <option value="homologacion">Homologación (pruebas)</option>
            <option value="produccion">Producción</option>
          </select>
        </Field>
        <Field label="Condición frente al IVA">
          <input
            value={CONDICIONES.find((c) => c.value === emisor.condicionIva)?.label ?? emisor.condicionIva}
            disabled
          />
        </Field>
      </div>

      {emisor.credenciales.cargadas && (
        <p className="muted" style={{ marginTop: 12 }}>
          Certificado: <span className="mono">{emisor.credenciales.sujeto}</span>
          <br />
          Vence el{' '}
          {emisor.credenciales.venceEl
            ? new Date(emisor.credenciales.venceEl).toLocaleDateString('es-AR')
            : '—'}
        </p>
      )}

      {ok && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="ok" title="Certificado guardado correctamente" />
        </div>
      )}

      {!abierto ? (
        <button type="button" className="btn ghost" style={{ marginTop: 12 }} onClick={() => setAbierto(true)}>
          Reemplazar certificado
        </button>
      ) : (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 10 }}>Credenciales de ARCA</h3>
          <p className="muted" style={{ marginBottom: 12 }}>
            Se guardan cifradas en el servidor. Nunca se devuelven al navegador ni aparecen en
            registros. Generalas siguiendo <code>docs/CERTIFICADOS.md</code>.
          </p>
          {error && <Alert tone="err" title={error} />}
          <div className="stack" style={{ marginTop: 12 }}>
            <Field label="Certificado (PEM)" hint="Empieza con -----BEGIN CERTIFICATE-----">
              <textarea
                rows={4}
                value={certPem}
                onChange={(e) => setCertPem(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field label="Clave privada (PEM)" hint="Empieza con -----BEGIN PRIVATE KEY----- o RSA PRIVATE KEY">
              <textarea
                rows={4}
                value={keyPem}
                onChange={(e) => setKeyPem(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <div>
              <button
                type="button"
                className="btn primary"
                onClick={guardarCredenciales}
                disabled={guardando || !certPem.trim() || !keyPem.trim()}
              >
                {guardando ? <Spinner /> : null} Guardar credenciales
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function NuevoEmisor({ onCreado, yaHay }: { onCreado: () => void; yaHay: boolean }) {
  const [abierto, setAbierto] = useState(!yaHay);
  const [form, setForm] = useState({
    cuit: '',
    razonSocial: '',
    condicionIva: 'responsable_inscripto',
    domicilio: '',
    ingresosBrutos: '',
    inicioActividades: '',
    puntoVenta: 1,
    environment: 'homologacion',
    emiteM: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function crear() {
    setGuardando(true);
    setError(null);
    try {
      await api.post('/api/issuers', { ...form, cuit: form.cuit.replace(/\D/g, '') });
      setAbierto(false);
      setForm({ ...form, cuit: '', razonSocial: '' });
      onCreado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear el emisor.');
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="btn" onClick={() => setAbierto(true)}>
        + Agregar emisor
      </button>
    );
  }

  return (
    <Card title="Nuevo emisor" subtitle="Los datos que van impresos en el comprobante">
      {error && <Alert tone="err" title={error} />}
      <div className="row c2" style={{ marginTop: error ? 12 : 0 }}>
        <Field label="CUIT">
          <input
            value={form.cuit}
            onChange={(e) => set({ cuit: e.target.value })}
            placeholder="20-12345678-6"
            inputMode="numeric"
          />
        </Field>
        <Field label="Razón social o nombre">
          <input value={form.razonSocial} onChange={(e) => set({ razonSocial: e.target.value })} />
        </Field>
      </div>
      <div className="row c2" style={{ marginTop: 12 }}>
        <Field label="Condición frente al IVA" hint="Determina qué letra de comprobante podés emitir.">
          <select value={form.condicionIva} onChange={(e) => set({ condicionIva: e.target.value })}>
            {CONDICIONES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Punto de venta" hint="Tiene que estar habilitado en ARCA para web service.">
          <input
            type="number"
            min={1}
            value={form.puntoVenta}
            onChange={(e) => set({ puntoVenta: Number(e.target.value) })}
          />
        </Field>
      </div>
      <div className="row c3" style={{ marginTop: 12 }}>
        <Field label="Domicilio comercial">
          <input value={form.domicilio} onChange={(e) => set({ domicilio: e.target.value })} />
        </Field>
        <Field label="Ingresos Brutos (opcional)">
          <input value={form.ingresosBrutos} onChange={(e) => set({ ingresosBrutos: e.target.value })} />
        </Field>
        <Field label="Inicio de actividades (opcional)">
          <input
            value={form.inicioActividades}
            onChange={(e) => set({ inicioActividades: e.target.value })}
            placeholder="01/2020"
          />
        </Field>
      </div>
      <div className="row c2" style={{ marginTop: 12 }}>
        <Field label="Entorno">
          <select value={form.environment} onChange={(e) => set({ environment: e.target.value })}>
            <option value="homologacion">Homologación (pruebas)</option>
            <option value="produccion">Producción</option>
          </select>
        </Field>
        {form.condicionIva === 'responsable_inscripto' && (
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label className="check">
              <input
                type="checkbox"
                checked={form.emiteM}
                onChange={(e) => set({ emiteM: e.target.checked })}
              />
              ARCA me habilitó a emitir comprobantes M en lugar de A
            </label>
          </div>
        )}
      </div>
      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <button
          type="button"
          className="btn primary"
          onClick={crear}
          disabled={guardando || !form.cuit.trim() || !form.razonSocial.trim()}
        >
          {guardando ? <Spinner /> : null} Crear emisor
        </button>
        {yaHay && (
          <button type="button" className="btn ghost" onClick={() => setAbierto(false)}>
            Cancelar
          </button>
        )}
      </div>
    </Card>
  );
}

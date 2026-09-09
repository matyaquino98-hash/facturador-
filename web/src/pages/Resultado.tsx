import { fechaLegible, pesos, type Factura, type ResultadoArca } from '../api.ts';
import { Alert, Card } from '../components.tsx';

export function Resultado({
  factura,
  arca,
  onNueva,
  onVerHistorial,
}: {
  factura: Factura;
  arca: ResultadoArca | null;
  onNueva: () => void;
  onVerHistorial: () => void;
}) {
  const pdfUrl = `/api/facturas/${factura.id}/pdf`;

  return (
    <div className="stack">
      <Card>
        <div className="result-hero">
          <div className="result-check" aria-hidden="true">
            ✓
          </div>
          <h1>Factura generada correctamente</h1>
          <p className="muted">
            {factura.letra ? `Factura ${factura.letra}` : 'Comprobante'} ·{' '}
            {factura.numeroFormateado ?? 'sin número'}
          </p>
          <div className="result-total">{pesos(factura.totalCents)}</div>
        </div>

        <dl className="kv">
          <dt>Tipo</dt>
          <dd>Factura {factura.letra}</dd>
          <dt>Punto de venta</dt>
          <dd>{String(factura.puntoVenta).padStart(5, '0')}</dd>
          <dt>Número</dt>
          <dd>{factura.numero ?? '—'}</dd>
          <dt>Fecha</dt>
          <dd>{fechaLegible(factura.fecha)}</dd>
          <dt>Cliente</dt>
          <dd>{factura.clienteNombre}</dd>
          {factura.netoCents !== factura.totalCents && (
            <>
              <dt>Neto</dt>
              <dd>{pesos(factura.netoCents)}</dd>
              <dt>IVA</dt>
              <dd>{pesos(factura.ivaCents)}</dd>
            </>
          )}
          <dt>Total</dt>
          <dd>
            <strong>{pesos(factura.totalCents)}</strong>
          </dd>
          <dt>CAE</dt>
          <dd className="mono">{factura.cae ?? '—'}</dd>
          <dt>Vencimiento del CAE</dt>
          <dd>{fechaLegible(factura.caeVto)}</dd>
        </dl>
      </Card>

      {arca && arca.advertencias.length > 0 && (
        <Alert tone="warn" title="ARCA autorizó el comprobante con observaciones">
          <ul>
            {arca.advertencias.map((a, i) => (
              <li key={i}>
                {a.explicacion} <span className="muted">(código {a.code})</span>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {factura.environment !== 'produccion' && (
        <Alert tone="warn" title="Emitida en homologación">
          <span>Este comprobante es de prueba y no tiene validez fiscal.</span>
        </Alert>
      )}

      <div className="actions">
        <a className="btn primary" href={pdfUrl} download style={{ textDecoration: 'none' }}>
          Descargar PDF
        </a>
        <a className="btn" href={pdfUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          Ver factura
        </a>
        <button type="button" className="btn" onClick={onNueva}>
          Nueva factura
        </button>
        <button type="button" className="btn ghost" onClick={onVerHistorial}>
          Ir al historial
        </button>
      </div>
    </div>
  );
}

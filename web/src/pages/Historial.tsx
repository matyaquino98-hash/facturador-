import { useEffect, useState } from 'react';
import { api, fechaLegible, pesos, type Factura } from '../api.ts';
import { Card, Empty, Field, Spinner } from '../components.tsx';

export function Historial() {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [estado, setEstado] = useState('todos');

  useEffect(() => {
    const t = window.setTimeout(() => {
      setCargando(true);
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (desde) params.set('desde', desde.replace(/-/g, ''));
      if (hasta) params.set('hasta', hasta.replace(/-/g, ''));
      if (estado !== 'todos') params.set('estado', estado);

      api
        .get<{ facturas: Factura[]; total: number }>(`/api/facturas?${params}`)
        .then((r) => {
          setFacturas(r.facturas);
          setTotal(r.total);
        })
        .catch(() => setFacturas([]))
        .finally(() => setCargando(false));
    }, 220);
    return () => window.clearTimeout(t);
  }, [q, desde, hasta, estado]);

  return (
    <div className="stack">
      <Card title="Historial" subtitle={`${total} comprobante${total === 1 ? '' : 's'}`}>
        <div className="row c4">
          <Field label="Buscar">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cliente, CUIT o número"
            />
          </Field>
          <Field label="Desde">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
          <Field label="Estado">
            <select value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="todos">Todos</option>
              <option value="aprobado">Aprobados</option>
              <option value="rechazado">Rechazados</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card>
        {cargando ? (
          <p className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Spinner /> Cargando…
          </p>
        ) : facturas.length === 0 ? (
          <Empty title="No hay comprobantes">
            <p>
              {q || desde || hasta || estado !== 'todos'
                ? 'Probá ajustando los filtros.'
                : 'Cuando emitas tu primera factura va a aparecer acá.'}
            </p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Comprobante</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th className="num">Total</th>
                  <th>CAE</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {facturas.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.letra}</strong>{' '}
                      <span className="mono">{f.numeroFormateado ?? '—'}</span>
                      {f.estado !== 'aprobado' && (
                        <>
                          {' '}
                          <span className="badge err">Rechazada</span>
                        </>
                      )}
                      {f.environment !== 'produccion' && (
                        <>
                          {' '}
                          <span className="badge">Homolog.</span>
                        </>
                      )}
                    </td>
                    <td>{fechaLegible(f.fecha)}</td>
                    <td>
                      {f.clienteNombre}
                      <br />
                      <span className="muted mono">{f.docNro || '—'}</span>
                    </td>
                    <td className="num">{pesos(f.totalCents)}</td>
                    <td className="mono muted">{f.cae ?? '—'}</td>
                    <td className="num">
                      {f.cae && (
                        <a
                          className="btn ghost"
                          href={`/api/facturas/${f.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ textDecoration: 'none' }}
                        >
                          PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

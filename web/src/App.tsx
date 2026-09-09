import { useCallback, useEffect, useState } from 'react';
import { api, type Catalogos, type Emisor, type Factura, type ResultadoArca, type Usuario } from './api.ts';
import { Login } from './pages/Login.tsx';
import { NuevaFactura } from './pages/NuevaFactura.tsx';
import { Resultado } from './pages/Resultado.tsx';
import { Historial } from './pages/Historial.tsx';
import { Configuracion } from './pages/Configuracion.tsx';
import { Spinner } from './components.tsx';

type Vista = 'nueva' | 'resultado' | 'historial' | 'configuracion';

export function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [iniciando, setIniciando] = useState(true);
  const [vista, setVista] = useState<Vista>('nueva');
  const [emisores, setEmisores] = useState<Emisor[]>([]);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [emitida, setEmitida] = useState<{ factura: Factura; arca: ResultadoArca } | null>(null);

  const cargarDatos = useCallback(async () => {
    const [e, c] = await Promise.all([
      api.get<{ issuers: Emisor[] }>('/api/issuers'),
      api.get<Catalogos>('/api/catalogos'),
    ]);
    setEmisores(e.issuers);
    setCatalogos(c);
  }, []);

  useEffect(() => {
    api
      .get<{ user: Usuario }>('/api/auth/me')
      .then((r) => setUsuario(r.user))
      .catch(() => setUsuario(null))
      .finally(() => setIniciando(false));
  }, []);

  useEffect(() => {
    if (!usuario) return;
    cargarDatos().catch(() => {});
  }, [usuario, cargarDatos]);

  // Sin emisor configurado, lo primero es configurarlo.
  useEffect(() => {
    if (usuario && catalogos && emisores.length === 0) setVista('configuracion');
  }, [usuario, catalogos, emisores.length]);

  async function salir() {
    await api.post('/api/auth/logout');
    setUsuario(null);
    setEmisores([]);
    setEmitida(null);
    setVista('nueva');
  }

  if (iniciando) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Spinner />
      </div>
    );
  }

  if (!usuario) return <Login onEntrar={setUsuario} />;

  const enHomologacion = emisores.some((e) => e.environment === 'homologacion');

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark">F</span> Facturador
        </span>
        <nav className="nav">
          <button
            type="button"
            aria-current={vista === 'nueva' || vista === 'resultado'}
            onClick={() => {
              setEmitida(null);
              setVista('nueva');
            }}
          >
            Nueva factura
          </button>
          <button type="button" aria-current={vista === 'historial'} onClick={() => setVista('historial')}>
            Historial
          </button>
          <button
            type="button"
            aria-current={vista === 'configuracion'}
            onClick={() => setVista('configuracion')}
          >
            Configuración
          </button>
          <button type="button" onClick={salir} title={usuario.email}>
            Salir
          </button>
        </nav>
      </header>

      {enHomologacion && (
        <div className="banner-homo">
          Modo homologación — los comprobantes que emitas son de prueba y no tienen validez fiscal.
        </div>
      )}

      <main className={`main ${vista === 'historial' ? 'wide' : ''}`}>
        {!catalogos ? (
          <Spinner />
        ) : vista === 'resultado' && emitida ? (
          <Resultado
            factura={emitida.factura}
            arca={emitida.arca}
            onNueva={() => {
              setEmitida(null);
              setVista('nueva');
            }}
            onVerHistorial={() => setVista('historial')}
          />
        ) : vista === 'historial' ? (
          <Historial />
        ) : vista === 'configuracion' ? (
          <Configuracion emisores={emisores} onCambio={() => cargarDatos().catch(() => {})} />
        ) : (
          <NuevaFactura
            key={emitida?.factura.id ?? 'nueva'}
            emisores={emisores}
            catalogos={catalogos}
            onEmitida={(factura, arca) => {
              setEmitida({ factura, arca });
              setVista('resultado');
            }}
          />
        )}
      </main>
    </div>
  );
}

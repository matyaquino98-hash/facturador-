import { useState } from 'react';
import { ApiError, api, type Usuario } from '../api.ts';
import { Alert, Field, Spinner } from '../components.tsx';

export function Login({ onEntrar }: { onEntrar: (usuario: Usuario) => void }) {
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      const r = await api.post<{ user: Usuario }>(
        modo === 'login' ? '/api/auth/login' : '/api/auth/register',
        { email, password },
      );
      onEntrar(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="auth">
      <form className="card" onSubmit={enviar}>
        <h1>Facturador</h1>
        <p className="sub">Facturación electrónica ARCA</p>

        {error && <Alert tone="err" title={error} />}

        <div style={{ marginTop: error ? 14 : 0 }}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field
            label="Contraseña"
            hint={modo === 'registro' ? 'Mínimo 8 caracteres.' : undefined}
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={modo === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
            />
          </Field>
        </div>

        <button type="submit" className="btn primary lg" disabled={cargando}>
          {cargando ? <Spinner /> : null}
          {modo === 'login' ? 'Entrar' : 'Crear cuenta'}
        </button>

        <p className="switch">
          {modo === 'login' ? '¿No tenés cuenta? ' : '¿Ya tenés cuenta? '}
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setModo(modo === 'login' ? 'registro' : 'login');
              setError(null);
            }}
          >
            {modo === 'login' ? 'Registrate' : 'Iniciá sesión'}
          </button>
        </p>
      </form>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext.js';

export function LoginPage() {
  const { passwordSet, setup, login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isSetupMode = passwordSet === false;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (isSetupMode) {
        await setup(password);
      } else {
        await login(password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div className="card" style={{ maxWidth: 360, margin: '80px auto' }}>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 18, marginBottom: 16 }}>
        {isSetupMode ? 'Criar senha' : 'fumarende'}
      </h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="password" style={{ display: 'block', fontSize: 12.5, marginBottom: 6 }}>
          Senha
        </label>
        <input
          id="password"
          type="password"
          className="field-input"
          style={{ width: '100%', marginBottom: 12 }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="button-primary" style={{ width: '100%' }}>
          {isSetupMode ? 'Criar' : 'Entrar'}
        </button>
        {error && (
          <p className="error-text" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

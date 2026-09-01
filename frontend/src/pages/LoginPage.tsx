import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { PageHeader } from '../components/PageHeader.js';

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
    <div className="card login-card stack">
      <PageHeader title={isSetupMode ? 'Criar senha' : 'fumarende'} />
      <form onSubmit={handleSubmit} className="stack-sm">
        <label className="field" htmlFor="password">
          <span className="field-label">Senha</span>
          <input
            id="password"
            type="password"
            className="field-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <button type="submit" className="btn btn-primary login-submit">
          {isSetupMode ? 'Criar' : 'Entrar'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { CATEGORIES } from '../lib/expenses.js';

const fieldStyle = { display: 'block', fontSize: 12, marginBottom: 4 } as const;

export function CategoryRulesSection() {
  const [rules, setRules] = useState<api.CategoryRule[]>([]);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setRules(await api.listCategoryRules());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar regras');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.createCategoryRule({ keyword, category });
      setKeyword('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await api.deleteCategoryRule(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontFamily: 'var(--mono)', fontSize: 16, marginBottom: 12 }}>
        Regras de categoria
      </h2>

      <div className="card" style={{ marginBottom: 12 }}>
        {rules.length === 0 && (
          <p style={{ color: 'var(--text3)' }}>Nenhuma regra ainda.</p>
        )}
        {rules.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 0',
              borderBottom: '1px solid var(--border)',
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1, fontFamily: 'var(--mono)' }}>
              {r.keyword} <span style={{ color: 'var(--text3)' }}>→</span> {r.category}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(r.id)}
              aria-label={`Excluir regra ${r.keyword}`}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 12.5,
                color: 'var(--text3)',
                cursor: 'pointer',
              }}
            >
              Excluir
            </button>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleAdd}
        className="card"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div>
          <label htmlFor="rule-keyword" style={fieldStyle}>Palavra-chave</label>
          <input
            id="rule-keyword"
            type="text"
            className="field-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="rule-category" style={fieldStyle}>Categoria da regra</label>
          <select
            id="rule-category"
            className="field-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="button-primary">
          + Adicionar regra
        </button>
      </form>

      {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  );
}

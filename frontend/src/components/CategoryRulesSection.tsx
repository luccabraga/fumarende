import { useEffect, useState, type FormEvent } from 'react';
import * as api from '../lib/api.js';
import { CATEGORIES } from '../lib/expenses.js';

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
    <div className="stack-sm" style={{ marginTop: 'var(--space-5)' }}>
      <h2 className="section-title">Regras de categoria</h2>

      <div className="card">
        {rules.length === 0 && <p className="subtle">Nenhuma regra ainda.</p>}
        {rules.map((r) => (
          <div key={r.id} className="list-row">
            <span style={{ flex: 1 }} className="mono">
              {r.keyword} <span className="subtle">→</span> {r.category}
            </span>
            <button
              type="button"
              onClick={() => handleDelete(r.id)}
              aria-label={`Excluir regra ${r.keyword}`}
              className="link-btn"
            >
              Excluir
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={handleAdd} className="card form-grid">
        <div className="field">
          <label className="field-label" htmlFor="rule-keyword">Palavra-chave</label>
          <input
            id="rule-keyword"
            type="text"
            className="field-input"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="rule-category">Categoria da regra</label>
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

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

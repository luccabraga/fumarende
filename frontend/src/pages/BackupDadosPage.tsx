import { useRef, useState } from 'react';
import * as api from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { AsyncBoundary } from '../components/AsyncBoundary.js';
import { EmptyState } from '../components/EmptyState.js';
import { PageHeader } from '../components/PageHeader.js';
import { useToast } from '../context/ToastContext.js';

const CONFIRM_PHRASE = 'APAGAR TUDO';

export function BackupDadosPage() {
  const { toast } = useToast();
  const r = useResource(
    () => Promise.all([api.getDiagnostics(), api.listMonthlyClose()]),
    [],
  );
  const [diag, months] = r.data ?? [null, [] as api.MonthCloseRow[]];
  const [phrase, setPhrase] = useState('');
  const [importAck, setImportAck] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [hasFile, setHasFile] = useState(false);

  const phraseOk = phrase.trim() === CONFIRM_PHRASE;

  async function run(fn: () => Promise<{ backupPath: string | null }>, done: string) {
    try {
      const { backupPath } = await fn();
      toast('success', `${done}${backupPath ? ` Backup em ${backupPath}.` : ''}`);
      setPhrase('');
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    let parsed: unknown;
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
      parsed = JSON.parse(text);
    } catch {
      toast('error', 'Arquivo não é um JSON válido');
      return;
    }
    try {
      const { backupPath, imported } = await api.importData(parsed);
      const total = Object.values(imported).reduce((s, n) => s + n, 0);
      toast(
        'success',
        `Importado (${total} linhas).${backupPath ? ` Backup em ${backupPath}.` : ''}`,
      );
      setImportAck(false);
      setHasFile(false);
      if (fileRef.current) fileRef.current.value = '';
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Falha na importação');
    }
  }

  async function toggleMonth(row: api.MonthCloseRow) {
    try {
      if (row.reviewed) await api.unmarkMonthReviewed(row.month);
      else await api.markMonthReviewed(row.month);
      r.reload();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Erro desconhecido');
    }
  }

  return (
    <div className="page">
      <PageHeader title="Backup & Dados" />

      <AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload}>
        <div className="card">
          <h2 className="section-title">Diagnóstico</h2>
          {diag && (
            <div className="data-list">
              {Object.entries(diag.rowCounts).map(([t, n]) => (
                <div key={t}>Linhas — {t}: {n}</div>
              ))}
              <div>Tamanho do banco: {(diag.dbSizeBytes / 1024).toFixed(1)} KB</div>
              <div>Migrações: {diag.migrations.join(', ')}</div>
              <div>
                Último backup:{' '}
                {diag.lastBackup ? new Date(diag.lastBackup).toLocaleString('pt-BR') : '—'} (
                {diag.backupCount} arquivos)
              </div>
            </div>
          )}
        </div>
      </AsyncBoundary>

      <div className="card">
        <h2 className="section-title">Exportar</h2>
        <a href={api.EXPORT_URL} download className="btn btn-primary">
          Baixar snapshot (.json)
        </a>
      </div>

      <div className="card stack-sm">
        <h2 className="section-title">Importar</h2>
        <p className="subtle">
          Substitui todos os dados atuais. Um backup do banco é feito antes.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Arquivo de importação"
          onChange={(e) => setHasFile((e.target.files?.length ?? 0) > 0)}
          style={{ display: 'block' }}
        />
        <label className="row-sm">
          <input
            type="checkbox"
            checked={importAck}
            onChange={(e) => setImportAck(e.target.checked)}
          />{' '}
          Entendo que isto substitui todos os dados atuais
        </label>
        <button
          type="button"
          className="button-primary"
          disabled={!hasFile || !importAck}
          onClick={handleImport}
        >
          Importar
        </button>
      </div>

      <div className="card stack-sm">
        <h2 className="section-title">Zona de perigo</h2>
        <p className="subtle">
          Digite <strong>{CONFIRM_PHRASE}</strong> para habilitar. Ambas as ações fazem um backup
          antes.
        </p>
        <input
          type="text"
          aria-label="Frase de confirmação"
          className="field-input"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          style={{ display: 'block' }}
        />
        <div className="row">
          <button
            type="button"
            className="button-primary"
            disabled={!phraseOk}
            onClick={() => run(() => api.wipeData(phrase.trim()), 'Dados apagados.')}
          >
            Apagar todos os dados
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={!phraseOk}
            onClick={() => run(() => api.seedTestData(phrase.trim()), 'Dados de teste carregados.')}
          >
            Carregar dados de teste
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Fechamento mensal</h2>
        {months.length === 0 ? (
          <EmptyState message="Nenhum mês com dados ainda." />
        ) : (
          months.map((row) => (
            <div
              key={row.month}
              className="list-row"
              style={{ alignItems: 'center', justifyContent: 'flex-start' }}
            >
              <input
                type="checkbox"
                checked={row.reviewed}
                aria-label={`Revisado ${row.month}`}
                onChange={() => toggleMonth(row)}
              />
              <span className="mono">{row.month}</span>
              {row.reviewed && row.reviewedAt && (
                <span className="subtle">
                  revisado em {new Date(row.reviewedAt).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

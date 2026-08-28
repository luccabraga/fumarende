import { goalsApi } from '../lib/api.js';
import { TargetSection } from '../components/TargetSection.js';

export function MetasPage() {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>Metas</h1>
      <TargetSection
        api={goalsApi}
        showNotes={false}
        heading="Suas metas"
        emptyText="Nenhuma meta ainda. Crie a primeira."
      />
    </div>
  );
}

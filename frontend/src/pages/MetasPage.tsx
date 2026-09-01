import { goalsApi } from '../lib/api.js';
import { TargetSection } from '../components/TargetSection.js';

export function MetasPage() {
  return (
    <div>
      <h1 className="page-title">Metas</h1>
      <TargetSection
        api={goalsApi}
        showNotes={false}
        heading="Suas metas"
        emptyText="Nenhuma meta ainda. Crie a primeira."
      />
    </div>
  );
}

import { goalsApi } from '../lib/api.js';
import { TargetSection } from '../components/TargetSection.js';
import { PageHeader } from '../components/PageHeader.js';

export function MetasPage() {
  return (
    <div className="page">
      <PageHeader title="Metas" />
      <TargetSection
        api={goalsApi}
        showNotes={false}
        heading="Suas metas"
        emptyText="Nenhuma meta ainda. Crie a primeira."
      />
    </div>
  );
}

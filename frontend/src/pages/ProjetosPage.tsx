import { projectsApi } from '../lib/api.js';
import { TargetSection } from '../components/TargetSection.js';
import { PageHeader } from '../components/PageHeader.js';

export function ProjetosPage() {
  return (
    <div className="page">
      <PageHeader title="Projetos Especiais" />
      <TargetSection
        api={projectsApi}
        showNotes
        heading="Seus projetos especiais"
        emptyText="Seus grandes sonhos ficam aqui. Crie o primeiro."
      />
    </div>
  );
}

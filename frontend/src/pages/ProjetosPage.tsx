import { projectsApi } from '../lib/api.js';
import { TargetSection } from '../components/TargetSection.js';

export function ProjetosPage() {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, marginBottom: 20 }}>
        Projetos Especiais
      </h1>
      <TargetSection
        api={projectsApi}
        showNotes
        heading="Seus projetos especiais"
        emptyText="Seus grandes sonhos ficam aqui. Crie o primeiro."
      />
    </div>
  );
}

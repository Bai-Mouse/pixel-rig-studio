import { useState } from 'react';
import { Icon } from './Icon';
import type { RecentProject } from '../project/recentProjects';

interface ProjectStartScreenProps {
  onCreateEmpty: () => void;
  onCreateCharacter: () => void;
  onImport: () => void;
  recentProjects: RecentProject[];
  onOpenRecent: (recent: RecentProject) => void;
  onReturnToEditor?: () => void;
}

function recentDate(savedAt: string) {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? 'Saved project' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function ProjectStartScreen({ onCreateEmpty, onCreateCharacter, onImport, recentProjects, onOpenRecent, onReturnToEditor }: ProjectStartScreenProps) {
  const [step, setStep] = useState<'start' | 'new'>('start');

  return (
    <main className="project-start-screen">
      <section className="project-start-card">
        <div className="project-start-brand"><span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span><span>Pixel Rig <strong>Studio</strong></span></div>
        {step === 'start' ? (
          <>
            <div className="project-start-heading"><span>WELCOME</span><h1>Start your next animation.</h1><p>Create a fresh pixel rig or open a project you already saved.</p></div>
            <div className="project-start-actions">
              <button type="button" className="project-start-option primary" onClick={() => setStep('new')}><Icon name="plus" size={22} /><span><strong>New project</strong><small>Start with a blank canvas or a character rig.</small></span><Icon name="chevron" size={16} /></button>
              <button type="button" className="project-start-option" onClick={onImport}><Icon name="import" size={22} /><span><strong>Import project</strong><small>Open a saved Pixel Rig Studio project file.</small></span><Icon name="chevron" size={16} /></button>
            </div>
            {recentProjects.length > 0 && (
              <div className="recent-project-section">
                <div className="recent-project-heading"><strong>Recent projects</strong><span>{recentProjects.length}</span></div>
                <div className="recent-project-list">
                  {recentProjects.map((recent) => (
                    <button key={recent.id} type="button" className="recent-project-card" onClick={() => onOpenRecent(recent)}>
                      <span className="recent-project-icon"><Icon name="layers" size={17} /></span>
                      <span><strong>{recent.name}</strong><small title={recent.path ?? 'Saved project snapshot'}>{recent.path ?? 'Saved project snapshot'}</small><small>{recentDate(recent.savedAt)}</small></span>
                      <Icon name="chevron" size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="project-start-heading"><button type="button" className="project-start-back" onClick={() => setStep('start')}>‹ Back</button><span>NEW PROJECT</span><h1>Choose a starting point.</h1><p>You can add sprites and nodes at any time after creating the project.</p></div>
            <div className="project-template-grid">
              <button type="button" className="project-template" onClick={onCreateEmpty}><span className="template-preview blank"><i /><i /><i /><i /></span><strong>Empty project</strong><small>Blank canvas with no sprites or nodes.</small></button>
              <button type="button" className="project-template character" onClick={onCreateCharacter}><span className="template-preview character"><i className="template-head" /><i className="template-body" /><i className="template-arm left" /><i className="template-arm right" /><i className="template-leg left" /><i className="template-leg right" /></span><strong>Character template</strong><small>Choose a sheet, map each part and nudge the pose before you start.</small></button>
            </div>
          </>
        )}
        {onReturnToEditor && <button type="button" className="project-start-return" onClick={onReturnToEditor}>Return to current project</button>}
      </section>
    </main>
  );
}

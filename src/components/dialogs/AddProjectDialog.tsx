import { useState, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';
import { Icon } from '../terminal/Icon';
import { NewProjectForm } from './NewProjectForm';
import { CloneFromGithubForm } from './CloneFromGithubForm';
import { ProjectSourceList, type ProjectSourceKind } from '../projectSources';

/**
 * What the caller has to act on. Opening a folder is handed back rather than
 * handled here: the picker is an OS window, and a folder that turns out not to
 * be a git repo has its own recovery dialog to run afterwards.
 */
export type AddProjectResult =
  | { kind: 'add-existing' }
  | { kind: 'created'; projectPath: string }
  | { kind: 'cloning'; projectPath: string };

/** Opening a folder never becomes a step — it leaves the dialog immediately. */
export type AddProjectStep = 'choose' | 'create' | 'clone';

const TITLES: Record<AddProjectStep, string> = {
  choose: 'Add a project',
  create: 'New project',
  clone: 'Clone from GitHub',
};

/** One dialog for every way a project arrives. */
export function AddProjectDialog({
  initialStep = 'choose',
  onClose,
}: {
  initialStep?: AddProjectStep;
  onClose: (result: AddProjectResult | null) => void;
}) {
  const [step, setStep] = useState<AddProjectStep>(initialStep);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(
    (result: AddProjectResult | null) => {
      setVisible(false);
      setTimeout(() => onClose(result), 200);
    },
    [onClose],
  );

  const choose = useCallback(
    (kind: ProjectSourceKind) => {
      if (kind === 'add-existing') dismiss({ kind: 'add-existing' });
      else setStep(kind);
    },
    [dismiss],
  );

  // Only a step reached from the chooser can go back to it; opening the dialog
  // straight into a form means the choice was already made elsewhere.
  const canGoBack = step !== 'choose' && initialStep === 'choose';

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)} maxWidth={480}>
      <div className="relative flex items-center justify-center mb-4">
        {canGoBack && (
          <button
            className="absolute left-0 w-7 h-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-ink/[0.06] transition-colors duration-100"
            aria-label="Back"
            onClick={() => setStep('choose')}
          >
            <Icon name="arrow-left" className="w-4 h-4" />
          </button>
        )}
        <h2 className="text-lg font-semibold text-text-primary text-center">{TITLES[step]}</h2>
      </div>

      {step === 'choose' && <ProjectSourceList onChoose={choose} />}
      {step === 'create' && (
        <NewProjectForm
          onCancel={() => dismiss(null)}
          onCreated={(projectPath) => dismiss({ kind: 'created', projectPath })}
        />
      )}
      {step === 'clone' && (
        <CloneFromGithubForm
          onCancel={() => dismiss(null)}
          onStarted={(projectPath) => dismiss({ kind: 'cloning', projectPath })}
        />
      )}
    </DialogOverlay>
  );
}

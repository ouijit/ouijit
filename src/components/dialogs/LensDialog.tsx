import { useEffect, useState } from 'react';
import type { LensSummary } from '../../github/service';
import { LensList } from '../scripts/LensList';
import { Icon } from '../terminal/Icon';
import { DialogOverlay } from './DialogOverlay';

interface LensDialogProps {
  projectPath: string;
  /** Omitted, the dialog only manages lenses — nothing to write one against. */
  onRun?: (lens: LensSummary) => void;
  running?: string | null;
  onClose: () => void;
}

/**
 * The project's lenses, opened from wherever one is wanted.
 *
 * Configuring these used to mean leaving the pull request for the settings
 * panel and finding your way back, which is a long way to go to answer "what
 * would this change look like grouped". The same list settings shows is here,
 * with a way to write one against the pull request already open.
 */
export function LensDialog({ projectPath, onRun, running, onClose }: LensDialogProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = () => {
    setVisible(false);
    setTimeout(onClose, 150);
  };

  return (
    <DialogOverlay visible={visible} onDismiss={dismiss} maxWidth={560}>
      <div className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Icon name="aperture" className="w-5 h-5 text-accent" />
            Lenses
          </h2>
          <p className="mt-1 text-xs text-text-tertiary leading-snug">
            A lens reads the diff and says what the parts of this change are, so the Code pane can be read in the order
            the change was made. The command is what a project keeps; the grouping belongs to one pull request.
          </p>
        </div>

        <LensList projectPath={projectPath} onRun={onRun} running={running} />

        <div className="flex justify-end">
          <button
            className="px-3 py-1.5 text-xs font-medium rounded-md text-text-secondary hover:bg-ink/[0.06] transition-colors duration-150"
            onClick={dismiss}
          >
            Done
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}

import { useEffect, useState } from 'react';
import type { LensSummary } from '../../lens/config';
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
 * The same list the settings panel shows, plus a way to run one against the
 * pull request already open — so answering "what would this change look like
 * grouped" does not cost leaving it and finding your way back.
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
    <DialogOverlay visible={visible} onDismiss={dismiss} maxWidth={620}>
      <div className="space-y-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
            <Icon name="aperture" className="w-5 h-5 text-accent" />
            Lenses
          </h2>
          <p className="mt-1.5 text-xs text-text-tertiary leading-relaxed">
            {onRun
              ? 'Lenses group a diff into named parts so you can review by change, not by file. Select one to apply to this pull request.'
              : 'Lenses group a diff into named parts so you can review by change, not by file. Each one is saved with the project and applies to any pull request.'}
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

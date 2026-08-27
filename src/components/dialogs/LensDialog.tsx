import { useEffect, useState } from 'react';
import type { LensSummary } from '../../lens/config';
import { LensList } from '../scripts/LensList';
import { LensAgentRow } from '../scripts/LensAgentRow';
import { Icon } from '../terminal/Icon';
import { Tooltip } from '../ui/Tooltip';
import { DialogOverlay } from './DialogOverlay';

interface LensDialogProps {
  projectPath: string;
  /**
   * Reads the change through a lens just saved here. Omitted, there is nothing
   * to read one against and saving is all a form can do.
   */
  onRun?: (lens: LensSummary) => void;
  running?: string | null;
  onClose: () => void;
}

/**
 * The same list the settings panel shows, plus a way to run one against the diff
 * already open. Nothing here spends a run except a button that says Run: the
 * rows themselves are inert, so no press costs an agent run by surprise.
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
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
          <Icon name="aperture" className="w-5 h-5 text-accent" />
          Lenses
          <Tooltip
            text="Lenses group a diff into named parts so you can review by change, not by file. Each one is saved with the project and applies to any diff."
            wrapAt={280}
            placement="bottom-start"
          >
            <span
              tabIndex={0}
              role="note"
              aria-label="What a lens is"
              className="text-text-tertiary hover:text-text-secondary focus-visible:text-text-secondary transition-colors duration-150"
            >
              <Icon name="info" className="w-4 h-4" />
            </span>
          </Tooltip>
        </h2>

        {/* Running one closes this; saving and editing leave it open. */}
        <LensList
          projectPath={projectPath}
          onRun={
            onRun &&
            ((lens) => {
              onRun(lens);
              dismiss();
            })
          }
          running={running}
        />

        {/* Beside Done rather than among the lenses: it is not one of them. */}
        <div className="flex items-center gap-2">
          <LensAgentRow projectPath={projectPath} />
          <div className="flex-1" />
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

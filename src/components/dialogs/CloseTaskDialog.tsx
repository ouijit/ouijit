import { useState, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';

interface CloseTaskDialogProps {
  taskName: string;
  otherTerminalCount: number;
  onClose: (action: 'close-all' | 'just-this' | null) => void;
}

export function CloseTaskDialog({ taskName, otherTerminalCount, onClose }: CloseTaskDialogProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(
    (action: 'close-all' | 'just-this' | null) => {
      setVisible(false);
      setTimeout(() => onClose(action), 200);
    },
    [onClose],
  );

  const plural = otherTerminalCount === 1 ? 'terminal' : 'terminals';

  return (
    <DialogOverlay visible={visible} onDismiss={() => dismiss(null)} maxWidth={340}>
      <h2 data-testid="dialog-title" className="text-lg font-semibold text-text-primary mb-4 text-center">
        Close Task
      </h2>
      <p className="text-sm text-text-secondary text-center">
        &ldquo;<strong className="text-text-primary">{taskName}</strong>&rdquo; has {otherTerminalCount} other open{' '}
        {plural}. Close {otherTerminalCount === 1 ? 'it' : 'them'} too?
      </p>
      <div className="flex gap-2 justify-end mt-4 items-center">
        <button
          data-testid="dialog-cancel"
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-text-secondary bg-transparent hover:bg-white/[0.06] whitespace-nowrap"
          onClick={() => dismiss(null)}
        >
          Cancel
        </button>
        <button
          data-testid="dialog-just-this"
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-accent bg-accent-light hover:bg-[rgba(0,122,255,0.15)] whitespace-nowrap"
          onClick={() => dismiss('just-this')}
        >
          Keep Others
        </button>
        <button
          data-testid="dialog-close-all"
          className="inline-flex items-center justify-center gap-2 px-4 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-white bg-accent hover:bg-accent-hover active:scale-[0.98] whitespace-nowrap"
          onClick={() => dismiss('close-all')}
        >
          Close All
        </button>
      </div>
    </DialogOverlay>
  );
}

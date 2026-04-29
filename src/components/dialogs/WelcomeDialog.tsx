import { useState, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';
import { Icon } from '../terminal/Icon';

interface WelcomeDialogProps {
  onClose: () => void;
}

interface FeatureRow {
  icon: string;
  title: string;
  body: string;
  accent?: 'default' | 'accent' | 'claude';
}

const FEATURES: FeatureRow[] = [
  {
    icon: 'folder-plus',
    title: 'Add a project',
    body: 'Point Ouijit at any git repository on disk.',
  },
  {
    icon: 'kanban',
    title: 'Create a task',
    body: 'Each task is a card on a kanban board — todo, in progress, in review, done.',
  },
  {
    icon: 'terminal',
    title: 'Worktree + terminal',
    body: 'Every task gets an isolated git worktree and its own terminal. Bring your CLI agent — Claude Code recommended.',
    accent: 'accent',
  },
];

const PRIVACY_URL = 'https://github.com/ouijit/ouijit#privacy';

export function WelcomeDialog({ onClose }: WelcomeDialogProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  const openPrivacy = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    window.api.openExternal(PRIVACY_URL);
  }, []);

  return (
    <DialogOverlay visible={visible} onDismiss={dismiss} maxWidth={480}>
      <div className="flex justify-center mb-4">
        <div
          aria-hidden
          className="sidebar-home-logo-mask w-12 h-12"
          style={{ backgroundColor: 'var(--color-accent)' }}
        />
      </div>
      <h2 className="text-lg font-semibold text-text-primary mb-1 text-center">Welcome to Ouijit</h2>
      <p className="text-xs text-text-secondary text-center mb-5">A project manager that thinks in worktrees.</p>

      <div
        className="glass-bevel relative border border-black/60 rounded-[14px] overflow-hidden divide-y divide-white/[0.06]"
        style={{
          background: 'var(--color-terminal-bg, #171717)',
          boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.05), 0 4px 12px rgba(0, 0, 0, 0.15), 0 20px 40px rgba(0, 0, 0, 0.2)',
        }}
      >
        {FEATURES.map((feature) => {
          const iconColor = feature.accent === 'accent' ? 'var(--color-accent)' : 'var(--color-text-secondary)';
          return (
            <div key={feature.title} className="flex items-start gap-3 px-4 py-3">
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                style={{ background: 'rgba(255, 255, 255, 0.06)', color: iconColor }}
              >
                <Icon name={feature.icon} className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary">{feature.title}</div>
                <div className="text-xs text-text-secondary leading-snug mt-0.5">{feature.body}</div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-text-tertiary text-center mt-4">
        No telemetry.{' '}
        <a className="text-accent hover:underline" href={PRIVACY_URL} onClick={openPrivacy}>
          Learn more
        </a>
      </p>

      <div className="flex justify-end mt-5">
        <button
          className="inline-flex items-center justify-center gap-2 px-5 py-1.5 font-sans text-sm font-medium no-underline border-none rounded-full outline-none transition-all duration-150 ease-out [-webkit-app-region:no-drag] focus-visible:ring-3 focus-visible:ring-accent-light text-white bg-accent hover:bg-accent-hover active:scale-[0.98]"
          onClick={dismiss}
        >
          Get started
        </button>
      </div>
    </DialogOverlay>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { DialogOverlay } from './DialogOverlay';
import { Icon } from '../terminal/Icon';
import { OuijitLogotype } from '../OuijitLogotype';
import { WEBSITE_URL, DOCS_URL, REPO_URL } from '../../constants/links';

interface AboutDialogProps {
  version: string;
  onClose: () => void;
}

function LinkPill({ icon, label, url }: { icon: string; label: string; url: string }) {
  return (
    <button
      className="inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full text-text-secondary bg-ink/5 hover:bg-ink/10 hover:text-text-primary active:scale-[0.98] transition-all duration-150 ease-out"
      onClick={() => void window.api.openExternal(url)}
    >
      <Icon name={icon} className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

export function AboutDialog({ version, onClose }: AboutDialogProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  return (
    <DialogOverlay visible={visible} onDismiss={dismiss} maxWidth={340}>
      <div className="flex flex-col items-center text-center">
        <OuijitLogotype className="w-[150px] h-auto" />
        <p className="mt-3 text-xs text-text-tertiary">Version {version}</p>
        <div className="flex flex-wrap justify-center gap-2 mt-5">
          <LinkPill icon="globe-simple" label="Website" url={WEBSITE_URL} />
          <LinkPill icon="file-text" label="Docs" url={DOCS_URL} />
          <LinkPill icon="github-logo" label="GitHub" url={REPO_URL} />
        </div>
      </div>
    </DialogOverlay>
  );
}

import { useState, useEffect, useCallback } from 'react';

export const DIALOG_INPUT_CLASS =
  'w-full h-9 px-4 font-sans text-sm text-text-primary bg-background border border-border rounded-md outline-none transition-all duration-150 ease-out focus:border-accent focus:ring-3 focus:ring-accent-light placeholder:text-text-tertiary';

/** `location` is null until the default has loaded, which is what forms gate on. */
export function useProjectLocation(): {
  location: string | null;
  loadError: string | null;
  chooseLocation: () => Promise<void>;
} {
  const [location, setLocation] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api
      .getDefaultProjectsFolder()
      .then((folder) => {
        if (!cancelled) setLocation(folder);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the projects folder. Choose a location.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chooseLocation = useCallback(async () => {
    const result = await window.api.showFolderPicker({
      title: 'Choose Projects Folder',
      buttonLabel: 'Choose',
      defaultPath: location ?? undefined,
    });
    if (!result.canceled && result.filePaths.length > 0) setLocation(result.filePaths[0]);
  }, [location]);

  return { location, loadError, chooseLocation };
}

export function ProjectLocationField({
  location,
  onChoose,
  disabled,
}: {
  location: string | null;
  onChoose: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text-secondary">Location</span>
      <div className="flex items-center gap-2">
        <div
          className="flex-1 min-w-0 h-9 px-4 flex items-center text-xs font-mono text-text-secondary bg-background border border-border rounded-md truncate"
          title={location ?? undefined}
        >
          <span className="truncate">{location ?? '…'}</span>
        </div>
        <button className="btn-secondary shrink-0" onClick={onChoose} disabled={disabled}>
          Choose…
        </button>
      </div>
    </div>
  );
}

import { useState, useSyncExternalStore } from 'react';
import {
  subscribeTheme,
  getThemePreference,
  getCustomThemes,
  setThemePreference,
  saveCustomTheme,
  deleteCustomTheme,
} from '../theme/themeManager';
import { parseCustomTheme, type CustomTheme, type ThemePreference } from '../theme/themes';
import { PRESET_THEMES } from '../theme/presets';
import { DialogOverlay } from './dialogs/DialogOverlay';

const BUILT_IN_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const CUSTOM_THEME_TEMPLATE = `{
  "id": "my-theme",
  "name": "My Theme",
  "base": "dark",
  "tokens": {
    "--color-accent": "#ff2d55",
    "--color-accent-hover": "#ff5c77"
  }
}`;

/**
 * Appearance settings: pick a built-in theme (system-following, light, dark)
 * or a custom theme. Custom themes are token overrides on top of a built-in
 * base — any token from src/theme/tokens.css can be overridden.
 */
export function ThemeSettingsSection() {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference);
  const customThemes = useSyncExternalStore(subscribeTheme, getCustomThemes);
  const [editor, setEditor] = useState<{ initial: string; editingId: string | null } | null>(null);

  // A user theme saved with a preset's id shadows it; the user copy renders
  // in the custom list instead.
  const presets = PRESET_THEMES.filter((preset) => !customThemes.some((t) => t.id === preset.id));

  return (
    <section>
      <h2 className="text-sm font-semibold text-text-primary mb-4">Appearance</h2>
      <div
        className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-ink/[0.06] bg-terminal-bg"
        style={{ boxShadow: 'var(--shadow-panel)' }}
      >
        <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">Theme</div>
            <div className="text-xs text-text-tertiary mt-0.5">System follows the OS light/dark appearance.</div>
          </div>
          <div className="flex items-center gap-1 shrink-0 rounded-full bg-ink/[0.06] p-0.5">
            {BUILT_IN_OPTIONS.map((option) => (
              <SegmentButton
                key={option.value}
                label={option.label}
                selected={preference === option.value}
                onSelect={() => void setThemePreference(option.value)}
              />
            ))}
          </div>
        </div>

        {presets.map((theme) => (
          <PresetThemeRow
            key={theme.id}
            theme={theme}
            selected={preference === `custom:${theme.id}`}
            onSelect={() => void setThemePreference(`custom:${theme.id}`)}
            onEdit={() => setEditor({ initial: JSON.stringify(theme, null, 2), editingId: theme.id })}
          />
        ))}

        {customThemes.map((theme) => (
          <CustomThemeRow
            key={theme.id}
            theme={theme}
            selected={preference === `custom:${theme.id}`}
            onSelect={() => void setThemePreference(`custom:${theme.id}`)}
            onEdit={() => setEditor({ initial: JSON.stringify(theme, null, 2), editingId: theme.id })}
            onRemove={() => void deleteCustomTheme(theme.id)}
          />
        ))}

        <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">Custom themes</div>
            <div className="text-xs text-text-tertiary mt-0.5">
              A custom theme overrides design tokens on top of the light or dark base.
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={() => setEditor({ initial: CUSTOM_THEME_TEMPLATE, editingId: null })}
          >
            Add…
          </button>
        </div>
      </div>

      {editor && (
        <CustomThemeDialog
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSave={async (theme) => {
            await saveCustomTheme(theme);
            await setThemePreference(`custom:${theme.id}`);
            setEditor(null);
          }}
        />
      )}
    </section>
  );
}

function SegmentButton({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors duration-150 ${
        selected ? 'bg-accent text-accent-ink' : 'text-text-secondary hover:text-text-primary hover:bg-ink/[0.06]'
      }`}
    >
      {label}
    </button>
  );
}

interface PresetThemeRowProps {
  theme: CustomTheme;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

/** A built-in preset theme. Editing saves a user copy that shadows it. */
function PresetThemeRow({ theme, selected, onSelect, onEdit }: PresetThemeRowProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{theme.name}</div>
        <div className="text-xs text-text-tertiary mt-0.5">
          Preset · {theme.base === 'dark' ? 'Dark' : 'Light'} base
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={onSelect}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors duration-150 ${
            selected ? 'bg-accent text-accent-ink' : 'bg-ink/[0.06] text-text-secondary hover:text-text-primary'
          }`}
        >
          {selected ? 'Selected' : 'Use'}
        </button>
        <button type="button" className="btn-secondary" onClick={onEdit}>
          Edit…
        </button>
      </div>
    </div>
  );
}

interface CustomThemeRowProps {
  theme: CustomTheme;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

function CustomThemeRow({ theme, selected, onSelect, onEdit, onRemove }: CustomThemeRowProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{theme.name}</div>
        <div className="text-xs text-text-tertiary mt-0.5">
          {theme.base === 'dark' ? 'Dark' : 'Light'} base · {Object.keys(theme.tokens).length}{' '}
          {Object.keys(theme.tokens).length === 1 ? 'token' : 'tokens'}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          onClick={onSelect}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors duration-150 ${
            selected ? 'bg-accent text-accent-ink' : 'bg-ink/[0.06] text-text-secondary hover:text-text-primary'
          }`}
        >
          {selected ? 'Selected' : 'Use'}
        </button>
        <button type="button" className="btn-secondary" onClick={onEdit}>
          Edit…
        </button>
        <button type="button" className="btn-secondary text-error" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

interface CustomThemeDialogProps {
  initial: string;
  onClose: () => void;
  onSave: (theme: CustomTheme) => Promise<void>;
}

function CustomThemeDialog({ initial, onClose, onSave }: CustomThemeDialogProps) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setError('Not valid JSON.');
      return;
    }
    const theme = parseCustomTheme(parsed);
    if (!theme) {
      setError('Needs "id", "name", "base" ("dark" or "light"), and a "tokens" object of --token overrides.');
      return;
    }
    await onSave(theme);
  };

  return (
    <DialogOverlay visible onDismiss={onClose} maxWidth={560}>
      <h2 className="text-base font-semibold text-text-primary">Custom theme</h2>
      <p className="text-xs text-text-tertiary mt-1">
        Overrides design tokens from src/theme/tokens.css on top of the chosen base theme.
      </p>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        spellCheck={false}
        rows={14}
        className="w-full mt-4 px-3 py-2 text-[13px] font-mono leading-relaxed bg-ink/[0.04] border border-ink/10 rounded-md text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent-light resize-y"
      />
      {error && <div className="text-xs text-error mt-2">{error}</div>}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void handleSave()}>
          Save
        </button>
      </div>
    </DialogOverlay>
  );
}

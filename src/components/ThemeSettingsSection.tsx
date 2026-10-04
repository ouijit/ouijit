import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  subscribeTheme,
  getThemePreference,
  getCustomThemes,
  setThemePreference,
  saveCustomTheme,
  deleteCustomTheme,
  previewTheme,
} from '../theme/themeManager';
import { parseCustomTheme, type CustomTheme, type ThemePreference } from '../theme/themes';
import { PRESET_THEMES } from '../theme/presets';
import { SettingsDropdown, SettingsDropdownOption, SettingsDropdownDivider } from './ui/SettingsDropdown';
import { DialogOverlay } from './dialogs/DialogOverlay';

const CUSTOM_THEME_TEMPLATE = `{
  "id": "my-theme",
  "name": "My Theme",
  "base": "dark",
  "tokens": {
    "--color-accent": "#ff2d55",
    "--color-accent-hover": "#ff5c77"
  }
}`;

interface ThemeOption {
  value: ThemePreference;
  label: string;
  hint?: string;
}

/**
 * Appearance settings: one dropdown picks the theme — built-ins
 * (system-following, light, dark), bundled presets, and user custom themes.
 * Custom themes are token overrides on top of a built-in base — any token
 * from src/theme/tokens.css can be overridden.
 */
export function ThemeSettingsSection() {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference);
  const customThemes = useSyncExternalStore(subscribeTheme, getCustomThemes);
  const [editor, setEditor] = useState<{ initial: string; editingId: string | null } | null>(null);

  // A user theme saved with a preset's id shadows it; the user copy is
  // listed in the custom group instead.
  const presets = PRESET_THEMES.filter((preset) => !customThemes.some((t) => t.id === preset.id));

  const allGroups: ThemeOption[][] = [
    [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ],
    presets.map((theme): ThemeOption => ({ value: `custom:${theme.id}`, label: theme.name, hint: 'Preset' })),
    customThemes.map((theme): ThemeOption => ({ value: `custom:${theme.id}`, label: theme.name, hint: 'Custom' })),
  ];
  const optionGroups = allGroups.filter((group) => group.length > 0);

  return (
    <section>
      <h2 className="text-sm font-semibold text-text-primary mb-4">Appearance</h2>
      <div className="glass-bevel relative border border-bezel-panel rounded-[14px] overflow-hidden divide-y divide-separator bg-terminal-bg">
        <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.02]">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-text-primary">Theme</div>
            <div className="text-xs text-text-tertiary mt-0.5">System follows the OS light/dark appearance.</div>
          </div>
          <ThemeDropdown value={preference} groups={optionGroups} onSelect={(next) => void setThemePreference(next)} />
        </div>

        {customThemes.map((theme) => (
          <CustomThemeRow
            key={theme.id}
            theme={theme}
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

interface ThemeDropdownProps {
  value: ThemePreference;
  groups: ThemeOption[][];
  onSelect: (value: ThemePreference) => void;
}

function ThemeDropdown({ value, groups, onSelect }: ThemeDropdownProps) {
  const [open, setOpen] = useState(false);

  // Any way the dropdown closes (select, click-outside, escape, unmount)
  // ends the hover preview. Selection commits first in select(), so the
  // clear is a no-op there.
  useEffect(() => {
    if (!open) previewTheme(null);
    return () => previewTheme(null);
  }, [open]);

  const selected = groups.flat().find((o) => o.value === value) ?? null;

  const select = (next: ThemePreference) => {
    setOpen(false);
    onSelect(next);
  };

  return (
    <SettingsDropdown
      open={open}
      onOpenChange={setOpen}
      widthClass="w-[13rem]"
      ariaLabel="Choose theme"
      triggerLabel={selected?.label ?? 'System'}
      onMenuMouseLeave={() => previewTheme(null)}
    >
      {groups.map((group, i) => (
        <div key={i}>
          {i > 0 && <SettingsDropdownDivider />}
          {group.map((option) => (
            <SettingsDropdownOption
              key={option.value}
              label={option.label}
              hint={option.hint}
              selected={option.value === value}
              onMouseEnter={() => previewTheme(option.value)}
              onClick={() => select(option.value)}
            />
          ))}
        </div>
      ))}
    </SettingsDropdown>
  );
}

interface CustomThemeRowProps {
  theme: CustomTheme;
  onEdit: () => void;
  onRemove: () => void;
}

function CustomThemeRow({ theme, onEdit, onRemove }: CustomThemeRowProps) {
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

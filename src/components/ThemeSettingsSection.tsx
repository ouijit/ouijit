import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';
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
import { Icon } from './terminal/Icon';
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
      <div
        className="glass-bevel relative border border-bezel rounded-[14px] overflow-hidden divide-y divide-ink/[0.06] bg-terminal-bg"
        style={{ boxShadow: 'var(--shadow-panel)' }}
      >
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    strategy: 'fixed',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (triggerRef.current) refs.setReference(triggerRef.current);
  }, [refs]);

  // Click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [open]);

  // Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const selected = groups.flat().find((o) => o.value === value) ?? null;

  const select = (next: ThemePreference) => {
    setOpen(false);
    onSelect(next);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-[13rem] shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 text-sm bg-ink/[0.04] border border-ink/10 rounded-md text-text-primary hover:bg-ink/[0.06] outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-light"
      >
        <span className="truncate">{selected?.label ?? 'System'}</span>
        <Icon name="caret-down" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
      </button>
      {open &&
        createPortal(
          <div
            ref={(el) => {
              dropdownRef.current = el;
              refs.setFloating(el);
            }}
            role="listbox"
            aria-label="Choose theme"
            style={{
              ...floatingStyles,
              background: 'var(--color-terminal-bg)',
              boxShadow: 'var(--shadow-menu)',
            }}
            className="w-[13rem] max-h-[24rem] overflow-y-auto border border-bezel rounded-[12px] z-[1000] p-1"
          >
            {groups.map((group, i) => (
              <div key={i}>
                {i > 0 && <div className="my-1 mx-1 border-t border-ink/[0.06]" />}
                {group.map((option) => (
                  <ThemeOptionRow
                    key={option.value}
                    option={option}
                    selected={option.value === value}
                    onClick={() => select(option.value)}
                  />
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function ThemeOptionRow({
  option,
  selected,
  onClick,
}: {
  option: ThemeOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={`w-full text-left px-2.5 py-1.5 rounded-[7px] text-sm flex items-center gap-2 hover:bg-ink/[0.08] transition-colors duration-100 ${
        selected ? 'text-text-primary bg-ink/[0.04]' : 'text-text-secondary'
      }`}
    >
      <span className="flex-1 truncate">{option.label}</span>
      {option.hint && <span className="text-[11px] text-text-tertiary shrink-0">{option.hint}</span>}
      {selected && <Icon name="check" className="w-3.5 h-3.5 text-text-primary shrink-0" />}
    </button>
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

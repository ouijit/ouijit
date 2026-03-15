import { useState, useRef, useEffect, useCallback } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';

const EMPTY_TAGS: string[] = [];
import { terminalInstances } from './terminalReact';

interface TagInputProps {
  ptyId: string;
  onClose: () => void;
}

/** Collect unique tags from all active terminal sessions */
function getActiveSessionTags(): string[] {
  const seen = new Map<string, string>();
  const state = useTerminalStore.getState();

  for (const display of Object.values(state.displayStates)) {
    for (const tag of display.tags) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }

  return Array.from(seen.values());
}

export function TagInput({ ptyId, onClose }: TagInputProps) {
  const tags = useTerminalStore((s) => s.displayStates[ptyId]?.tags) ?? EMPTY_TAGS;
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handler);
    });
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const addTag = useCallback(
    async (name: string) => {
      const normalized = name.trim();
      if (!normalized) return;

      // Same tag already — no-op
      if (tags.length === 1 && tags[0].toLowerCase() === normalized.toLowerCase()) {
        setInputValue('');
        setSuggestions([]);
        return;
      }

      const instance = terminalInstances.get(ptyId);
      if (instance?.taskId != null) {
        try {
          await window.api.tags.setTaskTags(instance.projectPath, instance.taskId, [normalized]);
        } catch {
          /* DB not ready */
        }
      }

      // Single tag only — replace existing
      if (instance) {
        instance.tags = [normalized];
        instance.pushDisplayState({ tags: [normalized] });
      }

      setInputValue('');
      setSuggestions([]);
    },
    [ptyId, tags],
  );

  const removeTag = useCallback(
    async (tagName: string) => {
      const instance = terminalInstances.get(ptyId);
      if (instance?.taskId != null) {
        try {
          await window.api.tags.removeFromTask(instance.projectPath, instance.taskId, tagName);
        } catch {
          /* DB not ready */
        }
      }

      if (instance) {
        instance.tags = instance.tags.filter((t) => t.toLowerCase() !== tagName.toLowerCase());
        instance.pushDisplayState({ tags: instance.tags });
      }
    },
    [ptyId],
  );

  const handleInput = (value: string) => {
    setInputValue(value);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }

    const allTags = getActiveSessionTags();
    const existing = new Set(tags.map((t) => t.toLowerCase()));
    const matches = allTags
      .filter((t) => t.toLowerCase().includes(value.toLowerCase()) && !existing.has(t.toLowerCase()))
      .slice(0, 8);
    setSuggestions(matches);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      e.preventDefault();
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div ref={containerRef} className="tag-input-container">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button
            className="tag-chip-remove"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(tag);
            }}
          >
            &times;
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        className="tag-input-field"
        placeholder={tags.length ? '' : 'Add tag\u2026'}
        value={inputValue}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {suggestions.length > 0 && (
        <div className="tag-autocomplete-dropdown" style={{ display: 'block' }}>
          {suggestions.map((s) => (
            <div
              key={s}
              className="tag-autocomplete-item"
              onMouseDown={(e) => {
                e.preventDefault();
                addTag(s);
              }}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { collectActiveTags, useTerminalStore, withTag, withoutTag } from '../../stores/terminalStore';
import { terminalInstances } from './terminalRegistry';

const EMPTY_TAGS: string[] = [];

interface TagInputProps {
  ptyId: string;
  onClose: () => void;
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
    (name: string) => {
      const instance = terminalInstances.get(ptyId);
      instance?.setTags(withTag(instance.tags, name));
      setInputValue('');
      setSuggestions([]);
    },
    [ptyId],
  );

  const removeTag = useCallback(
    (tagName: string) => {
      const instance = terminalInstances.get(ptyId);
      instance?.setTags(withoutTag(instance.tags, tagName));
    },
    [ptyId],
  );

  const handleInput = (value: string) => {
    setInputValue(value);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }

    const { order, displayStates } = useTerminalStore.getState();
    const allTags = collectActiveTags(order, displayStates);
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
    <div
      ref={containerRef}
      className="nodrag inline-flex flex-wrap items-center gap-1 relative [-webkit-app-region:no-drag]"
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-ink/55 bg-ink/[0.05] rounded-full px-2 py-0.5 shrink-0"
        >
          {tag}
          <button
            className="inline-flex items-center justify-center w-3 h-3 text-ink/30 bg-transparent border-none text-xs leading-none hover:text-ink/60"
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
        className="bg-transparent border-none outline-none font-mono text-[11px] font-medium text-ink/70 min-w-[60px] py-0.5 placeholder:text-ink/25"
        style={{ width: 60 }}
        placeholder={tags.length ? '' : 'Add tag\u2026'}
        value={inputValue}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {suggestions.length > 0 && (
        <div
          className="absolute left-0 bg-surface border border-ink/10 rounded-lg shadow-menu z-50 max-h-48 overflow-y-auto"
          style={{ top: '100%', marginTop: 4, minWidth: 120, display: 'block' }}
        >
          {suggestions.map((s) => (
            <div
              key={s}
              className="block w-full text-left font-mono text-[11px] text-ink/60 px-3 py-1.5 bg-transparent border-none hover:bg-ink/[0.08] hover:text-ink/80"
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

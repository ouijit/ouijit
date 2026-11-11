import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from '../terminal/Icon';
import { MenuPopover } from '../ui/Menu';
import { growToFit } from '../../hooks/useAutoResize';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { sendChat, switchToTerminal } from './chatActions';
import { CHAT_AGENT_LABELS } from '../../chat/preferences';
import { parseSlashCommand, type ChatAttachment, type ChatOption, type ChatSessionInfo } from '../../chat/model';
import type { ChatDelivery } from '../../chat/host';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

function attachmentFor(path: string): ChatAttachment {
  const name = path.split('/').pop() ?? path;
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return { path, name, mimeType: MIME_BY_EXTENSION[extension] ?? 'text/plain' };
}

interface Setting {
  label: string;
  options: ChatOption[];
  value: string | undefined;
  /** The value is chosen but not yet in force. */
  pending?: boolean;
  onPick: (id: string) => void;
}

function settingsFor(cardId: string, info: ChatSessionInfo): Setting[] {
  const caps = info.capabilities;
  const settings: Setting[] = [];
  if (caps.models && info.models.length > 0) {
    settings.push({
      label: 'Model',
      options: info.models,
      value: info.model,
      onPick: (id) => void window.api.chat.setModel(cardId, id).catch(report),
    });
  }
  if (caps.effort && info.efforts.length > 0) {
    settings.push({
      label: 'Effort',
      options: info.efforts,
      value: info.effort,
      onPick: (id) => void window.api.chat.setEffort(cardId, id).catch(report),
    });
  }
  if (caps.modes && info.modes.length > 0) {
    settings.push({
      label: 'Mode',
      options: info.modes,
      value: info.pendingMode ?? info.mode,
      pending: Boolean(info.pendingMode),
      onPick: (id) => void window.api.chat.setMode(cardId, id).catch(report),
    });
  }
  return settings;
}

function OptionList({ setting, onDone }: { setting: Setting; onDone: () => void }) {
  return (
    <div role="group" aria-label={setting.label}>
      {setting.options.map((option) => {
        const selected = option.id === setting.value;
        return (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            className="w-full text-left px-2.5 py-1.5 rounded-[7px] flex items-start gap-2 hover:bg-ink/[0.08] transition-colors duration-100"
            onClick={() => {
              onDone();
              if (!selected) setting.onPick(option.id);
            }}
          >
            <span className="flex-1 min-w-0">
              <span className={`block text-sm ${selected ? 'text-text-primary' : 'text-text-secondary'}`}>
                {option.label}
              </span>
              {option.description && (
                <span className="block text-[12px] leading-snug text-text-tertiary">{option.description}</span>
              )}
            </span>
            <Icon name="check" className={`w-3.5 h-3.5 mt-[3px] shrink-0 text-accent ${selected ? '' : 'invisible'}`} />
          </button>
        );
      })}
      {setting.pending && (
        <div className="px-2.5 pt-1.5 pb-1 text-[12px] text-text-tertiary">Applies when this turn ends.</div>
      )}
    </div>
  );
}

const currentLabel = (setting: Setting) => setting.options.find((option) => option.id === setting.value)?.label;

/**
 * Model, effort and mode behind one button that names all three. The menu
 * lists the settings, and choosing one swaps in its options.
 */
function SettingsPicker({ settings }: { settings: Setting[] }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  if (settings.length === 0) return null;
  const toggle = (next: boolean) => {
    setOpen(next);
    setChosen(null);
  };
  const shown = settings.length === 1 ? settings[0] : settings.find((setting) => setting.label === chosen);
  const summary = settings.map(currentLabel).filter(Boolean).join(' · ');
  return (
    <MenuPopover
      open={open}
      onOpenChange={toggle}
      placement="top-start"
      className={`${shown?.options.some((option) => option.description) ? 'w-72' : 'w-56'} max-h-[22rem]`}
      header={
        shown &&
        settings.length > 1 && (
          <button
            type="button"
            className="flex items-center gap-1.5 px-1 text-[12px] text-text-tertiary hover:text-text-primary transition-colors duration-100"
            onClick={() => setChosen(null)}
          >
            <Icon name="caret-left" className="w-3 h-3" />
            {shown.label}
          </button>
        )
      }
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-label="Agent settings"
          aria-expanded={open}
          className={`flex items-center gap-1 h-6 px-2 rounded-[7px] text-[12px] transition-colors duration-100 min-w-0 max-w-[22rem] ${
            open ? 'bg-ink/[0.08] text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-ink/[0.06]'
          }`}
          onClick={() => toggle(!open)}
        >
          <span className="truncate">{summary || settings[0].label}</span>
          <Icon name="caret-down" className="w-3 h-3 shrink-0 opacity-60" />
        </button>
      )}
    >
      {shown ? (
        <OptionList setting={shown} onDone={() => toggle(false)} />
      ) : (
        settings.map((setting) => (
          <button
            key={setting.label}
            type="button"
            role="menuitem"
            className="w-full text-left px-2.5 py-1.5 rounded-[7px] text-sm flex items-center gap-2 text-text-secondary hover:bg-ink/[0.08] hover:text-text-primary transition-colors duration-100"
            onClick={() => setChosen(setting.label)}
          >
            <span className="flex-1">{setting.label}</span>
            <span className="text-[12px] text-text-tertiary truncate">{currentLabel(setting)}</span>
            <Icon name="caret-right" className="w-3 h-3 shrink-0 text-text-tertiary" />
          </button>
        ))
      )}
    </MenuPopover>
  );
}

function usageLabel(info: ChatSessionInfo): string | null {
  const usage = info.usage;
  if (!usage) return null;
  const tokens = usage.inputTokens + usage.outputTokens;
  if (tokens === 0) return null;
  const compact = tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : String(tokens);
  const context = usage.contextWindow ? ` of ${Math.round(usage.contextWindow / 1000)}k` : '';
  return `${compact}${context} tokens`;
}

function report(error: unknown): void {
  useProjectStore.getState().addToast(error instanceof Error ? error.message : String(error), 'error');
}

export function ChatComposer({
  cardId,
  info,
  focusRef,
}: {
  cardId: string;
  info: ChatSessionInfo;
  focusRef: (focus: (() => void) | null) => void;
}) {
  const draft = useChatStore((s) => s.drafts[cardId] ?? '');
  const setDraft = useChatStore((s) => s.setDraft);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [delivery, setDelivery] = useState<Exclude<ChatDelivery, 'auto'>>('steer');
  const [commandIndex, setCommandIndex] = useState(0);
  const [terminalCommand, setTerminalCommand] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = info.status === 'running' || info.status === 'awaiting';
  // A message sent while the agent starts waits for it in the host, so only a stopped agent refuses one.
  const ready = info.status !== 'error' && info.status !== 'exited';
  const caps = info.capabilities;

  useEffect(() => {
    focusRef(() => textarea.current?.focus());
    return () => focusRef(null);
  }, [focusRef]);

  useEffect(() => growToFit(textarea.current), [draft]);

  const commandQuery = /^\/(\S*)$/.exec(draft)?.[1];
  const commands = useMemo(() => {
    if (commandQuery === undefined || !caps.commands) return [];
    const query = commandQuery.toLowerCase();
    return info.commands.filter((command) => command.name.toLowerCase().startsWith(query)).slice(0, 8);
  }, [commandQuery, caps.commands, info.commands]);

  const send = async () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || !ready) return;
    const command = parseSlashCommand(text, info.commands);
    if (command?.kind === 'terminal') {
      setTerminalCommand(command.name);
      return;
    }
    const chosen: ChatDelivery = busy && caps.steer && caps.queue ? delivery : 'auto';
    setDraft(cardId, '');
    const sent = attachments;
    setAttachments([]);
    if (!(await sendChat(cardId, text, sent, chosen, true))) {
      setDraft(cardId, text);
      setAttachments(sent);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commands.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setCommandIndex((index) => (index + step + commands.length) % commands.length);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        const command = commands[Math.min(commandIndex, commands.length - 1)];
        setDraft(cardId, `/${command.name} `);
        setCommandIndex(0);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    } else if (event.key === 'Escape' && busy && caps.interrupt) {
      event.preventDefault();
      void window.api.chat.interrupt(cardId).catch(report);
    }
  };

  const addPaths = (paths: string[]) => setAttachments((current) => [...current, ...paths.map(attachmentFor)]);

  const onPaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    event.preventDefault();
    for (const image of images) {
      const extension = image.type.split('/')[1] ?? 'png';
      const saved = await window.api.task.saveAttachment(new Uint8Array(await image.arrayBuffer()), extension);
      if (saved.success && saved.path) addPaths([saved.path]);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => window.api.getPathForFile(file))
      .filter((path): path is string => !!path);
    if (paths.length === 0) return;
    event.preventDefault();
    addPaths(paths);
  };

  const usage = usageLabel(info);

  return (
    <div
      className="relative glass-bevel mx-4 mb-4 rounded-[14px] border border-bezel bg-terminal-surface"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {commands.length > 0 && (
        <div
          role="listbox"
          className="absolute left-2 right-2 bottom-full mb-2 glass-bevel rounded-[10px] border border-bezel bg-terminal-surface p-1 shadow-lg"
        >
          {commands.map((command, index) => (
            <button
              key={command.name}
              type="button"
              role="option"
              aria-selected={index === commandIndex}
              className={`w-full text-left px-2.5 py-1.5 rounded-[7px] text-sm flex items-baseline gap-2 ${index === commandIndex ? 'bg-ink/[0.08] text-text-primary' : 'text-text-secondary'}`}
              onMouseDown={(event) => {
                event.preventDefault();
                setDraft(cardId, `/${command.name} `);
                textarea.current?.focus();
              }}
            >
              <span className="font-mono text-[13px]">/{command.name}</span>
              {command.description && (
                <span className="text-[12px] text-text-tertiary truncate">{command.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {terminalCommand && (
        <div className="flex items-center gap-3 px-3.5 pt-2.5 text-[13px] text-text-secondary">
          <span className="flex-1">
            <span className="font-mono">/{terminalCommand}</span> runs in {CHAT_AGENT_LABELS[info.agent]}&apos;s
            terminal.
          </span>
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => {
              setTerminalCommand(null);
              setDraft(cardId, '');
              void switchToTerminal(cardId);
            }}
          >
            Open in terminal
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-text-tertiary hover:text-text-primary"
            onClick={() => setTerminalCommand(null)}
          >
            <Icon name="x" className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
          {attachments.map((attachment, index) => (
            <span
              key={`${attachment.path}-${index}`}
              className="inline-flex items-center gap-1 rounded-[6px] bg-ink/[0.06] px-2 py-0.5 text-[12px] text-text-secondary"
            >
              <Icon name="paperclip" className="w-3 h-3" />
              {attachment.name}
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                className="hover:text-text-primary"
                onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
              >
                <Icon name="x" className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={textarea}
        rows={1}
        value={draft}
        disabled={!ready}
        placeholder={ready ? (busy ? 'Send a message while it works' : 'Message the agent') : ''}
        aria-label="Message"
        className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm text-text-primary placeholder:text-text-tertiary outline-none max-h-60 overflow-y-auto"
        onChange={(event) => {
          setDraft(cardId, event.target.value);
          setTerminalCommand(null);
          setCommandIndex(0);
        }}
        onKeyDown={onKeyDown}
        onPaste={(event) => void onPaste(event)}
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <button
          type="button"
          aria-label="Attach files"
          className="p-1.5 rounded-[6px] text-text-tertiary hover:text-text-primary hover:bg-ink/[0.06] transition-colors duration-100"
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="paperclip" className="w-3.5 h-3.5" />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const paths = Array.from(event.target.files ?? [])
              .map((file) => window.api.getPathForFile(file))
              .filter((path): path is string => !!path);
            addPaths(paths);
            event.target.value = '';
          }}
        />
        <SettingsPicker settings={settingsFor(cardId, info)} />
        <span className="flex-1" />
        {usage && <span className="text-[11px] text-text-tertiary mr-1 truncate">{usage}</span>}
        {busy && caps.steer && caps.queue && (
          <button
            type="button"
            title={delivery === 'steer' ? 'Messages join the running turn' : 'Messages wait for the turn to end'}
            className="px-1.5 py-0.5 rounded-[6px] text-[12px] text-text-tertiary hover:text-text-primary hover:bg-ink/[0.06] transition-colors duration-100"
            onClick={() => setDelivery((d) => (d === 'steer' ? 'queue' : 'steer'))}
          >
            {delivery === 'steer' ? 'Steer' : 'Queue'}
          </button>
        )}
        {busy && caps.interrupt && (
          <button
            type="button"
            aria-label="Stop"
            title="Stop (Esc)"
            className="p-1.5 rounded-full bg-ink/[0.08] text-text-primary hover:bg-ink/[0.14] transition-colors duration-100"
            onClick={() => void window.api.chat.interrupt(cardId).catch(report)}
          >
            <Icon name="stop" className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label="Send"
          disabled={!ready || (!draft.trim() && attachments.length === 0)}
          className="p-1.5 rounded-full bg-accent text-accent-ink disabled:opacity-30 transition-opacity duration-100"
          onClick={() => void send()}
        >
          <Icon name="arrow-up" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from '../terminal/Icon';
import { MenuPopover, MenuItem } from '../ui/Menu';
import { growToFit } from '../../hooks/useAutoResize';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { sendChat } from './chatActions';
import type { ChatAttachment, ChatOption, ChatSessionInfo } from '../../chat/model';
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

function Picker({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: ChatOption[];
  value: string | undefined;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.id === value)?.label ?? value ?? label;
  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="top-start"
      className="w-64 max-h-[18rem]"
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-label={label}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[12px] text-text-tertiary hover:text-text-primary hover:bg-ink/[0.06] transition-colors duration-100 max-w-[12rem]"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="truncate">{current}</span>
          <Icon name="caret-down" className="w-3 h-3" />
        </button>
      )}
    >
      {options.map((option) => (
        <MenuItem
          key={option.id}
          label={option.label}
          hint={option.description}
          selected={option.id === value}
          onClick={() => {
            setOpen(false);
            onPick(option.id);
          }}
        />
      ))}
    </MenuPopover>
  );
}

function usageLabel(info: ChatSessionInfo): string | null {
  const usage = info.usage;
  if (!usage) return null;
  const tokens = usage.inputTokens + usage.outputTokens;
  const compact = tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : String(tokens);
  const context = usage.contextWindow ? ` of ${Math.round(usage.contextWindow / 1000)}k` : '';
  const cost = usage.costUsd != null ? ` · $${usage.costUsd.toFixed(2)}` : '';
  return `${compact}${context} tokens${cost}`;
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = info.status === 'running' || info.status === 'awaiting';
  const ready = info.status !== 'starting' && info.status !== 'error' && info.status !== 'exited';
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
    const chosen: ChatDelivery = busy && caps.steer && caps.queue ? delivery : 'auto';
    setDraft(cardId, '');
    const sent = attachments;
    setAttachments([]);
    if (!(await sendChat(cardId, text, sent, chosen))) {
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
        {caps.models && info.models.length > 0 && (
          <Picker
            label="Model"
            options={info.models}
            value={info.model}
            onPick={(model) => void window.api.chat.setModel(cardId, model).catch(report)}
          />
        )}
        {caps.effort && info.efforts.length > 0 && (
          <Picker
            label="Effort"
            options={info.efforts}
            value={info.effort}
            onPick={(effort) => void window.api.chat.setEffort(cardId, effort).catch(report)}
          />
        )}
        {caps.modes && info.modes.length > 0 && (
          <Picker
            label="Mode"
            options={info.modes}
            value={info.mode}
            onPick={(mode) => void window.api.chat.setMode(cardId, mode).catch(report)}
          />
        )}
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

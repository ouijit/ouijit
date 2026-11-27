import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from '../terminal/Icon';
import { SandboxRing } from '../terminal/StatusDot';
import {
  SANDBOX_LABELS,
  defaultCliAccess,
  isSandboxCliAccess,
  sandboxCliAccessSettingKey,
  type SandboxBackendId,
  type SandboxCliAccess,
} from '../../sandbox/types';
import { MenuPopover } from '../ui/Menu';
import { ContextUsage } from './ContextUsage';
import { growToFit, useFitOnResize } from '../../hooks/useAutoResize';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { openAgentTerminal, sendChat } from './chatActions';
import { CHAT_AGENT_LABELS } from '../../chat/preferences';
import { commandMenu, type MenuItem } from '../../chat/commandMenu';
import {
  parseSlashCommand,
  type ChatAttachment,
  type ChatNode,
  type ChatOption,
  type ChatSessionInfo,
  type UserMessageNode,
} from '../../chat/model';
import { fileIcon, isImage, previewOf } from './MessageAttachments';
import type { ChatDelivery } from '../../chat/startOptions';

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

/** What the sandbox means for this agent, in words for someone who has never set one up. */
function sandboxLines(info: ChatSessionInfo, sandbox: SandboxBackendId, access: SandboxCliAccess): string[] {
  if (sandbox === 'custom') {
    return [
      'It runs inside the sandbox command set for this project, which decides what it can reach.',
      "Ouijit doesn't know that command's rules, so check them before trusting it to run unattended.",
    ];
  }
  if (info.role === 'home' && access === 'read') {
    return [
      'It can read your projects and tasks, and follow the agents working on them.',
      "It can't change files, move tasks or message agents. To let it run your board, set its Ouijit CLI access to Whole board in Chat's settings.",
      'It can use the internet, unless its sandbox profile blocks it.',
    ];
  }
  if (info.role === 'home') {
    return [
      'It can run your board: create, start and move tasks, and read the agents working on them.',
      "Tasks it starts run in this sandbox too, each changing only its own folder. It can't message or answer agents running outside it.",
      'It can read your projects but not change them. Work on your code happens in the tasks it starts.',
      'It can use the internet, unless its sandbox profile blocks it.',
    ];
  }
  return [
    "It can change files in this task's own folder and commit to its branch.",
    "It can't open or change anything else on your computer, including your other projects.",
    "It can use the internet, unless the project's sandbox profile blocks it.",
  ];
}

/** Chat's own CLI access, read when its note opens: changing it restarts Chat. */
function useChatCliAccess(load: boolean): SandboxCliAccess | null {
  const [access, setAccess] = useState<SandboxCliAccess | null>(null);
  useEffect(() => {
    if (!load) return;
    void window.api.homeChat
      .dir()
      .then((dir) => window.api.globalSettings.get(sandboxCliAccessSettingKey(dir)))
      .then((stored) => setAccess(isSandboxCliAccess(stored) ? stored : defaultCliAccess(true)));
  }, [load]);
  return access;
}

function SandboxNote({ info, sandbox }: { info: ChatSessionInfo; sandbox: SandboxBackendId }) {
  const [open, setOpen] = useState(false);
  const home = info.role === 'home';
  const access = useChatCliAccess(home && open);
  return (
    <MenuPopover
      open={open}
      onOpenChange={setOpen}
      placement="top-start"
      className="w-80"
      trigger={(ref) => (
        <button
          ref={ref}
          type="button"
          aria-expanded={open}
          className={`flex items-center gap-1.5 h-6 px-1.5 rounded-[7px] text-[12px] shrink-0 transition-colors duration-100 ${
            open ? 'bg-ink/[0.08] text-text-primary' : 'text-text-tertiary hover:text-text-primary hover:bg-ink/[0.06]'
          }`}
          onClick={() => setOpen(!open)}
        >
          <SandboxRing sandboxed size={6}>
            <span className="status-dot-fill rounded-full" style={{ background: 'var(--color-text-tertiary)' }} />
          </SandboxRing>
          {SANDBOX_LABELS[sandbox]}
        </button>
      )}
    >
      <div className="flex flex-col gap-2 px-2.5 py-2 text-[13px] leading-snug text-text-secondary">
        <div className="font-medium text-text-primary">
          {home ? 'Chat' : 'This agent'} runs in a {sandbox === 'custom' ? 'custom sandbox' : 'sandbox'}
        </div>
        {(home && !access ? [] : sandboxLines(info, sandbox, access ?? 'read')).map((line) => (
          <p key={line} className="m-0">
            {line}
          </p>
        ))}
      </div>
    </MenuPopover>
  );
}

const current = (setting: Setting) => setting.options.find((option) => option.id === setting.value);
const currentLabel = (setting: Setting) => current(setting)?.label;

/**
 * Model, effort and mode behind one button that names the first of them. The
 * menu lists the settings, and choosing one swaps in its options.
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
  const summary = current(settings[0])?.standsFor ?? currentLabel(settings[0]);
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
          <span className="overflow-hidden whitespace-nowrap">{summary || settings[0].label}</span>
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
            <span className="text-[12px] text-text-tertiary overflow-hidden whitespace-nowrap">
              {currentLabel(setting)}
            </span>
            <Icon name="caret-right" className="w-3 h-3 shrink-0 text-text-tertiary" />
          </button>
        ))
      )}
    </MenuPopover>
  );
}

/** What is attached, waiting to be sent: an image as a thumbnail, anything else as its name. */
function Attached({ attachment, onRemove }: { attachment: ChatAttachment; onRemove: () => void }) {
  const image = isImage(attachment);
  // Undefined while loading; null for an image that cannot be shown, which falls back to its name.
  const [preview, setPreview] = useState<string | null | undefined>(image ? undefined : null);
  useEffect(() => {
    if (!image) return;
    let live = true;
    void previewOf(attachment.path).then((src) => live && setPreview(src));
    return () => {
      live = false;
    };
  }, [image, attachment.path]);
  const remove = (
    <button
      type="button"
      aria-label={`Remove ${attachment.name}`}
      className="hover:text-text-primary"
      onClick={onRemove}
    >
      <Icon name="x" className="w-3 h-3" />
    </button>
  );
  if (image && preview !== null) {
    return (
      <span className="group/attached relative inline-flex">
        {preview ? (
          <img
            src={preview}
            alt={attachment.name}
            className="block h-14 w-auto max-w-[120px] rounded-[10px] object-cover outline outline-1 -outline-offset-1 outline-ink/10"
          />
        ) : (
          <span aria-hidden className="block w-14 h-14 rounded-[10px] bg-ink/[0.06]" />
        )}
        <span className="raised-badge glass-bevel absolute -top-2 -right-2 w-[22px] h-[22px] rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary opacity-0 group-hover/attached:opacity-100 focus-within:opacity-100 transition-opacity duration-100 [&_button]:w-full [&_button]:h-full [&_button]:flex [&_button]:items-center [&_button]:justify-center">
          {remove}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 self-end rounded-[6px] bg-ink/[0.06] px-2 py-0.5 text-[12px] text-text-secondary">
      <Icon name={fileIcon(attachment)} className="w-3 h-3" />
      {attachment.name}
      {remove}
    </span>
  );
}

/** The commands sent in this conversation, latest first. */
function recentCommands(nodes: ChatNode[]): string[] {
  const names: string[] = [];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.kind !== 'user_message' || node.wake) continue;
    const name = /^\/(\S+)/.exec(node.text)?.[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
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
  const nodes = useChatStore((s) => s.sessions[cardId]?.nodes);
  const recent = useMemo(() => recentCommands(nodes ?? []), [nodes]);
  const setDraft = useChatStore((s) => s.setDraft);
  const editing = useChatStore((s) => s.editing[cardId]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
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
  useFitOnResize(textarea);

  // An edited message brings its attachments along, and the caret to the end of its text.
  const editedId = editing?.messageId;
  useEffect(() => {
    if (!editedId) return;
    const edited = nodes?.find((node): node is UserMessageNode => node.id === editedId && node.kind === 'user_message');
    setAttachments(edited?.attachments ?? []);
    const field = textarea.current;
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
    // The message is read once, when its edit begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedId]);

  // Escape closes the menu for the draft it was open on; typing more opens it again.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const items = useMemo(
    () => (caps.commands && dismissedFor !== draft ? commandMenu(draft, info, recent) : []),
    [caps.commands, dismissedFor, draft, info, recent],
  );
  const selected = items.length ? items[Math.min(commandIndex, items.length - 1)] : undefined;
  useEffect(() => setCommandIndex(0), [draft]);

  const send = async (override?: string) => {
    const text = (override ?? draft).trim();
    if ((!text && attachments.length === 0) || !ready) return;
    const command = parseSlashCommand(text, info.commands, info.agent);
    if (command?.kind === 'terminal') {
      setTerminalCommand(command.name);
      return;
    }
    if (editing) {
      try {
        await window.api.chat.rewind(cardId, editing.messageId);
      } catch (error) {
        report(error);
        return;
      }
      useChatStore.getState().endEdit(cardId);
    }
    // A message sent mid-turn steers it wherever the agent can take one.
    const chosen: ChatDelivery = busy && caps.steer ? 'steer' : 'auto';
    const after = editing?.setAside ?? '';
    setDraft(cardId, '');
    const sent = attachments;
    setAttachments([]);
    if (!(await sendChat(cardId, text, sent, chosen, true))) {
      setDraft(cardId, text);
      setAttachments(sent);
      return;
    }
    if (after) setDraft(cardId, after);
  };

  /**
   * Choosing from the menu: a command that needs nothing more runs at once,
   * one that takes an argument is filled in to finish (Tab only ever fills),
   * and a model or effort choice runs with it.
   */
  const choose = (item: MenuItem, fillOnly = false) => {
    if (item.kind === 'option') {
      void send(`/${item.command} ${item.id}`);
      return;
    }
    if (fillOnly || item.takesArgument) {
      setDraft(cardId, `/${item.command.name} `);
      textarea.current?.focus();
      return;
    }
    void send(`/${item.command.name}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (selected) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setCommandIndex((index) => (Math.min(index, items.length - 1) + step + items.length) % items.length);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedFor(draft);
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        choose(selected, event.key === 'Tab');
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    } else if (event.key === 'ArrowUp' && !draft && attachments.length === 0) {
      const last = nodes?.findLast(
        (node): node is UserMessageNode => node.kind === 'user_message' && !node.wake && node.parentId === null,
      );
      if (!last) return;
      event.preventDefault();
      if (caps.rewind && info.status === 'idle') useChatStore.getState().startEdit(cardId, last);
      else setDraft(cardId, last.text);
    } else if (event.key === 'Escape' && editing) {
      event.preventDefault();
      useChatStore.getState().endEdit(cardId);
      setAttachments([]);
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

  return (
    <div
      className="relative glass-bevel mx-4 mb-4 rounded-[14px] border border-bezel bg-terminal-surface"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      {selected && (
        <div
          className="composer-menu left-2 right-2 bottom-full mb-2 max-h-72 flex flex-col overflow-hidden glass-bevel border border-bezel rounded-[12px]"
          style={{ background: 'var(--color-terminal-bg)', boxShadow: 'var(--shadow-menu)' }}
        >
          <div
            role="listbox"
            aria-label={items[0].kind === 'option' ? `Choose a ${items[0].command}` : 'Commands'}
            className="min-h-0 overflow-y-auto p-1"
          >
            {items.map((item, index) => {
              const on = item === selected;
              const key = item.kind === 'option' ? `option-${item.id}` : item.command.name;
              return (
                <button
                  key={key}
                  ref={on ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`w-full text-left px-2.5 py-1.5 rounded-[7px] text-sm flex items-center gap-2 transition-colors duration-100 ${on ? 'bg-ink/[0.08] text-text-primary' : 'text-text-secondary'}`}
                  onMouseEnter={() => setCommandIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(item);
                  }}
                >
                  {item.kind === 'option' ? (
                    <span className="shrink-0">{item.label}</span>
                  ) : (
                    <span className="shrink-0">
                      /{item.command.name}
                      {item.command.argumentHint && (
                        <span className="text-text-tertiary"> {item.command.argumentHint}</span>
                      )}
                    </span>
                  )}
                  {(item.kind === 'option' ? item.description : item.command.description) && (
                    <span className="min-w-0 text-xs text-text-tertiary overflow-hidden whitespace-nowrap">
                      {item.kind === 'option' ? item.description : item.command.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {draft === '/' && info.commands.length > items.length && (
            <div className="px-3 py-1.5 border-t border-separator text-[12px] text-text-tertiary">
              Type to search {info.commands.length} commands
            </div>
          )}
        </div>
      )}
      {terminalCommand && (
        <div className="flex items-center gap-3 px-3.5 pt-2.5 text-[13px] text-text-secondary">
          <span className="flex-1">
            <span className="font-mono">/{terminalCommand}</span>{' '}
            {info.role === 'home'
              ? `only works in ${CHAT_AGENT_LABELS[info.agent]}'s own terminal, which Chat doesn't have.`
              : `runs in ${CHAT_AGENT_LABELS[info.agent]}'s terminal.`}
          </span>
          {info.role !== 'home' && (
            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={() => {
                setTerminalCommand(null);
                setDraft(cardId, '');
                void openAgentTerminal(cardId);
              }}
            >
              Open in terminal
            </button>
          )}
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
      {editing && (
        <div className="flex items-center gap-2 px-3 h-8 border-b border-separator text-[13px] text-text-secondary">
          <Icon name="pencil-simple" className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
          <span className="flex-1 min-w-0 truncate">Editing · sending replaces it and everything after</span>
          <button
            type="button"
            className="shrink-0 text-text-tertiary hover:text-text-primary transition-colors duration-100"
            onClick={() => {
              useChatStore.getState().endEdit(cardId);
              setAttachments([]);
              textarea.current?.focus();
            }}
          >
            Cancel <kbd className="ml-1 font-sans opacity-60">esc</kbd>
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 px-3 pt-3">
          {attachments.map((attachment, index) => (
            <Attached
              key={`${attachment.path}-${index}`}
              attachment={attachment}
              onRemove={() => setAttachments((current) => current.filter((_, i) => i !== index))}
            />
          ))}
        </div>
      )}
      <textarea
        ref={textarea}
        rows={1}
        value={draft}
        disabled={!ready}
        placeholder={ready ? 'Send a message' : ''}
        aria-label="Message"
        className="block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-sm text-text-primary placeholder:text-text-tertiary outline-none min-h-14 max-h-60 overflow-y-auto"
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
        {info.sandbox && <SandboxNote info={info} sandbox={info.sandbox.provider} />}
        <span className="flex-1" />
        <ContextUsage usage={info.usage} className="mr-1.5 p-0.5" />
        {busy && caps.interrupt && !info.stopping && (
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

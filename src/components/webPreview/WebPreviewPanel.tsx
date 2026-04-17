import { useEffect, useState, useCallback, useRef } from 'react';
import { terminalInstances } from '../terminal/terminalReact';
import { Icon } from '../terminal/Icon';
import { TooltipButton } from '../ui/TooltipButton';

interface WebPreviewPanelProps {
  ptyId: string;
  url: string;
  onClose: () => void;
  onChangeUrl: (newUrl: string) => void;
}

// Electron <webview> is a custom element. Declare the minimal API surface we use.
interface ElectronWebviewElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  reload(): void;
  stop(): void;
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  getURL(): string;
  openDevTools(): void;
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Bare host:port or host — assume http for dev servers
  return `http://${trimmed}`;
}

export function WebPreviewPanel({ ptyId, url, onClose, onChangeUrl }: WebPreviewPanelProps) {
  const instance = terminalInstances.get(ptyId);
  const [fullWidth, setFullWidth] = useState(instance?.webPreviewFullWidth ?? true);
  const [splitRatio, setSplitRatio] = useState(instance?.webPreviewSplitRatio ?? 0.5);

  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(url);
  const [loadError, setLoadError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Wire webview events
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    // allowpopups is a boolean attribute Electron reads before attach; setting
    // it via React props fights the type defs, so set it imperatively.
    webview.setAttribute('allowpopups', '');

    const handleStart = () => {
      setLoading(true);
      setLoadError(null);
    };
    const handleStop = () => {
      setLoading(false);
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        // webview not yet attached
      }
    };
    const handleNavigate = (e: Event) => {
      const navEvent = e as Event & { url?: string };
      if (navEvent.url) setCurrentUrl(navEvent.url);
      try {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      } catch {
        // ignore
      }
    };
    const handleFailLoad = (e: Event) => {
      const failEvent = e as Event & { errorCode?: number; errorDescription?: string; validatedURL?: string };
      // -3 is ERR_ABORTED (usually user navigation away); ignore it.
      if (failEvent.errorCode === -3) return;
      setLoading(false);
      setLoadError(failEvent.errorDescription || 'Failed to load page');
    };

    webview.addEventListener('did-start-loading', handleStart);
    webview.addEventListener('did-stop-loading', handleStop);
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);
    webview.addEventListener('did-fail-load', handleFailLoad);

    return () => {
      webview.removeEventListener('did-start-loading', handleStart);
      webview.removeEventListener('did-stop-loading', handleStop);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
      webview.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, []);

  // Sync external url prop changes into the webview (e.g. user edits URL)
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;
    if (!url) return;
    try {
      if (webview.getURL() !== url) {
        webview.loadURL(url).catch(() => {
          // Errors surface through did-fail-load
        });
      }
    } catch {
      // Not yet attached — initial src attribute handles it
    }
    setCurrentUrl(url);
    setUrlDraft(url);
  }, [url]);

  const handleReload = useCallback(() => {
    webviewRef.current?.reload();
  }, []);

  const handleBack = useCallback(() => {
    const w = webviewRef.current;
    if (w?.canGoBack()) w.goBack();
  }, []);

  const handleForward = useCallback(() => {
    const w = webviewRef.current;
    if (w?.canGoForward()) w.goForward();
  }, []);

  const commitUrl = useCallback(() => {
    const normalized = normalizeUrl(urlDraft);
    setEditingUrl(false);
    if (normalized && normalized !== url) {
      onChangeUrl(normalized);
    } else {
      setUrlDraft(url);
    }
  }, [urlDraft, url, onChangeUrl]);

  const startEditingUrl = useCallback(() => {
    setUrlDraft(currentUrl || url);
    setEditingUrl(true);
    requestAnimationFrame(() => {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    });
  }, [currentUrl, url]);

  const toggleFullWidth = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!instance) return;
      const newFullWidth = !fullWidth;
      instance.webPreviewFullWidth = newFullWidth;
      setFullWidth(newFullWidth);
      instance.pushDisplayState({ webPreviewFullWidth: newFullWidth });

      requestAnimationFrame(() => {
        if (!newFullWidth) instance.fit();
      });
    },
    [fullWidth, instance],
  );

  // Resize handle drag
  useEffect(() => {
    const handle = handleRef.current;
    const panel = panelRef.current;
    if (!handle || !panel || !instance) return;

    const cardBody = panel.parentElement;
    if (!cardBody) return;

    let dragging = false;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      panel.style.transition = 'none';
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const rect = cardBody.getBoundingClientRect();
      const handleWidth = handle.offsetWidth;
      const totalWidth = rect.width - handleWidth;
      const mouseX = e.clientX - rect.left;
      let ratio = 1 - mouseX / totalWidth;
      ratio = Math.max(0.15, Math.min(0.85, ratio));
      instance.webPreviewSplitRatio = ratio;
      panel.style.flexBasis = `${ratio * 100}%`;
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      setSplitRatio(instance.webPreviewSplitRatio ?? 0.5);
      panel.style.transition = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      handle.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [instance, fullWidth]);

  // Set initial flex-basis
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    if (fullWidth) {
      panel.style.flexBasis = '100%';
    } else {
      panel.style.flexBasis = `${splitRatio * 100}%`;
    }

    requestAnimationFrame(() => {
      if (!fullWidth) instance?.fit();
    });
  }, [fullWidth, splitRatio, instance]);

  const splitIcon = fullWidth ? 'square-split-horizontal' : 'arrows-out-line-horizontal';
  const splitTitle = fullWidth ? 'Split view' : 'Full width';

  return (
    <>
      {!fullWidth && (
        <div
          ref={handleRef}
          className="shrink-0 relative hover:bg-white/15 active:bg-white/15 after:content-[''] after:absolute after:top-0 after:bottom-0 after:-left-2 after:-right-2"
          style={{ width: 4, cursor: 'col-resize', background: 'transparent', transition: 'background 0.15s ease' }}
        />
      )}
      <div
        ref={panelRef}
        className="rounded-none border-0 border-l border-t border-solid border-white/10 shadow-none flex flex-col overflow-hidden"
        style={{
          flexBasis: 0,
          background: 'var(--color-terminal-bg, #171717)',
          transition: 'flex-basis 0.25s ease',
          ...(fullWidth ? { flex: '1 0 100%', borderLeft: 'none' } : { minWidth: 200 }),
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-1 px-2 py-1.5 bg-white/[0.03] border-b border-white/10 shrink-0">
          <TooltipButton
            text="Back"
            placement="bottom"
            className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 disabled:text-white/20 disabled:hover:bg-transparent [&>svg]:w-3.5 [&>svg]:h-3.5"
            onClick={handleBack}
            disabled={!canGoBack}
          >
            <Icon name="arrow-left" />
          </TooltipButton>
          <TooltipButton
            text="Forward"
            placement="bottom"
            className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 disabled:text-white/20 disabled:hover:bg-transparent [&>svg]:w-3.5 [&>svg]:h-3.5"
            onClick={handleForward}
            disabled={!canGoForward}
          >
            <Icon name="arrow-right" />
          </TooltipButton>
          <TooltipButton
            text={loading ? 'Stop' : 'Reload'}
            placement="bottom"
            className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
            onClick={loading ? () => webviewRef.current?.stop() : handleReload}
          >
            <Icon name={loading ? 'x' : 'arrows-clockwise'} />
          </TooltipButton>
          {editingUrl ? (
            <input
              ref={urlInputRef}
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={commitUrl}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitUrl();
                if (e.key === 'Escape') {
                  setUrlDraft(url);
                  setEditingUrl(false);
                }
              }}
              className="text-[13px] text-white/80 flex-1 min-w-0 font-mono bg-white/5 border border-white/10 rounded px-2 py-0.5 outline-none focus:border-accent [-webkit-app-region:no-drag]"
            />
          ) : (
            <button
              className="text-[13px] text-white/60 truncate flex-1 min-w-0 font-mono bg-transparent border-none py-0.5 px-2 text-left transition-colors duration-150 hover:text-white/90 rounded"
              title={currentUrl}
              onClick={startEditingUrl}
            >
              {currentUrl || 'Enter URL…'}
            </button>
          )}
          <TooltipButton
            text={splitTitle}
            placement="bottom"
            className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-3.5 [&>svg]:h-3.5"
            onClick={toggleFullWidth}
          >
            <Icon name={splitIcon} />
          </TooltipButton>
          <TooltipButton
            text="Minimize"
            placement="bottom"
            className="w-7 h-7 flex items-center justify-center p-0 bg-transparent border-none rounded-md text-white/60 shrink-0 transition-all duration-150 ease-out hover:bg-white/10 hover:text-white/90 [&>svg]:w-4 [&>svg]:h-4"
            onClick={onClose}
          >
            <Icon name="minus" />
          </TooltipButton>
        </div>

        {/* Content */}
        <div className="flex-1 relative bg-white">
          {url ? (
            <webview
              ref={webviewRef as unknown as React.Ref<HTMLWebViewElement>}
              src={url}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40 bg-[var(--color-terminal-bg,#171717)]">
              No URL set
            </div>
          )}
          {loadError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/70 bg-[var(--color-terminal-bg,#171717)] p-6 text-center">
              <Icon name="globe-simple" className="w-8 h-8 text-white/30" />
              <div className="font-mono text-white/80">{loadError}</div>
              <div className="font-mono text-[11px] text-white/40 break-all">{currentUrl}</div>
              <button
                className="mt-2 px-3 py-1 rounded-md bg-white/10 hover:bg-white/15 text-white/80 text-xs border-none transition-colors"
                onClick={handleReload}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

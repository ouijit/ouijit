import { useEffect, useState, useCallback, useRef } from 'react';
import { Icon } from '../terminal/Icon';
import { TooltipButton } from '../ui/TooltipButton';
import { normalizeUrl } from './urlHelpers';

interface WebPreviewPanelProps {
  ptyId: string;
  panelId: string;
  url: string;
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

export function WebPreviewPanel({ url, onChangeUrl }: WebPreviewPanelProps) {
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(url);
  // When opened without a URL, drop straight into the editor so users can type
  // one instead of seeing a dead-end "No URL set" panel.
  const [editingUrl, setEditingUrl] = useState(!url);
  const [urlDraft, setUrlDraft] = useState(url);
  const [loadError, setLoadError] = useState<string | null>(null);

  const webviewRef = useRef<ElectronWebviewElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Attach webview event listeners via a callback ref so they rewire if the
  // <webview> remounts (e.g. url cleared and set again).
  const setWebviewNode = useCallback((node: ElectronWebviewElement | null) => {
    // Tear down listeners on the previous node.
    const prev = webviewRef.current;
    if (prev && prev !== node) {
      const cleanup = (prev as HTMLElement & { __ouijitCleanup?: () => void }).__ouijitCleanup;
      cleanup?.();
    }

    webviewRef.current = node;
    if (!node) return;

    // allowpopups is a boolean attribute Electron reads before attach; setting
    // it via React props fights the type defs, so set it imperatively.
    node.setAttribute('allowpopups', '');

    const handleStart = () => {
      setLoading(true);
      setLoadError(null);
    };
    const handleStop = () => {
      setLoading(false);
      try {
        setCanGoBack(node.canGoBack());
        setCanGoForward(node.canGoForward());
      } catch {
        // not yet attached
      }
    };
    const handleNavigate = (e: Event) => {
      const navEvent = e as Event & { url?: string };
      if (navEvent.url) setCurrentUrl(navEvent.url);
      try {
        setCanGoBack(node.canGoBack());
        setCanGoForward(node.canGoForward());
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

    node.addEventListener('did-start-loading', handleStart);
    node.addEventListener('did-stop-loading', handleStop);
    node.addEventListener('did-navigate', handleNavigate);
    node.addEventListener('did-navigate-in-page', handleNavigate);
    node.addEventListener('did-fail-load', handleFailLoad);

    (node as HTMLElement & { __ouijitCleanup?: () => void }).__ouijitCleanup = () => {
      node.removeEventListener('did-start-loading', handleStart);
      node.removeEventListener('did-stop-loading', handleStop);
      node.removeEventListener('did-navigate', handleNavigate);
      node.removeEventListener('did-navigate-in-page', handleNavigate);
      node.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, []);

  // Sync external url prop changes into the webview. Skip the initial render
  // because `src={url}` already loads it — otherwise we'd double-load.
  const lastLoadedUrlRef = useRef<string>(url);
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      lastLoadedUrlRef.current = url;
      return;
    }
    if (!url) return;
    if (lastLoadedUrlRef.current === url) return;
    lastLoadedUrlRef.current = url;
    try {
      webview.loadURL(url).catch(() => {
        // Errors surface through did-fail-load
      });
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

  // Focus the input when it auto-opens (panel opened without a URL).
  useEffect(() => {
    if (editingUrl) urlInputRef.current?.focus();
  }, [editingUrl]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 shrink-0">
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
            placeholder="http://localhost:3000"
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
      </div>

      {/* Content */}
      <div className="flex-1 relative bg-white mx-3 mb-3 glass-bevel border border-black/60 rounded-[12px] overflow-hidden">
        {url ? (
          <webview
            ref={setWebviewNode as unknown as React.Ref<HTMLWebViewElement>}
            src={url}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              border: 'none',
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40 bg-[var(--color-terminal-bg,#171717)]">
            Enter a URL above to preview it
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
  );
}

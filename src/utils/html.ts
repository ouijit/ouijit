/**
 * Escapes HTML special characters to prevent XSS attacks
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const ENV_VAR_RE = /(\$OUIJIT_(?:PROJECT_PATH|WORKTREE_PATH|TASK_BRANCH|TASK_NAME|TASK_PROMPT|BRANCH))/g;

export interface EnvVarValues {
  [key: string]: string | undefined;
}

/**
 * Wraps a textarea in a highlight underlay that colors recognized $OUIJIT_* env vars.
 * The textarea text becomes transparent so the backdrop text (with colored marks) shows through.
 * Also auto-sizes the textarea to fit content up to maxHeight.
 *
 * When envVarValues is provided, hovering over a highlighted var shows a tooltip with its value.
 *
 * @returns cleanup-free — all listeners are on elements that get removed with the dialog.
 */
export function setupHighlightedTextarea(
  textarea: HTMLTextAreaElement,
  maxHeight = 240,
  envVarValues?: EnvVarValues,
): void {
  // Wrap textarea in container with backdrop
  const wrap = document.createElement('div');
  wrap.className = 'hook-command-wrap';

  const backdrop = document.createElement('div');
  backdrop.className = 'hook-command-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  textarea.classList.add('hook-command-input');
  textarea.parentNode!.insertBefore(wrap, textarea);
  wrap.appendChild(backdrop);
  wrap.appendChild(textarea);

  const syncHighlights = () => {
    const escaped = escapeHtml(textarea.value);
    const highlighted = escaped.replace(ENV_VAR_RE, (_match, varName) => {
      const empty = envVarValues && !envVarValues[varName];
      const cls = empty ? 'hook-env-highlight hook-env-highlight--empty' : 'hook-env-highlight';
      return `<mark class="${cls}">${varName}</mark>`;
    });
    // Trailing newline needs a space so backdrop height matches
    backdrop.innerHTML = highlighted + (textarea.value.endsWith('\n') ? ' ' : '');
  };

  const autoSize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  const sync = () => {
    syncHighlights();
    autoSize();
    backdrop.scrollTop = textarea.scrollTop;
  };

  textarea.addEventListener('input', sync);
  textarea.addEventListener('scroll', () => {
    backdrop.scrollTop = textarea.scrollTop;
  });

  // Env var hover tooltips
  if (envVarValues) {
    let tooltip: HTMLDivElement | null = null;
    let activeMark: Element | null = null;

    const showTooltip = (mark: Element, x: number, y: number) => {
      if (activeMark === mark) return;
      hideTooltip();
      activeMark = mark;

      const varName = mark.textContent || '';
      const value = envVarValues[varName];

      tooltip = document.createElement('div');
      tooltip.className = 'hook-env-tooltip';
      if (value) {
        tooltip.textContent = value;
      } else {
        tooltip.innerHTML = '<em>Not available</em>';
      }
      document.body.appendChild(tooltip);

      // Position above the cursor
      const tipRect = tooltip.getBoundingClientRect();
      let left = x - tipRect.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${y - tipRect.height - 8}px`;
      requestAnimationFrame(() => tooltip?.classList.add('hook-env-tooltip--visible'));
    };

    const hideTooltip = () => {
      if (tooltip) {
        tooltip.remove();
        tooltip = null;
      }
      activeMark = null;
    };

    textarea.addEventListener('mousemove', (e) => {
      backdrop.style.pointerEvents = 'auto';
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      backdrop.style.pointerEvents = '';
      const mark = els.find((el) => el.classList.contains('hook-env-highlight'));
      if (mark) {
        showTooltip(mark, e.clientX, e.clientY);
      } else {
        hideTooltip();
      }
    });

    textarea.addEventListener('mouseleave', hideTooltip);
  }

  // Initial sync after element is in the DOM and visible
  requestAnimationFrame(sync);
}

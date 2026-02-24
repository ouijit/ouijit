/**
 * Escapes HTML special characters to prevent XSS attacks
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const ENV_VAR_RE = /(\$OUIJIT_(?:PROJECT_PATH|WORKTREE_PATH|TASK_BRANCH|TASK_NAME|TASK_PROMPT|BRANCH))/g;

/**
 * Wraps a textarea in a highlight underlay that colors recognized $OUIJIT_* env vars.
 * The textarea text becomes transparent so the backdrop text (with colored marks) shows through.
 * Also auto-sizes the textarea to fit content up to maxHeight.
 *
 * @returns cleanup-free — all listeners are on elements that get removed with the dialog.
 */
export function setupHighlightedTextarea(textarea: HTMLTextAreaElement, maxHeight = 240): void {
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
    const highlighted = escaped.replace(ENV_VAR_RE, '<mark class="hook-env-highlight">$1</mark>');
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
  textarea.addEventListener('scroll', () => { backdrop.scrollTop = textarea.scrollTop; });

  // Initial sync after element is in the DOM and visible
  requestAnimationFrame(sync);
}

/**
 * Dropdown management utility
 * Provides a reusable pattern for show/hide/toggle dropdowns with click-outside handling
 */

interface DropdownOptions {
  getAnchor: () => Element | null;
  buildContent: (container: HTMLElement) => Promise<void> | void;
  className: string;
  onHide?: () => void;
}

interface DropdownManager {
  show(): Promise<void>;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
}

export function createDropdownManager(options: DropdownOptions): DropdownManager {
  let visible = false;
  let cleanup: (() => void) | null = null;

  return {
    async show() {
      if (visible) return;
      const anchor = options.getAnchor();
      if (!anchor) return;

      let dropdown = anchor.querySelector(`.${options.className}`) as HTMLElement;
      if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = options.className;
        anchor.appendChild(dropdown);
      }

      await options.buildContent(dropdown);

      requestAnimationFrame(() => dropdown.classList.add('visible'));
      visible = true;

      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!anchor.contains(target)) {
          this.hide();
        }
      };

      setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
      cleanup = () => document.removeEventListener('click', handleClickOutside);
    },

    hide() {
      if (!visible) return;
      const anchor = options.getAnchor();
      const dropdown = anchor?.querySelector(`.${options.className}`);
      if (dropdown) {
        dropdown.classList.remove('visible');
        setTimeout(() => dropdown.remove(), 150);
      }
      cleanup?.();
      cleanup = null;
      visible = false;
      options.onHide?.();
    },

    toggle() {
      if (visible) this.hide();
      else this.show();
    },

    isVisible() {
      return visible;
    },
  };
}

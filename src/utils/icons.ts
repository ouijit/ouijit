/**
 * Centralized icon management using Lucide icons with automatic DOM conversion.
 *
 * Usage: Just write `<i data-lucide="icon-name"></i>` in HTML and icons are
 * automatically converted to SVGs when added to the DOM.
 *
 * For programmatic icon creation, use: createElement(iconName)
 */

import {
  createElement,
  // All icons used in the app
  Archive,
  ArrowLeft,
  ArrowRight,
  Bug,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCompare,
  GitMerge,
  ListTodo,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Settings,
  Shield,
  Star,
  Terminal,
  Trash2,
  Upload,
  X,
} from 'lucide';

// Re-export createElement for programmatic icon creation
export { createElement };

// Re-export individual icons for createElement usage
export {
  Archive,
  ArrowLeft,
  ArrowRight,
  Bug,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitCompare,
  GitMerge,
  ListTodo,
  Maximize2,
  Minimize2,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Settings,
  Shield,
  Star,
  Terminal,
  Trash2,
  Upload,
  X,
};

// Map of icon names (kebab-case) to icon definitions
const iconMap: Record<string, Parameters<typeof createElement>[0]> = {
  'archive': Archive,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'bug': Bug,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'download': Download,
  'folder-open': FolderOpen,
  'folder-plus': FolderPlus,
  'git-branch': GitBranch,
  'git-compare': GitCompare,
  'git-merge': GitMerge,
  'list-todo': ListTodo,
  'maximize-2': Maximize2,
  'minimize-2': Minimize2,
  'play': Play,
  'plus': Plus,
  'refresh-cw': RefreshCw,
  'rocket': Rocket,
  'rotate-ccw': RotateCcw,
  'search': Search,
  'settings': Settings,
  'shield': Shield,
  'star': Star,
  'terminal': Terminal,
  'trash-2': Trash2,
  'upload': Upload,
  'x': X,
};

/**
 * Convert an <i data-lucide="icon-name"> element to an SVG
 */
function convertIcon(element: Element): void {
  const iconName = element.getAttribute('data-lucide');
  if (!iconName) return;

  const iconDef = iconMap[iconName];
  if (!iconDef) {
    console.warn(`Unknown icon: ${iconName}`);
    return;
  }

  // Create the SVG element
  const svg = createElement(iconDef);

  // Copy over classes from the original element
  if (element.className) {
    svg.classList.add(...element.classList);
  }

  // Copy the data-lucide attribute for identification
  svg.setAttribute('data-lucide', iconName);

  // Replace the placeholder with the SVG
  element.replaceWith(svg);
}

/**
 * Convert all icon placeholders within an element
 */
function convertIconsIn(root: Element | Document): void {
  const placeholders = root.querySelectorAll('i[data-lucide]');
  for (const el of placeholders) {
    convertIcon(el);
  }
}

let observer: MutationObserver | null = null;

/**
 * Initialize automatic icon conversion.
 * Call this once at app startup.
 */
export function initIcons(): void {
  if (observer) return; // Already initialized

  // Convert any existing icons
  convertIconsIn(document);

  // Watch for new icons added to the DOM
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) {
          // Check if the node itself is an icon placeholder
          if (node.matches('i[data-lucide]')) {
            convertIcon(node);
          }
          // Check for icon placeholders within the node
          convertIconsIn(node);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

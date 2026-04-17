/**
 * Centralized icon management using Phosphor icons with automatic DOM conversion.
 *
 * Usage: Just write `<i data-icon="icon-name"></i>` in HTML and icons are
 * automatically converted to SVGs when added to the DOM.
 */

import alignBottom from '@phosphor-icons/core/assets/regular/align-bottom.svg?raw';
import alignCenterHorizontal from '@phosphor-icons/core/assets/regular/align-center-horizontal.svg?raw';
import alignCenterVertical from '@phosphor-icons/core/assets/regular/align-center-vertical.svg?raw';
import alignLeft from '@phosphor-icons/core/assets/regular/align-left.svg?raw';
import alignRight from '@phosphor-icons/core/assets/regular/align-right.svg?raw';
import alignTop from '@phosphor-icons/core/assets/regular/align-top.svg?raw';
import archive from '@phosphor-icons/core/assets/regular/archive.svg?raw';
import arrowCounterClockwise from '@phosphor-icons/core/assets/regular/arrow-counter-clockwise.svg?raw';
import arrowLeft from '@phosphor-icons/core/assets/regular/arrow-left.svg?raw';
import arrowRight from '@phosphor-icons/core/assets/regular/arrow-right.svg?raw';
import arrowsClockwise from '@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw';
import arrowsIn from '@phosphor-icons/core/assets/regular/arrows-in.svg?raw';
import arrowsOut from '@phosphor-icons/core/assets/regular/arrows-out.svg?raw';
import arrowsOutLineHorizontal from '@phosphor-icons/core/assets/regular/arrows-out-line-horizontal.svg?raw';
import arrowsOutLineVertical from '@phosphor-icons/core/assets/regular/arrows-out-line-vertical.svg?raw';
import bug from '@phosphor-icons/core/assets/regular/bug.svg?raw';
import caretDown from '@phosphor-icons/core/assets/regular/caret-down.svg?raw';
import dotsSixVertical from '@phosphor-icons/core/assets/regular/dots-six-vertical.svg?raw';
import caretLeft from '@phosphor-icons/core/assets/regular/caret-left.svg?raw';
import caretRight from '@phosphor-icons/core/assets/regular/caret-right.svg?raw';
import cardsThree from '@phosphor-icons/core/assets/regular/cards-three.svg?raw';
import check from '@phosphor-icons/core/assets/regular/check.svg?raw';
import clipboardText from '@phosphor-icons/core/assets/regular/clipboard-text.svg?raw';
import code from '@phosphor-icons/core/assets/regular/code.svg?raw';
import cube from '@phosphor-icons/core/assets/regular/cube.svg?raw';
import download from '@phosphor-icons/core/assets/regular/download.svg?raw';
import fileDashed from '@phosphor-icons/core/assets/regular/file-dashed.svg?raw';
import fileMinus from '@phosphor-icons/core/assets/regular/file-minus.svg?raw';
import filePlus from '@phosphor-icons/core/assets/regular/file-plus.svg?raw';
import fileText from '@phosphor-icons/core/assets/regular/file-text.svg?raw';
import folderOpen from '@phosphor-icons/core/assets/regular/folder-open.svg?raw';
import folderPlus from '@phosphor-icons/core/assets/regular/folder-plus.svg?raw';
import gear from '@phosphor-icons/core/assets/regular/gear.svg?raw';
import globeSimple from '@phosphor-icons/core/assets/regular/globe-simple.svg?raw';
import gitBranch from '@phosphor-icons/core/assets/regular/git-branch.svg?raw';
import gitFork from '@phosphor-icons/core/assets/regular/git-fork.svg?raw';
import gridFour from '@phosphor-icons/core/assets/regular/grid-four.svg?raw';
import gitDiff from '@phosphor-icons/core/assets/regular/git-diff.svg?raw';
import gitMerge from '@phosphor-icons/core/assets/regular/git-merge.svg?raw';
import info from '@phosphor-icons/core/assets/regular/info.svg?raw';
import kanban from '@phosphor-icons/core/assets/regular/kanban.svg?raw';
import listChecks from '@phosphor-icons/core/assets/regular/list-checks.svg?raw';
import magnifyingGlass from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import minus from '@phosphor-icons/core/assets/regular/minus.svg?raw';
import pencilSimple from '@phosphor-icons/core/assets/regular/pencil-simple.svg?raw';
import play from '@phosphor-icons/core/assets/regular/play.svg?raw';
import plus from '@phosphor-icons/core/assets/regular/plus.svg?raw';
import prohibit from '@phosphor-icons/core/assets/regular/prohibit.svg?raw';
import rocket from '@phosphor-icons/core/assets/regular/rocket.svg?raw';
import sidebarSimple from '@phosphor-icons/core/assets/regular/sidebar-simple.svg?raw';
import splitHorizontal from '@phosphor-icons/core/assets/regular/split-horizontal.svg?raw';
import squareSplitHorizontal from '@phosphor-icons/core/assets/regular/square-split-horizontal.svg?raw';
import star from '@phosphor-icons/core/assets/regular/star.svg?raw';
import tag from '@phosphor-icons/core/assets/regular/tag.svg?raw';
import terminal from '@phosphor-icons/core/assets/regular/terminal.svg?raw';
import trash from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import treeStructure from '@phosphor-icons/core/assets/regular/tree-structure.svg?raw';
import upload from '@phosphor-icons/core/assets/regular/upload.svg?raw';
import webhooksLogo from '@phosphor-icons/core/assets/regular/webhooks-logo.svg?raw';
import x from '@phosphor-icons/core/assets/regular/x.svg?raw';
import log from 'electron-log/renderer';

const iconsLog = log.scope('icons');

// Map of icon names (kebab-case) to SVG strings
export const iconMap: Record<string, string> = {
  'align-bottom': alignBottom,
  'align-center-horizontal': alignCenterHorizontal,
  'align-center-vertical': alignCenterVertical,
  'align-left': alignLeft,
  'align-right': alignRight,
  'align-top': alignTop,
  archive: archive,
  'arrow-counter-clockwise': arrowCounterClockwise,
  'arrow-left': arrowLeft,
  'arrow-right': arrowRight,
  'arrows-clockwise': arrowsClockwise,
  'arrows-in': arrowsIn,
  'arrows-out': arrowsOut,
  'arrows-out-line-horizontal': arrowsOutLineHorizontal,
  'arrows-out-line-vertical': arrowsOutLineVertical,
  bug: bug,
  'caret-down': caretDown,
  'dots-six-vertical': dotsSixVertical,
  'caret-left': caretLeft,
  'caret-right': caretRight,
  'cards-three': cardsThree,
  check: check,
  'clipboard-text': clipboardText,
  code: code,
  cube: cube,
  download: download,
  'file-dashed': fileDashed,
  'file-minus': fileMinus,
  'file-plus': filePlus,
  'file-text': fileText,
  'folder-open': folderOpen,
  'folder-plus': folderPlus,
  gear: gear,
  'globe-simple': globeSimple,
  'git-branch': gitBranch,
  'git-diff': gitDiff,
  'git-fork': gitFork,
  'grid-four': gridFour,
  'git-merge': gitMerge,
  info: info,
  kanban: kanban,
  'list-checks': listChecks,
  'magnifying-glass': magnifyingGlass,
  minus: minus,
  'pencil-simple': pencilSimple,
  play: play,
  plus: plus,
  prohibit: prohibit,
  rocket: rocket,
  'sidebar-simple': sidebarSimple,
  'split-horizontal': splitHorizontal,
  'square-split-horizontal': squareSplitHorizontal,
  star: star,
  tag: tag,
  terminal: terminal,
  trash: trash,
  'tree-structure': treeStructure,
  upload: upload,
  'webhooks-logo': webhooksLogo,
  x: x,
};

/**
 * Convert an <i data-icon="icon-name"> element to an SVG
 */
function convertIcon(element: Element): void {
  const iconName = element.getAttribute('data-icon');
  if (!iconName) return;

  const svgString = iconMap[iconName];
  if (!svgString) {
    iconsLog.warn('unknown icon', { name: iconName });
    return;
  }

  const template = document.createElement('template');
  template.innerHTML = svgString.trim();
  const svg = template.content.firstElementChild as SVGElement;
  if (!svg) return;

  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');

  // Copy over classes from the original element
  if (element.className) {
    svg.classList.add(...element.classList);
  }

  // Copy the data-icon attribute for identification
  svg.setAttribute('data-icon', iconName);

  // Replace the placeholder with the SVG
  element.replaceWith(svg);
}

/**
 * Convert all icon placeholders within an element
 */
export function convertIconsIn(root: Element | Document): void {
  const placeholders = root.querySelectorAll('i[data-icon]');
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
          if (node.matches('i[data-icon]')) {
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

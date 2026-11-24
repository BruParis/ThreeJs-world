/**
 * Layout helpers for the Shaders-tab GUI: screen columns holding several
 * Tweakpane panels, accordion folders, and custom DOM content inside folders.
 */

import { Pane, FolderApi } from 'tweakpane';

export const PANEL_WIDTH = '280px';

/**
 * A column of panels docked to one side of the content area.  The column
 * itself lets mouse events through, so the empty space below the panels
 * still reaches the canvas; panels taller than the screen scroll.
 */
export class PanelColumn {
  readonly element: HTMLDivElement;

  constructor(parent: HTMLElement, side: 'left' | 'right') {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', top: '0', [side]: '0',
      width: PANEL_WIDTH, maxHeight: '100%',
      display: 'none', flexDirection: 'column', gap: '4px',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    parent.appendChild(el);
    this.element = el;
  }

  /** Adds a panel.  `grow` panels shrink (and scroll) to fit the column. */
  addPanel(title: string, opts: { expanded?: boolean; grow?: boolean } = {}): Pane {
    const pane = new Pane({ title, expanded: opts.expanded ?? true });
    Object.assign(pane.element.style, {
      pointerEvents: 'auto',
      flex: opts.grow ? '0 1 auto' : '0 0 auto',
      minHeight: '0',
      overflowY: opts.grow ? 'auto' : 'visible',
    } as Partial<CSSStyleDeclaration>);
    this.element.appendChild(pane.element);
    return pane;
  }

  setVisible(v: boolean): void {
    this.element.style.display = v ? 'flex' : 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}

/** Makes the folders an accordion: opening one closes the others. */
export function accordion(folders: FolderApi[]): void {
  for (const folder of folders) {
    folder.on('fold', ({ expanded }) => {
      if (!expanded) return;
      for (const other of folders) {
        if (other !== folder && other.expanded) other.expanded = false;
      }
    });
  }
}

/**
 * Appends custom DOM content to a folder.  Use it on folders that hold no
 * Tweakpane blades: Tweakpane places blades by index among the children.
 */
export function appendToFolder(folder: FolderApi, content: HTMLElement): void {
  const container = folder.element.querySelector(':scope > .tp-fldv_c');
  (container ?? folder.element).appendChild(content);
}

/** Puts a small color swatch in front of a folder title. */
export function addTitleSwatch(folder: FolderApi, color: string): void {
  const title = folder.element.querySelector(':scope > .tp-fldv_b .tp-fldv_t');
  if (!title) return;
  title.prepend(swatch(color, 'box'));
}

/** Inline swatch: a box, a dot or a short line. */
export function swatch(color: string, shape: 'box' | 'line' | 'dot'): HTMLSpanElement {
  const s = document.createElement('span');
  Object.assign(s.style, {
    display: 'inline-block', marginRight: '6px', verticalAlign: 'middle',
    background: color,
    width:  shape === 'line' ? '16px' : '9px',
    height: shape === 'line' ? '2px'  : '9px',
    borderRadius: shape === 'dot' ? '50%' : '2px',
  } as Partial<CSSStyleDeclaration>);
  return s;
}

/** A block of small text lines matching the Tweakpane look. */
export function infoBlock(): HTMLDivElement {
  const d = document.createElement('div');
  Object.assign(d.style, {
    padding: '4px 8px 6px',
    font: '11px/1.6 var(--tp-base-font-family, sans-serif)',
    color: 'var(--tp-label-foreground-color, #bbb)',
  } as Partial<CSSStyleDeclaration>);
  return d;
}

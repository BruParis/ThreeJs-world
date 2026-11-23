/**
 * On-screen legend of the Shaders-tab biome layout: biome colours (shared by
 * the layout overlay and the "Biome" debug view), what the overlay marks mean,
 * and the mouse gestures of the editor.
 */

import { BIOME_COLORS, BIOME_NAMES } from '@core/terrain/BiomeBoundaries';

const css = (c: [number, number, number]) =>
  `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

const GESTURES_NO_CENTER = [
  'Click on the terrain to place the centre (hold to drag it).',
];
const GESTURES = [
  'Drag the yellow dot: move the centre and its rays',
  'Click an empty spot: add a ray towards it',
  'Drag a ray: pivot it around the centre',
  'Right-click a ray: remove it',
  'Click a sector dot: change its biome',
  'Drag elsewhere: move the camera',
];

export class BiomeLegend {
  private readonly root: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly gestures: HTMLDivElement;
  private editing   = false;
  private hasCenter = false;
  private wanted = true;
  private shown  = false;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'absolute', left: '12px', bottom: '12px',
      padding: '8px 10px', borderRadius: '6px',
      background: 'rgba(20, 20, 32, 0.85)', color: '#ddd',
      font: '12px/1.5 sans-serif', pointerEvents: 'none',
      display: 'none', maxWidth: '290px',
    } as CSSStyleDeclaration);

    const swatch = (color: string, shape: 'box' | 'line' | 'dot') => {
      const s = document.createElement('span');
      Object.assign(s.style, {
        display: 'inline-block', marginRight: '6px', verticalAlign: 'middle',
        background: color,
        width:  shape === 'line' ? '18px' : '10px',
        height: shape === 'line' ? '2px'  : '10px',
        borderRadius: shape === 'dot' ? '50%' : '2px',
      } as CSSStyleDeclaration);
      return s;
    };
    const row = (sw: HTMLElement, text: string) => {
      const r = document.createElement('div');
      r.append(sw, document.createTextNode(text));
      return r;
    };
    const title = (text: string) => {
      const t = document.createElement('div');
      t.textContent = text;
      Object.assign(t.style, { fontWeight: 'bold', color: '#fff', marginTop: '4px' });
      return t;
    };

    this.status = document.createElement('div');
    Object.assign(this.status.style, { fontWeight: 'bold', marginBottom: '2px' });
    root.append(this.status);

    root.append(title('Biomes'));
    for (const [id, name] of Object.entries(BIOME_NAMES)) {
      root.append(row(swatch(css(BIOME_COLORS[Number(id)]), 'box'), name));
    }
    root.append(
      title('Layout'),
      row(swatch('#ffd933', 'dot'), 'centre of the rays'),
      row(swatch('#fff', 'line'), 'boundary between two biomes'),
      row(swatch('#777', 'line'), 'ray with the same biome on both sides'),
      row(swatch('#aaa', 'dot'), 'sector dot, coloured by its biome'),
      title('Mouse'),
    );
    this.gestures = document.createElement('div');
    root.append(this.gestures);

    parent.appendChild(root);
    this.root = root;
    this.refreshText();
  }

  /** Shows whether biome editing is on. */
  setEditing(v: boolean): void {
    this.editing = v;
    this.refreshText();
  }

  /** Whether the layout has a centre yet (changes the gesture list). */
  setHasCenter(v: boolean): void {
    if (v === this.hasCenter) return;
    this.hasCenter = v;
    this.refreshText();
  }

  /** Whether the user wants the legend (follows "Show layout"). */
  setWanted(v: boolean): void {
    this.wanted = v;
    this.apply();
  }

  /** Whether the tab is active. */
  setShown(v: boolean): void {
    this.shown = v;
    this.apply();
  }

  dispose(): void {
    this.root.remove();
  }

  private refreshText(): void {
    this.status.textContent = this.editing ? '● Editing biomes' : 'Biome editing off';
    this.status.style.color = this.editing ? '#7f7' : '#999';

    const lines = !this.editing
      ? ['Moves the camera only. Turn on "Edit biomes" (Biomes page) to edit.']
      : this.hasCenter ? GESTURES : GESTURES_NO_CENTER;
    this.gestures.replaceChildren(...lines.map((text) => {
      const d = document.createElement('div');
      d.textContent = (this.editing ? '• ' : '') + text;
      return d;
    }));
  }

  private apply(): void {
    this.root.style.display = this.wanted && this.shown ? 'block' : 'none';
  }
}

/**
 * Explanatory content of the Biomes panel (Shaders tab): the key of the
 * layout overlay and the mouse gestures of the editor.  Plain DOM blocks,
 * placed inside the panel's folders.
 */

import { swatch, infoBlock } from '../gui/Panels';

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

const row = (sw: HTMLElement | null, text: string): HTMLDivElement => {
  const r = document.createElement('div');
  if (sw) r.append(sw);
  r.append(document.createTextNode(text));
  return r;
};

/** Key of the layout overlay marks. */
export function buildMapKey(): HTMLDivElement {
  const block = infoBlock();
  block.append(
    row(swatch('#ffd933', 'dot'),  'centre of the rays'),
    row(swatch('#fff',    'line'), 'boundary between two biomes'),
    row(swatch('#777',    'line'), 'ray with the same biome on both sides'),
    row(swatch('#aaa',    'dot'),  'sector dot, coloured by its biome'),
  );
  return block;
}

/** Mouse gestures of the editor; the list depends on whether there is a centre. */
export class BiomeGestureHelp {
  readonly element: HTMLDivElement = infoBlock();
  private hasCenter: boolean | null = null;

  constructor(hasCenter: boolean) {
    this.setHasCenter(hasCenter);
  }

  setHasCenter(v: boolean): void {
    if (v === this.hasCenter) return;
    this.hasCenter = v;
    const lines = v ? GESTURES : GESTURES_NO_CENTER;
    this.element.replaceChildren(...lines.map((text) => row(null, '• ' + text)));
  }
}

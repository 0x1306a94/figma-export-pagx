import { writePagxXml } from '../src/export/pagx-writer';
import { rgbaToHex } from '../src/export/color';
import type { PagxDocument } from '../src/export/types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

assert(rgbaToHex({ r: 1, g: 0.27, b: 0.4 }, 0.5) === '#ff456680', 'rgba hex with alpha failed');
assert(rgbaToHex({ r: 1, g: 0, b: 0 }) === '#ff0000', 'rgba hex opaque failed');
assert(rgbaToHex({ r: 0, g: 0, b: 1 }, 0.5) === '#0000ff80', 'rgba hex blue half alpha failed');

const sampleDocument: PagxDocument = {
  width: 400,
  height: 300,
  resources: [],
  animations: [],
  customData: {
    'data-exported-by': 'figma-export-pagx',
    'data-figma-root-id': '1:2',
  },
  layers: [
    {
      id: 'layer_1_2',
      name: 'Root Frame',
      attrs: { left: 0, top: 0, width: 400, height: 300 },
      customData: { 'data-figma-id': '1:2' },
      contents: [],
      children: [
        {
          id: 'layer_1_3',
          name: 'Background',
          attrs: { left: 0, top: 0, width: 400, height: 300 },
          customData: { 'data-figma-id': '1:3' },
          contents: [
            { kind: 'rectangle', attrs: { left: 0, top: 0, width: 400, height: 300, roundness: 16 } },
            { kind: 'fill', attrs: { color: '#1E293B' } },
          ],
          children: [],
        },
        {
          id: 'layer_1_4',
          name: 'Circle',
          attrs: { left: 150, top: 90, width: 100, height: 100, alpha: 0.9 },
          customData: { 'data-figma-id': '1:4' },
          contents: [
            { kind: 'ellipse', attrs: { left: 0, top: 0, width: 100, height: 100 } },
            { kind: 'fill', attrs: { color: '#FF4466' } },
            { kind: 'stroke', attrs: { width: 2, color: '#FFFFFF' } },
          ],
          children: [],
        },
      ],
    },
  ],
};

const xml = writePagxXml(sampleDocument);

assert(xml.includes('<pagx width="400" height="300"'), 'pagx root missing');
assert(xml.includes('<Rectangle'), 'rectangle missing');
assert(xml.includes('<Ellipse'), 'ellipse missing');
assert(xml.includes('<Fill color="#1E293B"/>'), 'fill missing');
assert(xml.includes('data-figma-id="1:4"'), 'figma id missing');
assert(xml.includes('alpha="0.9"'), 'alpha missing');

const gradientDocument: PagxDocument = {
  width: 100,
  height: 100,
  resources: [],
  animations: [],
  customData: {},
  layers: [
    {
      id: 'layer_grad',
      name: 'Gradient',
      attrs: { left: 0, top: 0, width: 100, height: 100 },
      customData: {},
      contents: [
        { kind: 'rectangle', attrs: { left: 0, top: 0, width: 100, height: 100 } },
        {
          kind: 'fill',
          attrs: {},
          colorSource: {
            kind: 'linearGradient',
            startPoint: '0,0.5',
            endPoint: '1,0.5',
            stops: [
              { offset: 0, color: '#FF0000' },
              { offset: 1, color: '#0000FF' },
            ],
          },
        },
        {
          kind: 'dropShadowStyle',
          attrs: { offsetX: 0, offsetY: 4, blurX: 8, blurY: 8, color: '#00000040' },
        },
      ],
      children: [],
    },
  ],
};

const gradientXml = writePagxXml(gradientDocument);
assert(gradientXml.includes('<LinearGradient'), 'linear gradient missing');
assert(gradientXml.includes('<DropShadowStyle'), 'drop shadow missing');

console.log('export smoke tests passed');

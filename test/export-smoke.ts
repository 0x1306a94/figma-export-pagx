import { writePagxXml } from '../src/export/pagx-writer';
import { createExportContext, mapFigmaToPagx } from '../src/export/figma-to-pagx';
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

async function testMotionDataIsSkipped(): Promise<void> {
  (globalThis as unknown as { figma: { mixed: symbol } }).figma = {
    mixed: Symbol('mixed'),
  };

  const animatedRoot = {
    id: '1:1',
    name: 'Animated Root',
    type: 'FRAME',
    layoutMode: 'NONE',
    visible: true,
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    fills: [],
    strokes: [],
    effects: [],
    children: [],
    animations: {
      OPACITY: {
        timelineDuration: 1,
        baseValue: { type: 'FLOAT' as const, value: 1 },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: { type: 'LINEAR' as const } },
            { timelinePosition: 1, value: { type: 'FLOAT' as const, value: 1 }, easing: { type: 'LINEAR' as const } },
          ],
        }],
      },
    },
    animationStyles: [],
    timelines: [],
  } as unknown as FrameNode;

  const document = await mapFigmaToPagx(animatedRoot, createExportContext(animatedRoot));
  assert(document.animations.length === 0, 'motion data should not be exported yet');
  assert(!writePagxXml(document).includes('<Animations>'), 'xml should not include Animations');
}

async function testStaticExportSkipsLayerMatrix(): Promise<void> {
  (globalThis as unknown as { figma: { mixed: symbol } }).figma = {
    mixed: Symbol('mixed'),
  };

  const root = {
    id: '1:1',
    name: 'Root',
    type: 'FRAME',
    layoutMode: 'NONE',
    visible: true,
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    width: 880,
    height: 1325,
    x: 0,
    y: 0,
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 880, height: 1325 },
    fills: [],
    strokes: [],
    effects: [],
    children: [{
      id: '1:2',
      name: 'Flipped Rectangle',
      type: 'RECTANGLE',
      visible: true,
      opacity: 1,
      blendMode: 'PASS_THROUGH',
      width: 340,
      height: 304,
      x: 831,
      y: 1167,
      rotation: 180,
      absoluteTransform: [[-1, 0, 831], [0, -1, 1167]],
      absoluteBoundingBox: { x: 491, y: 863, width: 340, height: 304 },
      fills: [],
      strokes: [],
      effects: [],
    }],
  } as unknown as FrameNode;

  const document = await mapFigmaToPagx(root, createExportContext(root));
  const exportedXml = writePagxXml(document);
  assert(!exportedXml.includes(' matrix='), 'static export should not write pure flip layer matrix');
}

async function testStaticExportKeepsRotatedLayerMatrix(): Promise<void> {
  (globalThis as unknown as { figma: { mixed: symbol } }).figma = {
    mixed: Symbol('mixed'),
  };

  const degrees = 50;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const root = {
    id: '1:1',
    name: 'Root',
    type: 'FRAME',
    layoutMode: 'NONE',
    visible: true,
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    width: 880,
    height: 1325,
    x: 4634,
    y: 2370,
    absoluteTransform: [[-1, 0, 4634], [0, -1, 2370]],
    absoluteBoundingBox: { x: 3754, y: 1045, width: 880, height: 1325 },
    fills: [],
    strokes: [],
    effects: [],
    children: [{
      id: '1:2',
      name: 'Rotated Rectangle',
      type: 'RECTANGLE',
      visible: true,
      opacity: 1,
      blendMode: 'PASS_THROUGH',
      width: 340,
      height: 304,
      x: 886.712646484375,
      y: 983.4760131835938,
      rotation: -130.0000013181132,
      absoluteTransform: [[cos, sin, 3747.287353515625], [-sin, cos, 1386.52392578125]],
      absoluteBoundingBox: {
        x: 3747.287353515625,
        y: 1126.0688169002533,
        width: 451.42530512809753,
        height: 455.8625500202179,
      },
      fills: [],
      strokes: [],
      effects: [],
    }],
  } as unknown as FrameNode;

  const document = await mapFigmaToPagx(root, createExportContext(root));
  const exportedXml = writePagxXml(document);
  assert(exportedXml.includes(' matrix='), 'static export should keep rotated layer matrix');
  assert(
    exportedXml.includes('matrix="0.64,-0.77,0.77,0.64'),
    'parent flip should not turn 50 degree rotation into -130 degree matrix',
  );
  assert(
    exportedXml.includes('matrix="0.64,-0.77,0.77,0.64,0,260.46"'),
    'parent flip correction should recompute matrix offset from rotated bounds',
  );
}

Promise.all([
  testMotionDataIsSkipped(),
  testStaticExportSkipsLayerMatrix(),
  testStaticExportKeepsRotatedLayerMatrix(),
]).then(() => {
  console.log('export smoke tests passed');
});

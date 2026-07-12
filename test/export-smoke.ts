import { writePagxXml } from '../src/export/pagx/writer';
import { createExportContext, mapFigmaToPagx } from '../src/export/pagx/figma-to-pagx';
import { rgbaToHex } from '../src/export/shared/color';
import type { PagxDocument } from '../src/export/pagx/types';

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
    'data-exported-by': 'figma-motion-export-pagx',
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

const imageFillXml = writePagxXml({
  width: 10,
  height: 10,
  resources: [{ kind: 'image', id: 'image', source: 'data:image/png;base64,AA==' }],
  animations: [],
  customData: {},
  layers: [{
    id: 'image-layer',
    name: 'Image',
    attrs: {},
    customData: {},
    contents: [
      { kind: 'rectangle', attrs: { width: 10, height: 10 } },
      {
        kind: 'fill',
        attrs: { blendMode: 'multiply' },
        colorSource: { kind: 'imagePattern', imageRef: '@image', scaleMode: 'stretch' },
      },
    ],
    children: [],
  }],
});
assert(
  imageFillXml.indexOf('<Rectangle') < imageFillXml.indexOf('<Fill blendMode="multiply">'),
  'image fill should follow its geometry and preserve blend mode',
);

async function testMotionDataIsExported(): Promise<void> {
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
  const exportedXml = writePagxXml(document);
  assert(document.animations.length === 1, 'motion data should be exported');
  assert(exportedXml.includes('<Animations>'), 'xml should include Animations');
  assert(exportedXml.includes('<Channel name="alpha" type="float">'), 'opacity should export as alpha channel');
  assert(exportedXml.includes('<Key time="0" value="0"/>'), 'first opacity keyframe missing');
  assert(exportedXml.includes('<Key time="30" value="1"/>'), 'last opacity keyframe missing');
  assert(exportedXml.includes('frameRate="30"'), 'default animation frameRate should be 30');
}

async function testNoMotionDataSkipsAnimations(): Promise<void> {
  (globalThis as unknown as { figma: { mixed: symbol } }).figma = {
    mixed: Symbol('mixed'),
  };

  const staticRoot = {
    id: '1:1',
    name: 'Static Root',
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
    animations: {},
    animationStyles: [],
    timelines: [],
  } as unknown as FrameNode;

  const document = await mapFigmaToPagx(staticRoot, createExportContext(staticRoot));
  assert(document.animations.length === 0, 'static root should not export animations');
  assert(!writePagxXml(document).includes('<Animations>'), 'xml should omit Animations without motion data');
}

async function testRotationMotionUsesInnerGroup(): Promise<void> {
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
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
    fills: [],
    strokes: [],
    effects: [],
    children: [{
      id: '1:2',
      name: 'Rotating Rectangle',
      type: 'RECTANGLE',
      visible: true,
      opacity: 1,
      blendMode: 'PASS_THROUGH',
      width: 100,
      height: 80,
      x: 50,
      y: 60,
      absoluteTransform: [[1, 0, 50], [0, 1, 60]],
      absoluteBoundingBox: { x: 50, y: 60, width: 100, height: 80 },
      fills: [],
      strokes: [],
      effects: [],
      animations: {
        ROTATION: {
          timelineDuration: 1,
          baseValue: { type: 'FLOAT' as const, value: 0 },
          tracks: [{
            keyframeOperation: 'OFFSET' as const,
            keyframes: [
              { timelinePosition: 0, value: { type: 'FLOAT' as const, value: -90 }, easing: { type: 'LINEAR' as const } },
              { timelinePosition: 1, value: { type: 'FLOAT' as const, value: 0 }, easing: { type: 'LINEAR' as const } },
            ],
          }],
        },
      },
      animationStyles: [],
      timelines: [],
    }],
    animations: {},
    animationStyles: [],
    timelines: [{ duration: 1 }],
  } as unknown as FrameNode;

  const document = await mapFigmaToPagx(root, createExportContext(root));
  const exportedXml = writePagxXml(document);
  assert(exportedXml.includes('<Group'), 'rotation motion should wrap contents in an inner Group');
  assert(exportedXml.includes('anchor="50,40"'), 'motion Group should rotate around shape center');
  assert(exportedXml.includes('position="50,40"'), 'motion Group position should match anchor at rest');
  assert(exportedXml.includes('<Channel name="rotation" type="float">'), 'rotation motion should use scalar rotation channel');
  assert(!exportedXml.includes('<Channel name="matrix" type="matrix">'), 'rotation motion should not use matrix channel');
}

async function testManualSetRotationMotionUsesTopLeftPivot(): Promise<void> {
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
    width: 812,
    height: 1229,
    x: 0,
    y: 0,
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 812, height: 1229 },
    fills: [],
    strokes: [],
    effects: [],
    children: [{
      id: '15:22',
      name: 'Rectangle 31',
      type: 'RECTANGLE',
      visible: true,
      opacity: 1,
      blendMode: 'PASS_THROUGH',
      width: 287,
      height: 220,
      x: 160,
      y: 782,
      absoluteTransform: [[1, 0, 160], [0, 1, 782]],
      absoluteBoundingBox: { x: 160, y: 782, width: 287, height: 220 },
      fills: [],
      strokes: [],
      effects: [],
      animations: {
        ROTATION: {
          timelineDuration: 2,
          baseValue: { type: 'FLOAT' as const, value: 0 },
          tracks: [{
            keyframeOperation: 'SET' as const,
            keyframes: [
              { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: { type: 'LINEAR' as const } },
              { timelinePosition: 0.499, value: { type: 'FLOAT' as const, value: 180.00000500895632 }, easing: { type: 'LINEAR' as const } },
            ],
          }],
        },
      },
      animationStyles: [],
      timelines: [],
    }],
    animations: {},
    animationStyles: [],
    timelines: [{ duration: 2 }],
  } as unknown as FrameNode;

  const document = await mapFigmaToPagx(root, createExportContext(root));
  const exportedXml = writePagxXml(document);
  assert(exportedXml.includes('anchor="0,0"'), 'manual SET rotation should use top-left anchor');
  assert(exportedXml.includes('position="0,0"'), 'manual SET rotation position should match top-left anchor');
  assert(exportedXml.includes('<Channel name="rotation" type="float">'), 'manual SET rotation should use scalar rotation channel');
}

async function testScaleMotionInfersPivotFromRenderBounds(): Promise<void> {
  (globalThis as unknown as { figma: { mixed: symbol } }).figma = {
    mixed: Symbol('mixed'),
  };

  let cachedAnchor = '';
  const root = {
    id: '1:1',
    name: 'Root',
    type: 'FRAME',
    layoutMode: 'NONE',
    visible: true,
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    width: 812,
    height: 1229,
    x: 0,
    y: 0,
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 812, height: 1229 },
    fills: [],
    strokes: [],
    effects: [],
    children: [{
      id: '17:92',
      name: 'Rectangle 32',
      type: 'RECTANGLE',
      visible: true,
      opacity: 1,
      blendMode: 'PASS_THROUGH',
      width: 177,
      height: 155,
      x: 424,
      y: 1050,
      absoluteTransform: [[1, 0, 424], [0, 1, 1050]],
      absoluteBoundingBox: { x: 424, y: 1050, width: 177, height: 155 },
      absoluteRenderBounds: {
        x: 363.043701171875,
        y: 1023.31005859375,
        width: 237.956298828125,
        height: 205.68994140625,
      },
      getSharedPluginData(namespace: string, key: string): string {
        return namespace === 'pagx' && key === 'anchor' ? cachedAnchor : '';
      },
      setSharedPluginData(namespace: string, key: string, value: string): void {
        if (namespace === 'pagx' && key === 'anchor') {
          cachedAnchor = value;
        }
      },
      fills: [],
      strokes: [],
      effects: [],
      animations: {
        SCALE_XY: {
          timelineDuration: 2,
          baseValue: { type: 'VECTOR' as const, value: { x: 1, y: 1 } },
          tracks: [{
            keyframeOperation: 'SET' as const,
            keyframes: [
              { timelinePosition: 0, value: { type: 'VECTOR' as const, value: { x: 1, y: 1 } }, easing: { type: 'LINEAR' as const } },
              {
                timelinePosition: 0.496,
                value: { type: 'VECTOR' as const, value: { x: 2.960423469543457, y: 2.960423469543457 } },
                easing: { type: 'LINEAR' as const },
              },
            ],
          }],
        },
      },
      animationStyles: [],
      timelines: [],
    }],
    animations: {},
    animationStyles: [],
    timelines: [{ duration: 2 }],
  } as unknown as FrameNode;

  const document = await mapFigmaToPagx(root, createExportContext(root));
  const exportedXml = writePagxXml(document);
  assert(exportedXml.includes('anchor="177,77.5"'), 'scale motion should infer right-center anchor');
  assert(exportedXml.includes('position="177,77.5"'), 'scale motion position should match inferred anchor');
  assert(exportedXml.includes('<Channel name="scale.x" type="float">'), 'scale motion should use runtime-supported scale.x channel');
  assert(exportedXml.includes('<Channel name="scale.y" type="float">'), 'scale motion should use runtime-supported scale.y channel');
  assert(!exportedXml.includes('<Channel name="matrix" type="matrix">'), 'Group target should not use unsupported matrix channel');
  assert(cachedAnchor === '177,77.5', 'inferred scale anchor should be cached');
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

async function testHorizontalFlippedRootUsesVisualChildPosition(): Promise<void> {
  (globalThis as unknown as { figma: { mixed: symbol } }).figma = {
    mixed: Symbol('mixed'),
  };

  const root = {
    id: '1:1',
    name: 'Frame7',
    type: 'FRAME',
    layoutMode: 'NONE',
    visible: true,
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    width: 880,
    height: 1325,
    x: 0,
    y: 0,
    absoluteTransform: [[-1, 0, 880], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 880, height: 1325 },
    fills: [],
    strokes: [],
    effects: [],
    children: [{
      id: '1:2',
      name: 'Rectangle 17',
      type: 'RECTANGLE',
      visible: true,
      opacity: 1,
      blendMode: 'PASS_THROUGH',
      width: 340,
      height: 304,
      x: 49,
      y: 159,
      absoluteTransform: [[-1, 0, 831], [0, 1, 159]],
      absoluteBoundingBox: { x: 491, y: 159, width: 340, height: 304 },
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
      strokes: [],
      effects: [],
    }],
  } as unknown as FrameNode;

  const document = await mapFigmaToPagx(root, createExportContext(root));
  const exportedXml = writePagxXml(document);
  assert(
    exportedXml.includes('<Layer name="Rectangle 17" id="layer_1_2" left="491" top="159"'),
    'child of horizontal flipped root should export visual left/top',
  );
}

async function testSiblingMaskExportsMaskReference(): Promise<void> {
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
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
    fills: [],
    strokes: [],
    effects: [],
    children: [
      {
        id: '1:2',
        name: 'Mask Shape',
        type: 'RECTANGLE',
        visible: true,
        opacity: 1,
        blendMode: 'PASS_THROUGH',
        width: 100,
        height: 100,
        x: 20,
        y: 20,
        absoluteTransform: [[1, 0, 20], [0, 1, 20]],
        absoluteBoundingBox: { x: 20, y: 20, width: 100, height: 100 },
        fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
        strokes: [],
        effects: [],
        isMask: true,
        maskType: 'VECTOR',
      },
      {
        id: '1:3',
        name: 'Masked Rectangle',
        type: 'RECTANGLE',
        visible: true,
        opacity: 1,
        blendMode: 'PASS_THROUGH',
        width: 120,
        height: 120,
        x: 40,
        y: 40,
        absoluteTransform: [[1, 0, 40], [0, 1, 40]],
        absoluteBoundingBox: { x: 40, y: 40, width: 120, height: 120 },
        fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 0, b: 0 }, opacity: 1 }],
        strokes: [],
        effects: [],
      },
    ],
  } as unknown as FrameNode;

  const document = await mapFigmaToPagx(root, createExportContext(root));
  const exportedXml = writePagxXml(document);
  assert(exportedXml.includes('<Layer name="Mask Shape" id="layer_1_2"'), 'mask layer missing');
  assert(exportedXml.includes('visible="false"'), 'mask layer should be hidden');
  assert(exportedXml.includes('<Layer name="Masked Rectangle" id="layer_1_3"'), 'masked layer missing');
  assert(exportedXml.includes('mask="@layer_1_2"'), 'masked layer should reference mask layer');
  assert(exportedXml.includes('maskType="contour"'), 'vector mask should export as contour mask');
}

async function testImageAndSolidFillsKeepOriginalOrder(): Promise<void> {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  (globalThis as unknown as { figma: Record<string, unknown> }).figma = {
    mixed: Symbol('mixed'),
    getImageByHash: () => ({ getBytesAsync: async () => pngBytes }),
    base64Encode: () => 'iVBORw0KGgo=',
  };
  const root = {
    id: '54:6',
    name: 'IMG_18581',
    type: 'RECTANGLE',
    visible: true,
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    width: 520,
    height: 1156,
    x: 0,
    y: 0,
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 520, height: 1156 },
    fills: [
      { type: 'IMAGE', visible: true, opacity: 1, blendMode: 'NORMAL', imageHash: 'image', scaleMode: 'FILL' },
      {
        type: 'SOLID',
        visible: true,
        opacity: 0.2,
        blendMode: 'LINEAR_DODGE',
        color: { r: 0.09592108428478241, g: 0.16260024905204773, b: 0.896071195602417 },
      },
    ],
    strokes: [],
    effects: [],
    animations: {},
    animationStyles: [],
    timelines: [],
    exportAsync: async () => pngBytes,
  } as unknown as RectangleNode;

  const xml = writePagxXml(await mapFigmaToPagx(root, createExportContext(root)));
  const imageFillIndex = xml.indexOf('<ImagePattern');
  const solidFillIndex = xml.indexOf('blendMode="colorDodge"');
  assert((xml.match(/<Fill/g) ?? []).length === 2, 'image and solid fills should both be exported');
  assert(imageFillIndex >= 0 && solidFillIndex > imageFillIndex, 'fills should keep their Figma order');
  assert(/color="#[0-9A-Fa-f]{6}33"/.test(xml), 'solid fill opacity should be preserved');
}

Promise.all([
  testMotionDataIsExported(),
  testNoMotionDataSkipsAnimations(),
  testRotationMotionUsesInnerGroup(),
  testManualSetRotationMotionUsesTopLeftPivot(),
  testScaleMotionInfersPivotFromRenderBounds(),
  testStaticExportSkipsLayerMatrix(),
  testStaticExportKeepsRotatedLayerMatrix(),
  testHorizontalFlippedRootUsesVisualChildPosition(),
  testSiblingMaskExportsMaskReference(),
  testImageAndSolidFillsKeepOriginalOrder(),
]).then(() => {
  console.log('export smoke tests passed');
});

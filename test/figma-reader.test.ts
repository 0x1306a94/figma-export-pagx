import {
  fillsToElements,
  geometryPathData,
  layoutPositionAttrs,
  nodeMatrixInParent,
  nodePositionInParent,
  pagxMotionMatrixStringFromComponents,
  readAutoLayoutAttrs,
  readFlexGrow,
  strokesToElements,
} from '../src/export/figma-reader';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mockNode(overrides: Record<string, unknown>): SceneNode {
  return overrides as unknown as SceneNode;
}

(globalThis as unknown as { figma: { mixed: symbol } }).figma = {
  mixed: Symbol('mixed'),
};

const multiplyFill = fillsToElements(
  [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, blendMode: 'MULTIPLY' } as SolidPaint],
  'paint-fill',
  [],
);
assert(multiplyFill[0]?.attrs.blendMode === 'multiply', 'fill blend mode should be exported');

const screenStroke = strokesToElements(
  [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, blendMode: 'SCREEN' } as SolidPaint],
  { strokeWeight: 2, strokeAlign: 'CENTER' } as GeometryMixin & MinimalStrokesMixin,
  'paint-stroke',
  [],
);
assert(screenStroke[0]?.attrs.blendMode === 'screen', 'stroke blend mode should be exported');

const autoLayoutParent = mockNode({
  type: 'FRAME',
  layoutMode: 'HORIZONTAL',
  absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
});

const flowChild = mockNode({
  type: 'RECTANGLE',
  layoutPositioning: 'AUTO',
  absoluteBoundingBox: { x: 10, y: 20, width: 30, height: 40 },
});

const absoluteChild = mockNode({
  type: 'RECTANGLE',
  layoutPositioning: 'ABSOLUTE',
  absoluteBoundingBox: { x: 10, y: 20, width: 30, height: 40 },
});

assert(
  layoutPositionAttrs(flowChild, autoLayoutParent).left === undefined,
  'auto layout flow child should not export left/top',
);
assert(
  layoutPositionAttrs(absoluteChild, autoLayoutParent).left === 10,
  'absolute child should export left/top',
);
assert(
  layoutPositionAttrs(absoluteChild, autoLayoutParent).includeInLayout === false,
  'absolute child should set includeInLayout=false',
);

const gridParent = mockNode({
  type: 'FRAME',
  layoutMode: 'GRID',
  itemSpacing: 10,
  paddingTop: 8,
  paddingRight: 8,
  paddingBottom: 8,
  paddingLeft: 8,
  absoluteBoundingBox: { x: 0, y: 0, width: 376, height: 272 },
});

const gridCell = mockNode({
  type: 'FRAME',
  layoutPositioning: 'AUTO',
  absoluteBoundingBox: { x: 58, y: 110, width: 48, height: 48 },
});

assert(
  layoutPositionAttrs(gridCell, gridParent).left === 58,
  'grid cell should export absolute left/top',
);
assert(
  layoutPositionAttrs(gridCell, gridParent).top === 110,
  'grid cell should export absolute top',
);
assert(
  readAutoLayoutAttrs(gridParent as FrameNode).layout === undefined,
  'grid frame should not export flex layout',
);
assert(
  readAutoLayoutAttrs(gridParent as FrameNode).gap === undefined,
  'grid frame should not export gap without layout',
);

assert(
  readFlexGrow(gridCell, gridParent) === undefined,
  'grid cell should not export flex without auto-layout parent',
);

const parentAt1881 = mockNode({
  absoluteTransform: [[1, 0, 1881], [0, 1, 2136]],
  absoluteBoundingBox: { x: 1881, y: 2136, width: 4438, height: 2728 },
  x: 1881,
  y: 2136,
});

assert(
  nodePositionInParent(
    mockNode({
      absoluteTransform: [[1, 0, 1881], [0, 1, 2136]],
      absoluteBoundingBox: { x: 1881, y: 2136, width: 4438, height: 2714 },
      x: 0,
      y: 0,
    }),
    parentAt1881,
  ).left === 0,
  'child at same origin as parent should have left=0',
);

assert(
  nodePositionInParent(
    mockNode({
      absoluteTransform: [[1, 0, 5635], [0, 1, 2975]],
      absoluteBoundingBox: { x: 5635, y: 2975, width: 562, height: 1049 },
      x: 3754,
      y: 839,
    }),
    parentAt1881,
  ).left === 3754,
  'nested group should use Position panel x',
);

assert(
  nodePositionInParent(
    mockNode({ x: 100, y: 200 }),
    null,
  ).left === undefined,
  'root layer should not set left/top',
);

const cos45 = Math.cos(Math.PI / 4);
const sin45 = Math.sin(Math.PI / 4);
const rotatedLine = mockNode({
  absoluteTransform: [[cos45, -sin45, 100], [sin45, cos45, 200]],
  absoluteBoundingBox: { x: 100, y: 200, width: 141.42, height: 141.42 },
  width: 200,
  height: 0,
});
const flatParent = mockNode({
  absoluteTransform: [[1, 0, 0], [0, 1, 0]],
  absoluteBoundingBox: { x: 0, y: 0, width: 500, height: 500 },
});

assert(
  nodePositionInParent(rotatedLine, flatParent).left === 100,
  'rotated line should use bbox top-left for layout',
);
assert(
  nodePositionInParent(rotatedLine, flatParent).top === 200,
  'rotated line should use bbox top-left for layout',
);
assert(
  nodeMatrixInParent(rotatedLine, flatParent) === '0.71,0.71,-0.71,0.71,0,0',
  'rotated line should export matrix rotation',
);

const horizontalFlipParent = mockNode({
  type: 'FRAME',
  absoluteTransform: [[-1, 0, 880], [0, 1, 0]],
  absoluteBoundingBox: { x: 0, y: 0, width: 880, height: 1325 },
});
const horizontalFlipChild = mockNode({
  type: 'RECTANGLE',
  x: 49,
  y: 159,
  width: 340,
  height: 304,
  absoluteTransform: [[-1, 0, 831], [0, 1, 159]],
  absoluteBoundingBox: { x: 491, y: 159, width: 340, height: 304 },
});

assert(
  nodePositionInParent(horizontalFlipChild, horizontalFlipParent).left === 491,
  'child of horizontal flipped frame should use visual bbox left',
);
assert(
  nodePositionInParent(horizontalFlipChild, horizontalFlipParent).top === 159,
  'child of horizontal flipped frame should keep visual bbox top',
);

const flippedVector = mockNode({
  absoluteTransform: [[-1, 0, 562], [0, -1, 1049]],
  absoluteBoundingBox: { x: 136, y: 0, width: 426, height: 1049 },
});
const groupParent = mockNode({
  absoluteTransform: [[1, 0, 0], [0, 1, 0]],
  absoluteBoundingBox: { x: 0, y: 0, width: 562, height: 1049 },
});

assert(
  nodePositionInParent(flippedVector, groupParent).left === 136,
  'flipped vector should use bbox position inside parent',
);
assert(
  nodePositionInParent(flippedVector, groupParent).top === 0,
  'flipped vector should use bbox position inside parent',
);
assert(
  nodeMatrixInParent(flippedVector, groupParent) === '-1,0,0,-1,426,1049',
  'flipped vector should compensate transform origin in matrix',
);
assert(
  nodePositionInParent(flippedVector, groupParent).left! + 426 <= 562,
  'flipped vector layout box should fit parent width',
);

const motionPanelChild = mockNode({
  type: 'RECTANGLE',
  x: 175,
  y: 63,
  absoluteTransform: [[1, 0, 175], [0, 1, 63]],
  absoluteBoundingBox: { x: 175, y: 33, width: 77, height: 60 },
});
const motionFrameParent = mockNode({
  type: 'FRAME',
  absoluteTransform: [[1, 0, 0], [0, 1, 0]],
  absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 300 },
});

assert(
  nodePositionInParent(motionPanelChild, motionFrameParent).top === 63,
  'axis-aligned node should use Position panel y instead of bbox top',
);
assert(
  nodePositionInParent(motionPanelChild, motionFrameParent).left === 175,
  'axis-aligned node should use Position panel x',
);

const groupParentAt1534 = mockNode({
  type: 'GROUP',
  absoluteTransform: [[1, 0, 136], [0, 1, 1534]],
  absoluteBoundingBox: { x: 136, y: 1534, width: 649, height: 1034 },
  x: 136,
  y: 1534,
});

const groupChildRect7 = mockNode({
  type: 'RECTANGLE',
  x: 342,
  y: 1777,
  absoluteTransform: [[1, 0, 342], [0, 1, 1777]],
  absoluteBoundingBox: { x: 342, y: 1777, width: 401, height: 521 },
});

assert(
  nodePositionInParent(groupChildRect7, groupParentAt1534).left === 206,
  'group child should use bbox left relative to parent',
);
assert(
  nodePositionInParent(groupChildRect7, groupParentAt1534).top === 243,
  'group child should use bbox top relative to parent',
);
assert(
  nodeMatrixInParent(groupChildRect7, groupParentAt1534) === undefined,
  'axis-aligned group child should not need compensating matrix',
);

assert(
  pagxMotionMatrixStringFromComponents(0, 0, -90, 1, 1, 41, 37.5) === '0,-1,1,0,3.5,78.5',
  'motion matrix should rotate around pivot instead of origin',
);

assert(
  geometryPathData({
    type: 'LINE',
    width: 2686,
    height: 0,
    fillGeometry: [],
    strokeGeometry: [],
  }) === 'M 0 0 L 2686 0',
  'line without geometry should synthesize path from width/height',
);

assert(
  geometryPathData({
    type: 'VECTOR',
    fillGeometry: [],
    strokeGeometry: [{ data: 'M 0 0 L 100 200', windingRule: 'NONZERO' }],
  }) === 'M 0 0 L 100 200',
  'stroke-only vector should use strokeGeometry',
);

assert(
  geometryPathData({
    type: 'VECTOR',
    fillGeometry: [{ data: 'M 0 0 L 50 50', windingRule: 'NONZERO' }],
    strokeGeometry: [{ data: 'M 0 0 L 100 200', windingRule: 'NONZERO' }],
  }) === 'M 0 0 L 50 50',
  'fill geometry should take priority over stroke geometry',
);

console.log('figma-reader tests passed');

import { writePagxXml } from '../src/export/pagx-writer';
import { textLayerAttrs, textNeedsTextBox, textUsesLayerTransform } from '../src/export/figma-to-pagx';
import type { PagxDocument } from '../src/export/types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mockNode(overrides: Record<string, unknown>): SceneNode {
  return overrides as unknown as SceneNode;
}

const parent = mockNode({
  absoluteTransform: [[1, 0, 100], [0, 1, 200]],
  absoluteBoundingBox: { x: 100, y: 200, width: 800, height: 600 },
});

const simpleText = mockNode({
  type: 'TEXT',
  opacity: 1,
  blendMode: 'NORMAL',
  visible: true,
  absoluteTransform: [[1, 0, 150], [0, 1, 260]],
  absoluteBoundingBox: { x: 150, y: 260, width: 120, height: 40 },
  width: 120,
  height: 40,
}) as TextNode;

const rotatedText = mockNode({
  type: 'TEXT',
  opacity: 1,
  blendMode: 'NORMAL',
  visible: true,
  absoluteTransform: [[0, -1, 300], [1, 0, 400]],
  absoluteBoundingBox: { x: 300, y: 300, width: 40, height: 120 },
  width: 120,
  height: 40,
}) as TextNode;

assert(!textUsesLayerTransform(simpleText, parent), 'simple text should not use layer transform');
assert(textUsesLayerTransform(rotatedText, parent), 'rotated text should use layer transform');

const simpleLayerAttrs = textLayerAttrs(simpleText, parent);
assert(simpleLayerAttrs.left === undefined, 'simple text layer should not set left');
assert(simpleLayerAttrs.width === undefined, 'simple text layer should not set width');

const rotatedLayerAttrs = textLayerAttrs(rotatedText, parent);
assert(rotatedLayerAttrs.left === 200, 'rotated text layer should keep layout left');
assert(rotatedLayerAttrs.matrix !== undefined, 'rotated text layer should keep matrix');
assert(rotatedLayerAttrs.width === undefined, 'rotated text layer should not set width');

const autoLayoutParent = mockNode({
  type: 'FRAME',
  layoutMode: 'HORIZONTAL',
  absoluteTransform: [[1, 0, 0], [0, 1, 0]],
  absoluteBoundingBox: { x: 0, y: 0, width: 402, height: 40 },
}) as FrameNode;

const wrappedText = mockNode({
  type: 'TEXT',
  opacity: 1,
  blendMode: 'NORMAL',
  visible: true,
  textAutoResize: 'HEIGHT',
  layoutGrow: 1,
  width: 139,
  height: 24,
  absoluteTransform: [[1, 0, 62], [0, 1, 561]],
  absoluteBoundingBox: { x: 62, y: 561, width: 139, height: 24 },
}) as TextNode;

assert(textNeedsTextBox(wrappedText, autoLayoutParent), 'fixed-width text in auto layout should use TextBox');

const wrappedLayerAttrs = textLayerAttrs(wrappedText, autoLayoutParent);
assert(wrappedLayerAttrs.flex === 1, 'wrapped text layer should keep flex');
assert(wrappedLayerAttrs.width === 139, 'wrapped text layer should export width');
assert(wrappedLayerAttrs.left === undefined, 'wrapped text layer should omit left in flow layout');

const wrappedTextDocument: PagxDocument = {
  width: 402,
  height: 875,
  resources: [],
  animations: [],
  customData: {},
  layers: [
    {
      id: 'layer_text',
      name: 'Event title',
      attrs: wrappedLayerAttrs,
      customData: { 'data-figma-id': '197:275' },
      contents: [
        {
          kind: 'textbox',
          attrs: { width: '100%', wordWrap: true },
          children: [
            {
              kind: 'text',
              attrs: { fontFamily: 'PingFang SC', fontSize: 12 },
              text: '[1v1v1 ] 循环赛 鸣哨 : 法兹FAZI VS Fayzz',
            },
            { kind: 'fill', attrs: { color: '#ffffff' } },
          ],
        },
      ],
      children: [],
    },
  ],
};

const wrappedTextXml = writePagxXml(wrappedTextDocument);
assert(wrappedTextXml.includes('<TextBox width="100%" wordWrap="true">'), 'auto layout text should export TextBox');
assert(wrappedTextXml.includes('width="139"') && wrappedTextXml.includes('flex="1"'), 'text layer should keep layout attrs');

const simpleTextDocument: PagxDocument = {
  width: 800,
  height: 600,
  resources: [],
  animations: [],
  customData: {},
  layers: [
    {
      id: 'layer_root',
      name: 'Root',
      attrs: { width: 800, height: 600 },
      customData: {},
      contents: [],
      children: [
        {
          id: 'layer_text',
          name: 'Label',
          attrs: {},
          customData: { 'data-figma-id': '1:2' },
          contents: [
            {
              kind: 'text',
              attrs: {
                left: 50,
                top: 60,
                fontFamily: 'Arial',
                fontSize: 24,
              },
              text: 'Hello',
            },
            { kind: 'fill', attrs: { color: '#000000' } },
          ],
          children: [],
        },
      ],
    },
  ],
};

const simpleTextXml = writePagxXml(simpleTextDocument);
assert(simpleTextXml.includes('<Text left="50" top="60" fontFamily="Arial" fontSize="24">'), 'text position should live on Text');
assert(simpleTextXml.includes('<Layer name="Label" id="layer_text"'), 'text wrapper layer should remain for Fill scope');
assert(!simpleTextXml.includes('id="layer_text" left='), 'text wrapper layer should not duplicate left');

console.log('text-export tests passed');

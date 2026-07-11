import assert from 'node:assert/strict';
import { LayerType, ParagraphJustification } from '../src/export/pag/types';
import {
  createPagExportContext,
  mapFigmaToPag,
} from '../src/export/pag/figma-to-pag';

(globalThis as unknown as { figma: { mixed: symbol } }).figma = {
  mixed: Symbol('mixed'),
};

function mockText(overrides: Record<string, unknown>): TextNode {
  return {
    id: 'text:1',
    name: 'Label',
    type: 'TEXT',
    visible: true,
    opacity: 1,
    blendMode: 'NORMAL',
    width: 120,
    height: 40,
    absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
    characters: 'Hello',
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 20,
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    fills: [{ type: 'SOLID', visible: true, opacity: 1, color: { r: 0, g: 0, b: 0 } }],
    strokes: [],
    effects: [],
    animations: {},
    animationStyles: [],
    timelines: [],
    ...overrides,
  } as unknown as TextNode;
}

async function testPointTextRoot(): Promise<void> {
  const root = mockText({ textAutoResize: 'WIDTH_AND_HEIGHT', textAlignHorizontal: 'CENTER' });
  const ctx = createPagExportContext();
  const file = await mapFigmaToPag(root, ctx);
  const layer = file.compositions[0].layers[0];
  assert.equal(layer.type, LayerType.Text);
  if (layer.type !== LayerType.Text) {
    return;
  }
  assert.equal(layer.sourceText.boxText, false);
  assert.equal(layer.sourceText.firstBaseLine, 0);
  assert.deepEqual(layer.sourceText.boxTextSize, { x: 0, y: 0 });
  assert.equal(layer.sourceText.justification, ParagraphJustification.CenterJustify);
  assert.equal(layer.transform.anchorPoint.animatable, false);
  assert.equal(layer.transform.position.animatable, false);
  if (layer.transform.anchorPoint.animatable || layer.transform.position.animatable) {
    return;
  }
  assert.deepEqual(layer.transform.anchorPoint.value, { x: 0, y: 0 });
  // left=0,top=0,w=120,fontSize=20,CENTER → (60, 16)
  assert.deepEqual(layer.transform.position.value, { x: 60, y: 16 });
}

async function testBoxTextRoot(): Promise<void> {
  const root = mockText({
    textAutoResize: 'NONE',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    width: 200,
    height: 100,
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
  });
  const ctx = createPagExportContext();
  const file = await mapFigmaToPag(root, ctx);
  const layer = file.compositions[0].layers[0];
  assert.equal(layer.type, LayerType.Text);
  if (layer.type !== LayerType.Text) {
    return;
  }
  assert.equal(layer.sourceText.boxText, true);
  assert.equal(layer.sourceText.firstBaseLine, 16);
  assert.deepEqual(layer.sourceText.boxTextPos, { x: 0, y: 0 });
  assert.deepEqual(layer.sourceText.boxTextSize, { x: 200, y: 100 });
  assert.ok(
    ctx.diagnostics.some((item) => item.code === 'TEXT_BOX_VERTICAL_CENTER'),
    'NONE+TOP should warn about PAG vertical center',
  );
  // box root keeps center anchor
  assert.equal(layer.transform.anchorPoint.animatable, false);
  if (layer.transform.anchorPoint.animatable) {
    return;
  }
  assert.deepEqual(layer.transform.anchorPoint.value, { x: 100, y: 50 });
}

async function testHeightBoxNoTopWarn(): Promise<void> {
  const root = mockText({
    textAutoResize: 'HEIGHT',
    textAlignVertical: 'TOP',
  });
  const ctx = createPagExportContext();
  await mapFigmaToPag(root, ctx);
  assert.ok(
    !ctx.diagnostics.some((item) => item.code === 'TEXT_BOX_VERTICAL_CENTER'),
    'HEIGHT should not warn TEXT_BOX_VERTICAL_CENTER',
  );
}

async function main(): Promise<void> {
  await testPointTextRoot();
  await testBoxTextRoot();
  await testHeightBoxNoTopWarn();
  console.log('pag-text-export.test.ts: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import assert from 'node:assert/strict';
import { ParagraphJustification } from '../src/export/pag/types';
import {
  buildTextDocumentFields,
  estimateFirstBaseLine,
  justificationFromAlign,
  leadingFromLineHeight,
  pointTextAnchorPosition,
  textLayoutModeFromAutoResize,
  trackingFromLetterSpacing,
} from '../src/export/pag/text-document';

function testLayoutMode(): void {
  assert.equal(textLayoutModeFromAutoResize('WIDTH_AND_HEIGHT'), 'point');
  assert.equal(textLayoutModeFromAutoResize('NONE'), 'box');
  assert.equal(textLayoutModeFromAutoResize('HEIGHT'), 'box');
  assert.equal(textLayoutModeFromAutoResize('TRUNCATE'), 'box');
}

function testJustification(): void {
  assert.equal(justificationFromAlign('LEFT'), ParagraphJustification.LeftJustify);
  assert.equal(justificationFromAlign('CENTER'), ParagraphJustification.CenterJustify);
  assert.equal(justificationFromAlign('RIGHT'), ParagraphJustification.RightJustify);
  assert.equal(
    justificationFromAlign('JUSTIFIED'),
    ParagraphJustification.FullJustifyLastLineLeft,
  );
}

function testLeadingTracking(): void {
  assert.equal(leadingFromLineHeight({ unit: 'AUTO' }, 24), 0);
  assert.equal(leadingFromLineHeight({ unit: 'PIXELS', value: 36 }, 24), 36);
  assert.equal(leadingFromLineHeight({ unit: 'PERCENT', value: 150 }, 24), 36);
  assert.equal(leadingFromLineHeight(null, 24), 0);

  assert.equal(trackingFromLetterSpacing({ unit: 'PIXELS', value: 2.4 }, 24), 100);
  assert.equal(trackingFromLetterSpacing({ unit: 'PERCENT', value: 10 }, 24), 100);
  assert.equal(trackingFromLetterSpacing(null, 24), 0);
}

function testFirstBaseLine(): void {
  assert.equal(estimateFirstBaseLine(20), 16);
}

function testPointTextAnchor(): void {
  assert.deepEqual(
    pointTextAnchorPosition({
      left: 10,
      top: 20,
      width: 100,
      height: 40,
      fontSize: 20,
      align: 'LEFT',
    }),
    { anchor: { x: 0, y: 0 }, position: { x: 10, y: 36 } },
  );
  assert.deepEqual(
    pointTextAnchorPosition({
      left: 10,
      top: 20,
      width: 100,
      height: 40,
      fontSize: 20,
      align: 'CENTER',
    }),
    { anchor: { x: 0, y: 0 }, position: { x: 60, y: 36 } },
  );
  assert.deepEqual(
    pointTextAnchorPosition({
      left: 10,
      top: 20,
      width: 100,
      height: 40,
      fontSize: 20,
      align: 'RIGHT',
    }),
    { anchor: { x: 0, y: 0 }, position: { x: 110, y: 36 } },
  );
}

function testBuildFieldsPointVsBox(): void {
  const shared = {
    size: { width: 120, height: 40 },
    fontSize: 20,
    fontFamily: 'Inter',
    fontStyle: 'Regular',
    text: 'Hello',
    align: 'CENTER',
    lineHeight: { unit: 'AUTO' } as { unit: string; value?: number },
    letterSpacing: null,
    fillColor: { red: 0, green: 0, blue: 0 },
  };

  const point = buildTextDocumentFields({ ...shared, mode: 'point' });
  assert.equal(point.boxText, false);
  assert.equal(point.firstBaseLine, 0);
  assert.deepEqual(point.boxTextSize, { x: 0, y: 0 });
  assert.equal(point.justification, ParagraphJustification.CenterJustify);

  const box = buildTextDocumentFields({ ...shared, mode: 'box' });
  assert.equal(box.boxText, true);
  assert.equal(box.firstBaseLine, 16);
  assert.deepEqual(box.boxTextPos, { x: 0, y: 0 });
  assert.deepEqual(box.boxTextSize, { x: 120, y: 40 });
}

testLayoutMode();
testJustification();
testLeadingTracking();
testFirstBaseLine();
testPointTextAnchor();
testBuildFieldsPointVsBox();
console.log('pag-text-document.test.ts: ok');

import assert from 'node:assert/strict';
import {
  applyRotationDirectionForTest,
  collectFloatSamplesForTest,
  readFigmaTranslationSpanForTest,
  readTransformSamplesForTest,
  resolveMatrixTranslationForTest,
  sampleFloatAtEasedForTest,
  springProgressForTest,
} from '../src/export/figma-motion';
import { pagxMotionMatrixStringFromComponents } from '../src/export/figma-reader';

const LINEAR_EASING = { type: 'LINEAR' as const };

function testOffsetTranslationSamplesNegateKeyframe(): void {
  const binding = {
    timelineDuration: 2,
    baseValue: { type: 'FLOAT' as const, value: 789 },
    tracks: [{
      keyframeOperation: 'OFFSET' as const,
      keyframes: [
        { timelinePosition: 0, value: { type: 'FLOAT' as const, value: -200 }, easing: LINEAR_EASING },
        { timelinePosition: 0.5, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
      ],
    }],
  };

  const samples = collectFloatSamplesForTest(binding);
  assert.equal(samples.length, 2);
  assert.equal(samples[0].time, 0);
  assert.equal(samples[0].value, 200);
  assert.equal(samples[1].time, 0.5);
  assert.equal(samples[1].value, 0);
}

function testOffsetTranslationRightDirection(): void {
  const binding = {
    timelineDuration: 2,
    baseValue: { type: 'FLOAT' as const, value: 789 },
    tracks: [{
      keyframeOperation: 'OFFSET' as const,
      keyframes: [
        { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 200 }, easing: LINEAR_EASING },
        { timelinePosition: 0.5, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
      ],
    }],
  };

  const samples = collectFloatSamplesForTest(binding);
  assert.equal(samples[0].value, -200);
  assert.equal(samples[1].value, 0);
}

function testSetTranslationSamplesKeepAbsoluteValues(): void {
  const binding = {
    timelineDuration: 2,
    baseValue: { type: 'FLOAT' as const, value: 0 },
    tracks: [{
      keyframeOperation: 'SET' as const,
      keyframes: [
        { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
        { timelinePosition: 0.599, value: { type: 'FLOAT' as const, value: -423 }, easing: LINEAR_EASING },
      ],
    }],
  };

  const samples = collectFloatSamplesForTest(binding);
  assert.equal(samples[0].time, 0);
  assert.equal(samples[0].value, 0);
  assert.equal(samples[1].time, 0.599);
  assert.equal(samples[1].value, 423);
}

function testManualSetTranslationUsesFirstKeyframeAsMatrixOrigin(): void {
  const node = {
    id: '225:103',
    animations: {
      TRANSLATION_XY: {
        timelineDuration: 2,
        baseValue: { type: 'VECTOR' as const, value: { x: 0, y: 0 } },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            {
              timelinePosition: 0,
              value: { type: 'VECTOR' as const, value: { x: 0, y: 0 } },
              easing: LINEAR_EASING,
            },
            {
              timelinePosition: 0.496,
              value: { type: 'VECTOR' as const, value: { x: -453, y: 76 } },
              easing: LINEAR_EASING,
            },
          ],
        }],
      },
    },
  } as Parameters<typeof readTransformSamplesForTest>[0];

  const span = readFigmaTranslationSpanForTest(node);
  assert.deepEqual(span, { x: 453, y: -76 });

  const transformSamples = readTransformSamplesForTest(node);
  assert.deepEqual(
    resolveMatrixTranslationForTest(node, transformSamples, 0),
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    resolveMatrixTranslationForTest(node, transformSamples, 0.496),
    { x: 453, y: -76 },
  );
}

function testSpringOvershoot(): void {
  const bounce = 0.402;
  let sawOvershoot = false;
  for (let index = 1; index < 60; index += 1) {
    const progress = springProgressForTest(index / 60, bounce);
    if (progress > 1.01) {
      sawOvershoot = true;
      break;
    }
  }
  assert.equal(sawOvershoot, true, 'spring easing should overshoot before settling');
  assert.equal(springProgressForTest(1, bounce), 1);
}

function testRotationSamplingUsesSpring(): void {
  const springEasing = {
    type: 'CUSTOM_SPRING' as const,
    easingFunctionSpring: { bounce: 0.402 },
  };
  const samples = [
    { time: 0, value: 0, easing: springEasing },
    { time: 0.75, value: -90, easing: springEasing },
  ];

  const midRotation = sampleFloatAtEasedForTest(samples, 0.375);
  const linearRotation = -45;
  assert.ok(Math.abs(midRotation - linearRotation) > 2, 'spring rotation should differ from linear midpoint');
  assert.ok(sampleFloatAtEasedForTest(samples, 0.75) <= -85, 'rotation should reach target angle near end');
}

function testRotationDirectionClockwise(): void {
  assert.equal(
    applyRotationDirectionForTest(-90, 'clockwise', 0),
    90,
    'clockwise should flip negative rotation delta to positive',
  );
  assert.equal(
    applyRotationDirectionForTest(90, 'counterclockwise', 0),
    -90,
    'counterclockwise should flip positive rotation delta to negative',
  );
  assert.equal(
    applyRotationDirectionForTest(-90, null, 0),
    -90,
    'manual rotation without direction should keep raw value',
  );
}

function testPivotMatrixAtClockwise90(): void {
  const matrix = pagxMotionMatrixStringFromComponents(0, 0, 90, 1, 1, 41.5, 36.5);
  assert.equal(matrix, '0,1,-1,0,78,-5');
}

function testPivotMatrixAtMinus90(): void {
  const matrix = pagxMotionMatrixStringFromComponents(0, 0, -90, 1, 1, 41.5, 36.5);
  assert.equal(matrix, '0,-1,1,0,5,78');
}

function run(): void {
  testSpringOvershoot();
  testRotationSamplingUsesSpring();
  testRotationDirectionClockwise();
  testPivotMatrixAtClockwise90();
  testPivotMatrixAtMinus90();
  testOffsetTranslationSamplesNegateKeyframe();
  testOffsetTranslationRightDirection();
  testSetTranslationSamplesKeepAbsoluteValues();
  testManualSetTranslationUsesFirstKeyframeAsMatrixOrigin();
  console.log('figma-motion tests passed');
}

run();

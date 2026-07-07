import assert from 'node:assert/strict';
import {
  applyRotationDirectionForTest,
  buildMatrixChannelForTest,
  collectFloatSamplesForTest,
  composeMotionMatrixForTest,
  readFigmaTranslationSpanForTest,
  readTransformSamplesForTest,
  resolveMatrixTransformOrderForTest,
  resolveMatrixTranslationForTest,
  resolvePagxRotationDegreesForTest,
  resolveRotationBaseForTest,
  resolveRotationDirectionFromPropsForTest,
  sampleFloatAtEasedForTest,
  shouldBakeMatrixPerFrameForTest,
  springProgressForTest,
} from '../src/export/figma-motion';
import { pagxMotionMatrixStringFromComponents } from '../src/export/figma-reader';

const LINEAR_EASING = { type: 'LINEAR' as const };

const frame4Parent = {
  width: 400,
  height: 800,
} as SceneNode;

const frame6Parent = {
  width: 800,
  height: 800,
} as SceneNode;

const slideInLeftBinding = {
  timelineDuration: 2,
  baseValue: { type: 'FLOAT' as const, value: 831 },
  tracks: [{
    keyframeOperation: 'OFFSET' as const,
    keyframes: [
      { timelinePosition: 0, value: { type: 'FLOAT' as const, value: -200 }, easing: LINEAR_EASING },
      { timelinePosition: 0.5, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
    ],
  }],
};

const frame4Rect17 = {
  x: 49,
  y: 159,
  width: 340,
  height: 304,
  constraints: { horizontal: 'MIN', vertical: 'MIN' },
} as SceneNode;

const frame6Rect21 = {
  x: 49,
  y: 159,
  width: 340,
  height: 304,
  constraints: { horizontal: 'MIN', vertical: 'MIN' },
} as SceneNode;

function testOffsetTranslationNegatesWhenCloserToParentRightEdge(): void {
  const samples = collectFloatSamplesForTest(slideInLeftBinding, {
    axis: 'x',
    node: frame4Rect17,
    parent: frame4Parent,
  });
  assert.equal(samples[0].value, 200);
  assert.equal(samples[1].value, 0);
}

function testOffsetTranslationKeepsRawWhenCloserToParentLeftEdge(): void {
  const samples = collectFloatSamplesForTest(slideInLeftBinding, {
    axis: 'x',
    node: frame6Rect21,
    parent: frame6Parent,
  });
  assert.equal(samples[0].value, -200);
  assert.equal(samples[1].value, 0);
}

function testOffsetTranslationRightDirectionNearParentRightEdge(): void {
  const binding = {
    timelineDuration: 2,
    baseValue: { type: 'FLOAT' as const, value: 596 },
    tracks: [{
      keyframeOperation: 'OFFSET' as const,
      keyframes: [
        { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 200 }, easing: LINEAR_EASING },
        { timelinePosition: 0.5, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
      ],
    }],
  };

  const samples = collectFloatSamplesForTest(binding, {
    axis: 'x',
    node: frame4Rect17,
    parent: frame4Parent,
  });
  assert.equal(samples[0].value, -200);
  assert.equal(samples[1].value, 0);
}

function testScaleSamplesKeepRawValues(): void {
  const binding = {
    timelineDuration: 2,
    baseValue: { type: 'FLOAT' as const, value: 1 },
    tracks: [{
      keyframeOperation: 'SCALE' as const,
      keyframes: [
        { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
        { timelinePosition: 0.3, value: { type: 'FLOAT' as const, value: 1 }, easing: LINEAR_EASING },
      ],
    }],
  };

  const samples = collectFloatSamplesForTest(binding);
  assert.equal(samples[0].value, 0);
  assert.equal(samples[1].value, 1);
}

function testRotationOffsetSamplesKeepRawValues(): void {
  const binding = {
    timelineDuration: 2,
    baseValue: { type: 'FLOAT' as const, value: 0 },
    tracks: [{
      keyframeOperation: 'OFFSET' as const,
      keyframes: [
        { timelinePosition: 0, value: { type: 'FLOAT' as const, value: -60 }, easing: LINEAR_EASING },
        { timelinePosition: 0.3, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
      ],
    }],
  };

  const samples = collectFloatSamplesForTest(binding);
  assert.equal(samples[0].value, -60);
  assert.equal(samples[1].value, 0);
}

function testSlideInBottomKeepsPositiveYOffset(): void {
  const binding = {
    timelineDuration: 2,
    baseValue: { type: 'FLOAT' as const, value: 1329 },
    tracks: [{
      keyframeOperation: 'OFFSET' as const,
      keyframes: [
        { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 20 }, easing: LINEAR_EASING },
        { timelinePosition: 0.3, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
      ],
    }],
  };

  const node = {
    x: 513,
    y: 1329,
    width: 857,
    height: 468,
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
  } as SceneNode;
  const parent = { width: 1947, height: 2006 } as SceneNode;

  const samples = collectFloatSamplesForTest(binding, { axis: 'y', node, parent });
  assert.equal(samples[0].value, 20);
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

  const samples = collectFloatSamplesForTest(binding, {
    axis: 'x',
    node: { constraints: { horizontal: 'MIN', vertical: 'MIN' } } as SceneNode,
    parent: null,
  });
  assert.equal(samples[0].time, 0);
  assert.equal(samples[0].value, 0);
  assert.equal(samples[1].time, 0.599);
  assert.equal(samples[1].value, 423);
}

function testManualSetTranslationUsesFirstKeyframeAsMatrixOrigin(): void {
  const node = {
    id: '225:103',
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
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

function testResolveMatrixTransformOrderFromAnimationStyles(): void {
  const node = {
    animationStyles: [
      { name: 'motion.preset_name.position', props: { type: 'slide_in' } },
      { name: 'motion.preset_name.scale', props: { type: 'scaleIn' } },
      { name: 'motion.preset_name.rotation', props: { type: 'rotateIn' } },
      { name: 'motion.preset_name.opacity', props: { type: 'fadeIn' } },
    ],
    animations: {
      TRANSLATION_Y: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 0 },
        tracks: [{
          keyframeOperation: 'OFFSET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 20 }, easing: LINEAR_EASING },
            { timelinePosition: 0.3, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
          ],
        }],
      },
      SCALE_X: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 1 },
        tracks: [{
          keyframeOperation: 'SCALE' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
            { timelinePosition: 0.3, value: { type: 'FLOAT' as const, value: 1 }, easing: LINEAR_EASING },
          ],
        }],
      },
      ROTATION: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 0 },
        tracks: [{
          keyframeOperation: 'OFFSET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: -60 }, easing: LINEAR_EASING },
            { timelinePosition: 0.3, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
          ],
        }],
      },
    },
  } as Parameters<typeof readTransformSamplesForTest>[0];

  const transformSamples = readTransformSamplesForTest(node);
  assert.deepEqual(
    resolveMatrixTransformOrderForTest(node, transformSamples),
    ['translation', 'scale', 'rotation'],
  );
}

function testComposeMatrixFollowsAnimationStyleOrder(): void {
  const ordered = composeMotionMatrixForTest(
    ['translation', 'scale', 'rotation'],
    0,
    20,
    0.5,
    0.5,
    -30,
    100,
    50,
  );
  const legacy = pagxMotionMatrixStringFromComponents(0, 20, -30, 0.5, 0.5, 100, 50) ?? '';
  assert.notEqual(ordered, legacy);
  assert.equal(composeMotionMatrixForTest(['translation'], 0, 20, 1, 1, 0, 100, 50), '1,0,0,1,0,20');
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

function testRotateInCounterClockwiseExportsPagxHandedness(): void {
  const pagxDegrees = resolvePagxRotationDegreesForTest(-60, 'counterclockwise', 0, 'rotateIn');
  assert.equal(pagxDegrees, 60, 'rotateIn CCW offset -60 should become +60 in PAGX');

  const matrix = pagxMotionMatrixStringFromComponents(0, 0, pagxDegrees, 1, 1, 428.5, 234);
  const [, b, c] = (matrix ?? '').split(',').map(Number);
  assert.ok(b > 0 && c < 0, 'PAGX matrix should tilt clockwise to match Figma rotateIn CCW preview');
}

function testRotateInClockwiseNegatesDirectedDegrees(): void {
  assert.equal(resolvePagxRotationDegreesForTest(360, 'clockwise', 0, 'rotateIn'), -360);
}

function testCustomRotationDirectionFromStartEnd(): void {
  assert.equal(
    resolveRotationDirectionFromPropsForTest({ type: 'custom', start: 0, end: 360 }),
    'clockwise',
  );
  assert.equal(
    resolveRotationDirectionFromPropsForTest({ type: 'custom', start: 360, end: 0 }),
    'counterclockwise',
  );
  assert.equal(
    resolveRotationDirectionFromPropsForTest({ type: 'custom', start: 0, end: 0 }),
    null,
  );
  assert.equal(
    resolveRotationDirectionFromPropsForTest({ type: 'rotateOut', direction: 'clockwise', start: 180, end: 0 }),
    'clockwise',
    'built-in rotateOut should still use explicit direction',
  );

  assert.equal(resolvePagxRotationDegreesForTest(-360, 'clockwise', 0, 'custom'), 360);
  assert.equal(resolvePagxRotationDegreesForTest(-60, 'counterclockwise', 0, 'custom'), 60);
}

function testRotateOutClockwiseKeepsDirectedDegrees(): void {
  assert.equal(resolvePagxRotationDegreesForTest(0, 'clockwise', 0, 'rotateOut'), 0);
  assert.equal(resolvePagxRotationDegreesForTest(-360, 'clockwise', 0, 'rotateOut'), 360);
  assert.equal(resolvePagxRotationDegreesForTest(-60, 'counterclockwise', 0, 'rotateOut'), 60);

  const matrix = pagxMotionMatrixStringFromComponents(0, 0, 90, 1, 1, 96, 86);
  const [, b, c] = (matrix ?? '').split(',').map(Number);
  assert.ok(b > 0 && c < 0, 'CW degrees should map to clockwise matrix tilt');
}

function testManualSetRotationUsesFirstKeyframeOrigin(): void {
  assert.equal(resolveRotationBaseForTest({
    timelineDuration: 2,
    baseValue: { type: 'FLOAT' as const, value: 180 },
    tracks: [{ keyframeOperation: 'SET' as const, keyframes: [] }],
  }), 0);
  assert.equal(resolvePagxRotationDegreesForTest(-180, null, 0, null, true), 180);
}

function testFrame4Rectangle20RotateInClockwiseMatrixTiltsClockwise(): void {
  const node = {
    width: 192,
    height: 172,
    animationStyles: [{
      name: 'motion.preset_name.rotation',
      props: { type: 'rotateIn', direction: 'clockwise' },
    }],
    animations: {
      ROTATION: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 180 },
        tracks: [{
          keyframeOperation: 'OFFSET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 360 }, easing: LINEAR_EASING },
            { timelinePosition: 2, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
          ],
        }],
      },
    },
  } as Parameters<typeof readTransformSamplesForTest>[0];

  const matrixChannel = buildMatrixChannelForTest(node);
  const earlyKeyframe = matrixChannel!.keyframes[12];
  const [, b] = earlyKeyframe.value.split(',').map(Number);
  assert.ok(b > 0, 'rotateIn clockwise should export clockwise matrix tilt');
}

function testFrame4Rectangle23ManualSetRotationTiltsClockwise(): void {
  const node = {
    width: 274,
    height: 218,
    animationStyles: [],
    animations: {
      ROTATION: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 180 },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
            { timelinePosition: 0.486, value: { type: 'FLOAT' as const, value: -180 }, easing: LINEAR_EASING },
            { timelinePosition: 0.487, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
          ],
        }],
      },
    },
  } as Parameters<typeof readTransformSamplesForTest>[0];

  const matrixChannel = buildMatrixChannelForTest(node);
  const peakKeyframe = matrixChannel!.keyframes[Math.floor(matrixChannel!.keyframes.length / 2)];
  const [, b] = peakKeyframe.value.split(',').map(Number);
  assert.ok(b > 0, 'manual SET rotation 0 to -180 should export clockwise matrix tilt');
}

function testRotateOutOffsetIgnoresRestingRotationBase(): void {
  const binding = {
    timelineDuration: 2,
    baseValue: { type: 'FLOAT' as const, value: 180 },
    tracks: [{
      keyframeOperation: 'OFFSET' as const,
      keyframes: [
        { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
        { timelinePosition: 2, value: { type: 'FLOAT' as const, value: -360 }, easing: LINEAR_EASING },
      ],
    }],
  };

  assert.equal(resolveRotationBaseForTest(binding), 0);
  assert.equal(resolvePagxRotationDegreesForTest(0, 'clockwise', 0, 'rotateOut'), 0);
  assert.equal(resolvePagxRotationDegreesForTest(-360, 'clockwise', 0, 'rotateOut'), 360);
}

function testRotateOutFullTurnBakesMatrixKeyframes(): void {
  const node = {
    width: 192,
    height: 172,
    animationStyles: [{
      name: 'motion.preset_name.rotation',
      props: { type: 'rotateOut', direction: 'clockwise' },
    }],
    animations: {
      ROTATION: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 180 },
        tracks: [{
          keyframeOperation: 'OFFSET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
            { timelinePosition: 2, value: { type: 'FLOAT' as const, value: -360 }, easing: LINEAR_EASING },
          ],
        }],
      },
    },
  } as Parameters<typeof readTransformSamplesForTest>[0];

  const transformSamples = readTransformSamplesForTest(node);
  assert.equal(shouldBakeMatrixPerFrameForTest(node, transformSamples), true);

  const matrixChannel = buildMatrixChannelForTest(node);
  assert.ok(matrixChannel, 'rotateOut should export matrix channel');
  assert.ok(matrixChannel!.keyframes.length > 2, 'full rotation should bake more than endpoint keys');

  const midKeyframe = matrixChannel!.keyframes[Math.floor(matrixChannel!.keyframes.length / 2)];
  assert.notEqual(midKeyframe.value, '1,0,0,1,0,0', 'mid-frame rotation should not collapse to identity');
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
  testRotateInCounterClockwiseExportsPagxHandedness();
  testRotateInClockwiseNegatesDirectedDegrees();
  testCustomRotationDirectionFromStartEnd();
  testRotateOutClockwiseKeepsDirectedDegrees();
  testManualSetRotationUsesFirstKeyframeOrigin();
  testFrame4Rectangle20RotateInClockwiseMatrixTiltsClockwise();
  testFrame4Rectangle23ManualSetRotationTiltsClockwise();
  testRotateOutOffsetIgnoresRestingRotationBase();
  testRotateOutFullTurnBakesMatrixKeyframes();
  testPivotMatrixAtClockwise90();
  testPivotMatrixAtMinus90();
  testOffsetTranslationNegatesWhenCloserToParentRightEdge();
  testOffsetTranslationKeepsRawWhenCloserToParentLeftEdge();
  testOffsetTranslationRightDirectionNearParentRightEdge();
  testScaleSamplesKeepRawValues();
  testRotationOffsetSamplesKeepRawValues();
  testSlideInBottomKeepsPositiveYOffset();
  testResolveMatrixTransformOrderFromAnimationStyles();
  testComposeMatrixFollowsAnimationStyleOrder();
  testSetTranslationSamplesKeepAbsoluteValues();
  testManualSetTranslationUsesFirstKeyframeAsMatrixOrigin();
  console.log('figma-motion tests passed');
}

run();

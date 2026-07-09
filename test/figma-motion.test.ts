import assert from 'node:assert/strict';
import {
  applyRotationDirectionForTest,
  buildMatrixChannelForTest,
  collectMotionDebugData,
  collectMotionAnimations,
  collectFloatSamplesForTest,
  composeMotionMatrixForTest,
  readFigmaTranslationSpanForTest,
  motionPivotForExport,
  refreshMotionPivotCache,
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
const EASE_OUT = { type: 'EASE_OUT' as const };

type SharedPluginDataStore = {
  value: string;
};

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

function testOffsetTranslationNegatesUnderFlippedParent(): void {
  const flippedParent = {
    type: 'FRAME',
    width: 880,
    height: 1325,
    absoluteTransform: [[-1, 0, 880], [0, -1, 1325]],
  } as SceneNode;

  const rectangle17 = {
    type: 'RECTANGLE',
    x: 49,
    y: 158,
    width: 340,
    height: 304,
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
    absoluteTransform: [[-1, 0, 831], [0, -1, 1167]],
  } as SceneNode;

  const samples = collectFloatSamplesForTest(slideInLeftBinding, {
    axis: 'x',
    node: rectangle17,
    parent: flippedParent,
  });
  assert.equal(samples[0].value, 200);
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
  assert.equal(samples[1].value, -423);
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
  assert.deepEqual(span, { x: -453, y: 76 });

  const transformSamples = readTransformSamplesForTest(node);
  assert.deepEqual(
    resolveMatrixTranslationForTest(node, transformSamples, 0),
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    resolveMatrixTranslationForTest(node, transformSamples, 0.496),
    { x: -453, y: 76 },
  );
}

function testFrame8Rectangle28ManualSetTranslationKeepsRawDirection(): void {
  const node = {
    id: '9:187',
    type: 'RECTANGLE',
    x: 279,
    y: 1345,
    width: 246,
    height: 177,
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
    animations: {
      ROTATION: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 0 },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
            { timelinePosition: 0.86, value: { type: 'FLOAT' as const, value: 180.00000500895632 }, easing: LINEAR_EASING },
          ],
        }],
      },
      TRANSLATION_XY: {
        timelineDuration: 2,
        baseValue: { type: 'VECTOR' as const, value: { x: 0, y: 0 } },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'VECTOR' as const, value: { x: 0, y: 0 } }, easing: LINEAR_EASING },
            { timelinePosition: 0.86, value: { type: 'VECTOR' as const, value: { x: 499, y: -182 } }, easing: LINEAR_EASING },
          ],
        }],
      },
    },
    animationStyles: [],
    timelines: [{ duration: 2 }],
  } as unknown as SceneNode;

  const root = {
    id: '9:183',
    type: 'FRAME',
    children: [node],
    animations: {},
    animationStyles: [],
    timelines: [{ duration: 2 }],
  } as unknown as SceneNode;

  const animations = collectMotionAnimations(
    root,
    new Map([[node.id, 'layer_9_187']]),
    new Map([[node.id, 'motion_group_9_187']]),
    [],
  );
  const motionObject = animations[0].objects.find((item) => item.target === 'motion_group_9_187');
  const positionX = motionObject?.channels.find((channel) => channel.name === 'position.x');
  const positionY = motionObject?.channels.find((channel) => channel.name === 'position.y');
  const rotation = motionObject?.channels.find((channel) => channel.name === 'rotation');

  assert(positionX, 'Rectangle28 should export position.x');
  assert(positionY, 'Rectangle28 should export position.y');
  assert(rotation, 'Rectangle28 should export rotation');
  assert.deepEqual(positionX.keyframes.map((keyframe) => keyframe.value), ['123', '622']);
  assert.deepEqual(positionY.keyframes.map((keyframe) => keyframe.value), ['88.5', '-93.5']);
  assert.deepEqual(rotation.keyframes.map((keyframe) => keyframe.value), ['0', '-180']);
}

function testFrame8Rectangle27OpacityUsesStyleTimelineOffset(): void {
  const node = {
    id: '9:186',
    type: 'RECTANGLE',
    x: 272,
    y: 848,
    width: 506,
    height: 257,
    animations: {
      OPACITY: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 1 },
        tracks: [{
          keyframeOperation: 'SCALE' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 1 }, easing: LINEAR_EASING },
            { timelinePosition: 0.41, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
          ],
        }],
      },
    },
    animationStyles: [{
      name: 'motion.preset_name.opacity',
      timelineOffset: 1.09,
      props: { type: 'fadeOut' },
    }],
    timelines: [{ duration: 2 }],
  } as unknown as SceneNode;

  const root = {
    id: '9:183',
    type: 'FRAME',
    children: [node],
    animations: {},
    animationStyles: [],
    timelines: [{ duration: 2 }],
  } as unknown as SceneNode;

  const animations = collectMotionAnimations(
    root,
    new Map([[node.id, 'layer_9_186']]),
    new Map(),
    [],
  );
  const alphaObject = animations[0].objects.find((item) => item.target === 'layer_9_186');
  const alpha = alphaObject?.channels.find((channel) => channel.name === 'alpha');

  assert(alpha, 'Rectangle27 should export alpha');
  assert.deepEqual(alpha.keyframes.map((keyframe) => keyframe.time), [65, 90]);
  assert.deepEqual(alpha.keyframes.map((keyframe) => keyframe.value), ['1', '0']);
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

  const diagnostics: Parameters<typeof readTransformSamplesForTest>[2] = [];
  const transformSamples = readTransformSamplesForTest(node, null, diagnostics);
  assert.deepEqual(diagnostics, [], 'SCALE keyframe operation should not warn');
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
  assert.ok(matrixChannel!.keyframes.length > 3, 'rotation matrix should be baked to preserve center pivot');
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
  assert.ok(matrixChannel!.keyframes.length > 5, 'full rotation should bake enough frames to preserve center pivot');

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

function testGroupChildSlideInLeftKeepsRawOffset(): void {
  const groupParent = {
    type: 'GROUP',
    width: 649,
    height: 1034,
    absoluteTransform: [[1, 0, 136], [0, 1, 1534]],
    absoluteBoundingBox: { x: 136, y: 1534, width: 649, height: 1034 },
  } as SceneNode;

  const rect7 = {
    type: 'RECTANGLE',
    x: 342,
    y: 1777,
    width: 401,
    height: 521,
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
    absoluteTransform: [[1, 0, 342], [0, 1, 1777]],
    absoluteBoundingBox: { x: 342, y: 1777, width: 401, height: 521 },
  } as SceneNode;

  const samples = collectFloatSamplesForTest(slideInLeftBinding, {
    axis: 'x',
    node: rect7,
    parent: groupParent,
  });
  assert.equal(samples[0].value, -200);
  assert.equal(samples[1].value, 0);
}

function testMotionGroupSizeAnimationKeepsEasing(): void {
  const rectangle = {
    id: '1:24',
    type: 'RECTANGLE',
    x: 20,
    y: 30,
    width: 100,
    height: 80,
    animations: {
      ROTATION: {
        timelineDuration: 1,
        baseValue: { type: 'FLOAT' as const, value: 0 },
        tracks: [{
          keyframeOperation: 'OFFSET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
            { timelinePosition: 1, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
          ],
        }],
      },
      WIDTH: {
        timelineDuration: 1,
        baseValue: { type: 'FLOAT' as const, value: 100 },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 100 }, easing: EASE_OUT },
            { timelinePosition: 1, value: { type: 'FLOAT' as const, value: 200 }, easing: LINEAR_EASING },
          ],
        }],
      },
    },
    animationStyles: [],
    timelines: [],
  } as unknown as SceneNode;

  const root = {
    id: '1:75',
    type: 'FRAME',
    animations: {},
    animationStyles: [],
    timelines: [{ duration: 1 }],
    children: [rectangle],
  } as unknown as SceneNode;

  const animations = collectMotionAnimations(
    root,
    new Map([[rectangle.id, 'layer_1_24']]),
    new Map([[rectangle.id, 'motion_group_1_24']]),
    [],
  );
  const motionObject = animations[0].objects.find((item) => item.target === 'motion_group_1_24');
  const scaleX = motionObject?.channels.find((channel) => channel.name === 'scale.x');

  assert(scaleX, 'motion group should export width animation as scale.x');
  assert.equal(scaleX.keyframes[0].interpolation, 'bezier');
  assert.equal(scaleX.keyframes[0].bezierOut, '0,0');
  assert.equal(scaleX.keyframes[0].bezierIn, '0.58,1');
}

function testSizeOnlyMatrixAnimationKeepsEasing(): void {
  const node = {
    id: '8:6',
    type: 'RECTANGLE',
    x: 1130,
    y: 192,
    width: 390,
    height: 355,
    animations: {
      WIDTH: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 240 },
        tracks: [{
          keyframeOperation: 'OFFSET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: EASE_OUT },
            { timelinePosition: 0.5, value: { type: 'FLOAT' as const, value: 150 }, easing: EASE_OUT },
          ],
        }],
      },
      HEIGHT: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 205 },
        tracks: [{
          keyframeOperation: 'OFFSET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: EASE_OUT },
            { timelinePosition: 0.5, value: { type: 'FLOAT' as const, value: 150 }, easing: EASE_OUT },
          ],
        }],
      },
    },
    animationStyles: [{
      name: 'motion.preset_name.size',
      props: { type: 'resize_out' },
    }],
    timelines: [{ duration: 2 }],
  } as Parameters<typeof buildMatrixChannelForTest>[0];

  const matrixChannel = buildMatrixChannelForTest(node);

  assert(matrixChannel, 'size-only animation should export matrix channel');
  assert.equal(matrixChannel.keyframes[0].value, '1,0,0,1,0,0');
  assert.equal(matrixChannel.keyframes[1].value, '1.63,0,0,1.73,0,0');
  assert.equal(matrixChannel.keyframes[0].interpolation, 'bezier');
  assert.equal(matrixChannel.keyframes[0].bezierOut, '0,0');
  assert.equal(matrixChannel.keyframes[0].bezierIn, '0.58,1');
}

function testMotionDebugDataIncludesTransformDetails(): void {
  const node = {
    id: '15:22',
    name: 'Rectangle 31',
    type: 'RECTANGLE',
    x: 160,
    y: 782,
    width: 287,
    height: 220,
    rotation: 0,
    relativeTransform: [[1, 0, 160], [0, 1, 782]],
    absoluteTransform: [[1, 0, 1017], [0, 1, 3036]],
    absoluteBoundingBox: { x: 1017, y: 3036, width: 287, height: 220 },
    absoluteRenderBounds: { x: 1017, y: 3036, width: 287, height: 220 },
    animations: {
      ROTATION: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 0 },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
            { timelinePosition: 0.499, value: { type: 'FLOAT' as const, value: 180 }, easing: LINEAR_EASING },
          ],
        }],
      },
    },
    animationStyles: [],
    timelines: [{ duration: 2 }],
  } as unknown as SceneNode;

  const [debugEntry] = collectMotionDebugData(node) as Array<{
    transform?: {
      rotation?: number;
      relativeTransform?: Transform;
      absoluteTransform?: Transform;
      absoluteBoundingBox?: Rect;
      absoluteRenderBounds?: Rect;
      anchorProbe?: Record<string, string>;
    };
  }>;

  assert.deepEqual(debugEntry.transform?.relativeTransform, [[1, 0, 160], [0, 1, 782]]);
  assert.deepEqual(debugEntry.transform?.absoluteTransform, [[1, 0, 1017], [0, 1, 3036]]);
  assert.deepEqual(debugEntry.transform?.absoluteBoundingBox, { x: 1017, y: 3036, width: 287, height: 220 });
  assert.deepEqual(debugEntry.transform?.absoluteRenderBounds, { x: 1017, y: 3036, width: 287, height: 220 });
  assert.equal(debugEntry.transform?.rotation, 0);
  assert.equal(debugEntry.transform?.anchorProbe?.anchorPoint, 'missing');
}

function rectangle32ScaleNode(
  renderBounds: Rect,
  sharedPluginDataStore: SharedPluginDataStore = { value: '' },
): SceneNode {
  return {
    id: '17:92',
    name: 'Rectangle 32',
    type: 'RECTANGLE',
    x: 424,
    y: 1050,
    width: 177,
    height: 155,
    absoluteBoundingBox: { x: 1281, y: 3304, width: 177, height: 155 },
    absoluteRenderBounds: renderBounds,
    getSharedPluginData(namespace: string, key: string): string {
      return namespace === 'pagx' && key === 'anchor' ? sharedPluginDataStore.value : '';
    },
    setSharedPluginData(namespace: string, key: string, value: string): void {
      if (namespace === 'pagx' && key === 'anchor') {
        sharedPluginDataStore.value = value;
      }
    },
    animations: {
      SCALE_XY: {
        timelineDuration: 2,
        baseValue: { type: 'VECTOR' as const, value: { x: 1, y: 1 } },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'VECTOR' as const, value: { x: 1, y: 1 } }, easing: LINEAR_EASING },
            {
              timelinePosition: 0.496,
              value: { type: 'VECTOR' as const, value: { x: 2.960423469543457, y: 2.960423469543457 } },
              easing: LINEAR_EASING,
            },
          ],
        }],
      },
    },
    animationStyles: [],
    timelines: [{ duration: 2 }],
  } as unknown as SceneNode;
}

function testScalePivotInfersAndCachesAnchorFromRenderBounds(): void {
  const store = { value: '' };
  const node = rectangle32ScaleNode({
    x: 1220.043701171875,
    y: 3277.31005859375,
    width: 237.956298828125,
    height: 205.68994140625,
  }, store);

  assert.deepEqual(motionPivotForExport(node, 177, 155), {
    x: 177,
    y: 77.5,
    source: 'inferred-render-bounds',
  });
  assert.equal(store.value, '177,77.5');
}

function testScalePivotUsesCachedAnchorAtTimelineStart(): void {
  const node = rectangle32ScaleNode({
    x: 1280.992431640625,
    y: 3303.99658203125,
    width: 177.007568359375,
    height: 155.006591796875,
  }, { value: '177,77.5' });

  assert.deepEqual(motionPivotForExport(node, 177, 155), {
    x: 177,
    y: 77.5,
    source: 'cached',
  });
}

function testScalePivotRefreshesStaleCacheFromRenderBounds(): void {
  const store = { value: '177,130.39' };
  const node = rectangle32ScaleNode({
    x: 1220.043701171875,
    y: 3277.31005859375,
    width: 237.956298828125,
    height: 205.68994140625,
  }, store);

  assert.deepEqual(motionPivotForExport(node, 177, 155), {
    x: 177,
    y: 77.5,
    source: 'inferred-render-bounds',
  });
  assert.equal(store.value, '177,77.5');
}

function testRefreshMotionPivotCacheUsesCurrentRenderBounds(): void {
  const store = { value: '177,130.39' };
  const node = rectangle32ScaleNode({
    x: 1220.043701171875,
    y: 3277.31005859375,
    width: 237.956298828125,
    height: 205.68994140625,
  }, store);

  assert.deepEqual(refreshMotionPivotCache(node), {
    x: 177,
    y: 77.5,
    source: 'inferred-render-bounds',
  });
  assert.equal(store.value, '177,77.5');
}

function testRefreshMotionPivotCacheAllowsSmallTimelineNudge(): void {
  const store = { value: '' };
  const node = rectangle32ScaleNode({
    x: 1279.23,
    y: 3303.225,
    width: 178.77,
    height: 156.55,
  }, store);

  assert.deepEqual(refreshMotionPivotCache(node), {
    x: 177,
    y: 77.5,
    source: 'inferred-render-bounds',
  });
  assert.equal(store.value, '177,77.5');
}

function testRefreshMotionPivotCacheHandlesTopLeftRotation(): void {
  const store = { value: '' };
  const node = {
    id: '15:22',
    name: 'Rectangle 31',
    type: 'RECTANGLE',
    width: 287,
    height: 220,
    getSharedPluginData(namespace: string, key: string): string {
      return namespace === 'pagx' && key === 'anchor' ? store.value : '';
    },
    setSharedPluginData(namespace: string, key: string, value: string): void {
      if (namespace === 'pagx' && key === 'anchor') {
        store.value = value;
      }
    },
    animations: {
      ROTATION: {
        timelineDuration: 2,
        baseValue: { type: 'FLOAT' as const, value: 0 },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 0 }, easing: LINEAR_EASING },
            { timelinePosition: 0.499, value: { type: 'FLOAT' as const, value: 180.00000500895632 }, easing: LINEAR_EASING },
          ],
        }],
      },
    },
    animationStyles: [],
    timelines: [{ duration: 2 }],
  } as unknown as SceneNode;

  assert.deepEqual(refreshMotionPivotCache(node), {
    x: 0,
    y: 0,
    source: 'rotation-top-left',
  });
  assert.equal(store.value, '0,0');
}

function testMotionDebugDataIncludesPivotSourceAndCachesAnchor(): void {
  const store = { value: '' };
  const node = rectangle32ScaleNode({
    x: 1220.043701171875,
    y: 3277.31005859375,
    width: 237.956298828125,
    height: 205.68994140625,
  }, store);

  const [debugEntry] = collectMotionDebugData(node) as Array<{
    transform?: {
      motionPivot?: {
        x: number;
        y: number;
        source: string;
      };
    };
  }>;

  assert.deepEqual(debugEntry.transform?.motionPivot, {
    x: 177,
    y: 77.5,
    source: 'inferred-render-bounds',
  });
  assert.equal(store.value, '177,77.5');
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
  testOffsetTranslationNegatesUnderFlippedParent();
  testOffsetTranslationRightDirectionNearParentRightEdge();
  testGroupChildSlideInLeftKeepsRawOffset();
  testScaleSamplesKeepRawValues();
  testRotationOffsetSamplesKeepRawValues();
  testSlideInBottomKeepsPositiveYOffset();
  testResolveMatrixTransformOrderFromAnimationStyles();
  testComposeMatrixFollowsAnimationStyleOrder();
  testSetTranslationSamplesKeepAbsoluteValues();
  testManualSetTranslationUsesFirstKeyframeAsMatrixOrigin();
  testFrame8Rectangle28ManualSetTranslationKeepsRawDirection();
  testFrame8Rectangle27OpacityUsesStyleTimelineOffset();
  testMotionGroupSizeAnimationKeepsEasing();
  testSizeOnlyMatrixAnimationKeepsEasing();
  testMotionDebugDataIncludesTransformDetails();
  testScalePivotInfersAndCachesAnchorFromRenderBounds();
  testScalePivotUsesCachedAnchorAtTimelineStart();
  testScalePivotRefreshesStaleCacheFromRenderBounds();
  testRefreshMotionPivotCacheUsesCurrentRenderBounds();
  testRefreshMotionPivotCacheAllowsSmallTimelineNudge();
  testRefreshMotionPivotCacheHandlesTopLeftRotation();
  testMotionDebugDataIncludesPivotSourceAndCachesAnchor();
  console.log('figma-motion tests passed');
}

run();

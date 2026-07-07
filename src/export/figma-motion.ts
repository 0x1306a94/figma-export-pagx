import type {
  Diagnostic,
  PagxAnimation,
  PagxAnimationObject,
  PagxChannel,
  PagxKeyframe,
} from './types';
import { roundDimension } from './color';
import { addDiagnostic, pagxMotionMatrixStringFromComponents } from './figma-reader';

export const MOTION_FRAME_RATE = 60;
const MOTION_ANIMATION_ID = 'motion-main';

type MotionCapableNode = SceneNode & {
  animations: Animations;
  animationStyles: ReadonlyArray<AppliedAnimationStyle>;
  timelines: ReadonlyArray<Timeline>;
};

type RotationDirection = 'clockwise' | 'counterclockwise';

function normalizeRotationDirection(value: unknown): RotationDirection | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'clockwise' || normalized === 'cw') {
    return 'clockwise';
  }
  if (normalized === 'counterclockwise' || normalized === 'counter-clockwise' || normalized === 'ccw') {
    return 'counterclockwise';
  }

  return null;
}

function readDirectionFromRecord(record: Record<string, unknown> | undefined): RotationDirection | null {
  if (!record) {
    return null;
  }

  return normalizeRotationDirection(record.direction);
}

function resolveRotationDirection(node: MotionCapableNode): RotationDirection | null {
  for (const style of node.animationStyles ?? []) {
    const direction = readDirectionFromRecord(style.props as Record<string, unknown> | undefined);
    if (direction) {
      return direction;
    }
  }

  const rotationBinding = node.animations.ROTATION as KeyframeBinding & { direction?: unknown };
  if (rotationBinding) {
    const direction = normalizeRotationDirection(rotationBinding.direction);
    if (direction) {
      return direction;
    }
  }

  return null;
}

function applyRotationDirection(
  degrees: number,
  direction: RotationDirection | null,
  baseDegrees: number,
): number {
  if (!direction) {
    return degrees;
  }

  const delta = degrees - baseDegrees;
  if (Math.abs(delta) < 1e-6) {
    return degrees;
  }

  const signedDelta = direction === 'clockwise'
    ? Math.abs(delta)
    : -Math.abs(delta);
  return baseDegrees + signedDelta;
}

const TRANSFORM_FIELDS = [
  'TRANSLATION_X',
  'TRANSLATION_Y',
  'TRANSLATION_XY',
  'ROTATION',
  'SCALE_X',
  'SCALE_Y',
  'SCALE_XY',
] as const;

const SIZE_FIELDS = ['WIDTH', 'HEIGHT'] as const;

type TransformField = typeof TRANSFORM_FIELDS[number];
type SizeField = typeof SIZE_FIELDS[number];

type FloatSample = {
  time: number;
  value: number;
  easing: MotionEasing | VariableAlias;
};

const LINEAR_EASING: MotionEasing = { type: 'LINEAR' };

function defaultRotationSamples(): FloatSample[] {
  return [{ time: 0, value: 0, easing: LINEAR_EASING }];
}

function defaultScaleSamples(value: number): FloatSample[] {
  return [{ time: 0, value, easing: LINEAR_EASING }];
}

type VectorSample = {
  time: number;
  x: number;
  y: number;
  easing: MotionEasing | VariableAlias;
};

function isMotionNode(node: SceneNode): node is MotionCapableNode {
  return 'animations' in node;
}

export { isMotionNode };

function getSizeBinding(animations: Animations, field: SizeField): KeyframeBinding | undefined {
  const binding = animations[field as keyof Animations];
  return isKeyframeBinding(binding) ? binding : undefined;
}

export function motionLayoutSizeForExport(node: SceneNode): { width?: number; height?: number } | undefined {
  if (!isMotionNode(node)) {
    return undefined;
  }

  const widthBinding = getSizeBinding(node.animations, 'WIDTH');
  const heightBinding = getSizeBinding(node.animations, 'HEIGHT');
  if (!widthBinding && !heightBinding) {
    return undefined;
  }

  const size: { width?: number; height?: number } = {};
  if (widthBinding?.baseValue.type === 'FLOAT') {
    size.width = roundDimension(widthBinding.baseValue.value);
  }
  if (heightBinding?.baseValue.type === 'FLOAT') {
    size.height = roundDimension(heightBinding.baseValue.value);
  }

  if (size.width === undefined && size.height === undefined) {
    return undefined;
  }
  return size;
}

function hasMotionData(node: MotionCapableNode): boolean {
  const animations = node.animations;
  if (animations.OPACITY) {
    return true;
  }
  for (const field of TRANSFORM_FIELDS) {
    if (animations[field]) {
      return true;
    }
  }
  for (const field of SIZE_FIELDS) {
    if (getSizeBinding(animations, field)) {
      return true;
    }
  }
  return false;
}

function walkSubtree(node: SceneNode, out: MotionCapableNode[]): void {
  if (isMotionNode(node) && hasMotionData(node)) {
    out.push(node);
  }
  if ('children' in node) {
    for (const child of node.children) {
      walkSubtree(child, out);
    }
  }
}

function serializeMotionKeyframeValue(value: KeyframeValue): unknown {
  switch (value.type) {
    case 'FLOAT':
      return { type: value.type, value: value.value };
    case 'VECTOR':
      return { type: value.type, value: { x: value.value.x, y: value.value.y } };
    case 'COLOR':
      return { type: value.type, value: value.value };
    default:
      return value;
  }
}

function isKeyframeBinding(value: unknown): value is KeyframeBinding {
  return typeof value === 'object'
    && value !== null
    && 'baseValue' in value
    && 'timelineDuration' in value
    && 'tracks' in value;
}

function serializeKeyframeBinding(binding: KeyframeBinding): unknown {
  return {
    timelineDuration: binding.timelineDuration,
    baseValue: serializeMotionKeyframeValue(binding.baseValue),
    tracks: binding.tracks.map((track) => ({
      keyframeOperation: track.keyframeOperation,
      keyframes: track.keyframes.map((keyframe) => ({
        timelinePosition: keyframe.timelinePosition,
        value: serializeMotionKeyframeValue(keyframe.value),
        easing: keyframe.easing,
      })),
    })),
  };
}

function serializeAnimationsObject(animations: Animations): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};
  for (const field of Object.keys(animations)) {
    const binding = animations[field as keyof Animations];
    if (!binding) {
      continue;
    }
    serialized[field] = isKeyframeBinding(binding)
      ? serializeKeyframeBinding(binding)
      : binding;
  }
  return serialized;
}

function logMotionDebugData(root: SceneNode): void {
  const entries: unknown[] = [];

  function walk(node: SceneNode): void {
    if (isMotionNode(node)) {
      const animationKeys = Object.keys(node.animations).filter(
        (field) => node.animations[field as keyof Animations],
      );
      entries.push({
        id: node.id,
        name: node.name,
        type: node.type,
        hasMotionData: hasMotionData(node),
        animationKeys,
        animationStyles: (node.animationStyles ?? []).map((style) => ({
          id: style.id,
          styleId: style.styleId,
          name: style.name,
          duration: style.duration,
          timelineOffset: style.timelineOffset,
          props: style.props,
        })),
        animations: serializeAnimationsObject(node.animations),
        timelines: node.timelines.map((timeline) => ({
          duration: timeline.duration,
        })),
      });
    }
    if ('children' in node) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  console.log('[figma-export-pagx] motion debug data:', JSON.stringify(entries, null, 2));
}

function secondsToFrame(seconds: number): number {
  return Math.max(0, Math.round(seconds * MOTION_FRAME_RATE));
}

function isVariableAlias(value: MotionEasing | VariableAlias): value is VariableAlias {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS';
}

function mapEasing(
  easing: MotionEasing | VariableAlias,
  diagnostics: Diagnostic[],
  nodeId: string,
): Pick<PagxKeyframe, 'interpolation' | 'bezierOut' | 'bezierIn'> {
  if (isVariableAlias(easing)) {
    addDiagnostic(diagnostics, 'warning', 'MOTION_VARIABLE_EASING', '变量 easing 暂按 linear 导出', nodeId);
    return {};
  }

  switch (easing.type) {
    case 'HOLD':
      return { interpolation: 'hold' };
    case 'CUSTOM_CUBIC_BEZIER': {
      const bezier = easing.easingFunctionCubicBezier;
      if (!bezier) {
        return { interpolation: 'bezier' };
      }
      return {
        interpolation: 'bezier',
        bezierOut: `${bezier.x1},${bezier.y1}`,
        bezierIn: `${bezier.x2},${bezier.y2}`,
      };
    }
    case 'CUSTOM_SPRING':
      addDiagnostic(diagnostics, 'warning', 'MOTION_SPRING_EASING', '弹簧 easing 暂按 linear 导出', nodeId);
      return {};
    case 'EASE_IN':
      return { interpolation: 'bezier', bezierOut: '0.42,0', bezierIn: '1,1' };
    case 'EASE_OUT':
      return { interpolation: 'bezier', bezierOut: '0,0', bezierIn: '0.58,1' };
    case 'EASE_IN_AND_OUT':
      return { interpolation: 'bezier', bezierOut: '0.42,0', bezierIn: '0.58,1' };
    case 'EASE_IN_BACK':
      return { interpolation: 'bezier', bezierOut: '0.36,0', bezierIn: '0.66,-0.56' };
    case 'EASE_OUT_BACK':
      return { interpolation: 'bezier', bezierOut: '0.34,1.56', bezierIn: '0.64,1' };
    case 'EASE_IN_AND_OUT_BACK':
      return { interpolation: 'bezier', bezierOut: '0.68,-0.6', bezierIn: '0.32,1.6' };
    case 'GENTLE':
      return { interpolation: 'bezier', bezierOut: '0.4,0', bezierIn: '0.2,1' };
    case 'QUICK':
      return { interpolation: 'bezier', bezierOut: '0.4,0', bezierIn: '1,1' };
    case 'BOUNCY':
      return { interpolation: 'bezier', bezierOut: '0.34,1.56', bezierIn: '0.64,1' };
    case 'SLOW':
      return { interpolation: 'bezier', bezierOut: '0,0', bezierIn: '0.2,1' };
    case 'LINEAR':
    default:
      return {};
  }
}

function collectSetTrackWarnings(
  binding: KeyframeBinding,
  diagnostics: Diagnostic[],
  nodeId: string,
  fieldName: string,
): void {
  for (const track of binding.tracks) {
    if (track.keyframeOperation !== 'SET') {
      addDiagnostic(
        diagnostics,
        'warning',
        'MOTION_UNSUPPORTED_KEYFRAME_OP',
        `${fieldName} 的 ${track.keyframeOperation} 轨道暂按 SET 处理`,
        nodeId,
      );
    }
  }
}

function collectFloatSamples(binding: KeyframeBinding): FloatSample[] {
  const base = binding.baseValue.type === 'FLOAT' ? binding.baseValue.value : 0;
  const samples: FloatSample[] = [{ time: 0, value: base, easing: LINEAR_EASING }];

  for (const track of binding.tracks) {
    for (const keyframe of track.keyframes) {
      if (keyframe.value.type !== 'FLOAT') {
        continue;
      }
      samples.push({
        time: keyframe.timelinePosition,
        value: keyframe.value.value,
        easing: keyframe.easing,
      });
    }
  }

  samples.sort((left, right) => left.time - right.time);
  const deduped: FloatSample[] = [];
  for (const sample of samples) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.time - sample.time) < 1e-6) {
      deduped[deduped.length - 1] = sample;
    } else {
      deduped.push(sample);
    }
  }
  return deduped;
}

function collectVectorSamples(binding: KeyframeBinding): VectorSample[] {
  const baseX = binding.baseValue.type === 'VECTOR' ? binding.baseValue.value.x : 0;
  const baseY = binding.baseValue.type === 'VECTOR' ? binding.baseValue.value.y : 0;
  const samples: VectorSample[] = [{ time: 0, x: baseX, y: baseY, easing: LINEAR_EASING }];

  for (const track of binding.tracks) {
    for (const keyframe of track.keyframes) {
      if (keyframe.value.type !== 'VECTOR') {
        continue;
      }
      samples.push({
        time: keyframe.timelinePosition,
        x: keyframe.value.value.x,
        y: keyframe.value.value.y,
        easing: keyframe.easing,
      });
    }
  }

  samples.sort((left, right) => left.time - right.time);
  const deduped: VectorSample[] = [];
  for (const sample of samples) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.time - sample.time) < 1e-6) {
      deduped[deduped.length - 1] = sample;
    } else {
      deduped.push(sample);
    }
  }
  return deduped;
}

function sampleFloatAt(samples: FloatSample[], time: number): number {
  if (samples.length === 0) {
    return 0;
  }
  if (time <= samples[0].time) {
    return samples[0].value;
  }
  const last = samples[samples.length - 1];
  if (time >= last.time) {
    return last.value;
  }

  for (let index = 1; index < samples.length; index += 1) {
    const next = samples[index];
    const prev = samples[index - 1];
    if (time > next.time) {
      continue;
    }
    const span = next.time - prev.time;
    if (span <= 0) {
      return prev.value;
    }
    const progress = (time - prev.time) / span;
    return prev.value + (next.value - prev.value) * progress;
  }

  return last.value;
}

function cubicBezierComponent(progress: number, control1: number, control2: number): number {
  const inverse = 1 - progress;
  return 3 * inverse * inverse * progress * control1
    + 3 * inverse * progress * progress * control2
    + progress * progress * progress;
}

function cubicBezierProgress(
  progress: number,
  controlX1: number,
  controlY1: number,
  controlX2: number,
  controlY2: number,
): number {
  if (progress <= 0) {
    return 0;
  }
  if (progress >= 1) {
    return 1;
  }

  let lower = 0;
  let upper = 1;
  for (let index = 0; index < 20; index += 1) {
    const midpoint = (lower + upper) / 2;
    const x = cubicBezierComponent(midpoint, controlX1, controlX2);
    if (x < progress) {
      lower = midpoint;
    } else {
      upper = midpoint;
    }
  }

  const parameter = (lower + upper) / 2;
  return cubicBezierComponent(parameter, controlY1, controlY2);
}

function springProgress(progress: number, bounce: number): number {
  if (progress <= 0) {
    return 0;
  }
  if (progress >= 1) {
    return 1;
  }

  const omega = 2 * Math.PI * (0.85 + bounce * 0.9);
  const dampingRatio = Math.max(0.12, 0.55 - bounce * 0.35);
  const dampedFrequency = omega * Math.sqrt(Math.max(0.01, 1 - dampingRatio * dampingRatio));
  const decay = Math.exp(-dampingRatio * omega * progress);
  return 1 - decay * (
    Math.cos(dampedFrequency * progress)
    + (dampingRatio * omega / dampedFrequency) * Math.sin(dampedFrequency * progress)
  );
}

function resolveSegmentEasedProgress(
  progress: number,
  easing: MotionEasing | VariableAlias,
): number {
  if (isVariableAlias(easing)) {
    return progress;
  }

  switch (easing.type) {
    case 'CUSTOM_SPRING': {
      const bounce = easing.easingFunctionSpring?.bounce ?? 0.5;
      return springProgress(progress, bounce);
    }
    case 'CUSTOM_CUBIC_BEZIER': {
      const bezier = easing.easingFunctionCubicBezier;
      if (!bezier) {
        return progress;
      }
      return cubicBezierProgress(progress, bezier.x1, bezier.y1, bezier.x2, bezier.y2);
    }
    case 'EASE_IN':
      return cubicBezierProgress(progress, 0.42, 0, 1, 1);
    case 'EASE_OUT':
      return cubicBezierProgress(progress, 0, 0, 0.58, 1);
    case 'EASE_IN_AND_OUT':
      return cubicBezierProgress(progress, 0.42, 0, 0.58, 1);
    case 'EASE_IN_BACK':
      return cubicBezierProgress(progress, 0.36, 0, 0.66, -0.56);
    case 'EASE_OUT_BACK':
      return cubicBezierProgress(progress, 0.34, 1.56, 0.64, 1);
    case 'EASE_IN_AND_OUT_BACK':
      return cubicBezierProgress(progress, 0.68, -0.6, 0.32, 1.6);
    case 'GENTLE':
      return cubicBezierProgress(progress, 0.4, 0, 0.2, 1);
    case 'QUICK':
      return cubicBezierProgress(progress, 0.4, 0, 1, 1);
    case 'BOUNCY':
      return cubicBezierProgress(progress, 0.34, 1.56, 0.64, 1);
    case 'SLOW':
      return cubicBezierProgress(progress, 0, 0, 0.2, 1);
    case 'HOLD':
      return 0;
    case 'LINEAR':
    default:
      return progress;
  }
}

function sampleFloatAtEased(samples: FloatSample[], time: number): number {
  if (samples.length === 0) {
    return 0;
  }
  if (time <= samples[0].time) {
    return samples[0].value;
  }
  const last = samples[samples.length - 1];
  if (time >= last.time) {
    return last.value;
  }

  for (let index = 1; index < samples.length; index += 1) {
    const next = samples[index];
    const prev = samples[index - 1];
    if (time > next.time) {
      continue;
    }
    const span = next.time - prev.time;
    if (span <= 0) {
      return prev.value;
    }
    const progress = (time - prev.time) / span;
    const easedProgress = resolveSegmentEasedProgress(progress, prev.easing);
    return prev.value + (next.value - prev.value) * easedProgress;
  }

  return last.value;
}

function sampleVectorAt(samples: VectorSample[], time: number): { x: number; y: number } {
  return {
    x: sampleFloatAt(samples.map((sample) => ({ ...sample, value: sample.x })), time),
    y: sampleFloatAt(samples.map((sample) => ({ ...sample, value: sample.y })), time),
  };
}

function collectSampleTimes(samples: Array<{ time: number }>): number[] {
  const times = new Set<number>();
  for (const sample of samples) {
    times.add(sample.time);
  }
  return [...times].sort((left, right) => left - right);
}

function mergeSampleTimes(timeLists: number[][]): number[] {
  const merged = new Set<number>();
  for (const times of timeLists) {
    for (const time of times) {
      merged.add(time);
    }
  }
  return [...merged].sort((left, right) => left - right);
}

function isAnimatedFloat(samples: FloatSample[]): boolean {
  if (samples.length <= 1) {
    return false;
  }
  const first = samples[0].value;
  return samples.some((sample) => Math.abs(sample.value - first) > 1e-4);
}

function isAnimatedVector(samples: VectorSample[]): boolean {
  if (samples.length <= 1) {
    return false;
  }
  const first = samples[0];
  return samples.some(
    (sample) => Math.abs(sample.x - first.x) > 1e-4 || Math.abs(sample.y - first.y) > 1e-4,
  );
}

function buildFloatChannel(
  binding: KeyframeBinding,
  nodeId: string,
  fieldName: string,
  channelName: string,
  diagnostics: Diagnostic[],
): PagxChannel | null {
  collectSetTrackWarnings(binding, diagnostics, nodeId, fieldName);
  const samples = collectFloatSamples(binding);
  if (!isAnimatedFloat(samples)) {
    return null;
  }

  const keyframes: PagxKeyframe[] = samples.map((sample, index) => {
    const frame = secondsToFrame(sample.time);
    const keyframe: PagxKeyframe = {
      time: frame,
      value: String(roundDimension(sample.value)),
    };
    if (index < samples.length - 1) {
      Object.assign(keyframe, mapEasing(sample.easing, diagnostics, nodeId));
    }
    return keyframe;
  });

  return { name: channelName, type: 'float', keyframes };
}

function buildAlphaChannel(
  node: MotionCapableNode,
  diagnostics: Diagnostic[],
): PagxChannel | null {
  const binding = node.animations.OPACITY;
  if (!binding) {
    return null;
  }
  return buildFloatChannel(binding, node.id, 'OPACITY', 'alpha', diagnostics);
}

function readSizeSamples(node: MotionCapableNode, diagnostics: Diagnostic[]): {
  width: FloatSample[];
  height: FloatSample[];
  baseWidth: number;
  baseHeight: number;
  sampleTimes: number[];
} {
  const widthBinding = getSizeBinding(node.animations, 'WIDTH');
  const heightBinding = getSizeBinding(node.animations, 'HEIGHT');

  if (widthBinding) {
    collectSetTrackWarnings(widthBinding, diagnostics, node.id, 'WIDTH');
  }
  if (heightBinding) {
    collectSetTrackWarnings(heightBinding, diagnostics, node.id, 'HEIGHT');
  }

  const width = widthBinding ? collectFloatSamples(widthBinding) : [];
  const height = heightBinding ? collectFloatSamples(heightBinding) : [];
  const baseWidth = widthBinding?.baseValue.type === 'FLOAT'
    ? widthBinding.baseValue.value
    : (width[0]?.value ?? ('width' in node ? node.width : 1));
  const baseHeight = heightBinding?.baseValue.type === 'FLOAT'
    ? heightBinding.baseValue.value
    : (height[0]?.value ?? ('height' in node ? node.height : 1));

  return {
    width,
    height,
    baseWidth,
    baseHeight,
    sampleTimes: mergeSampleTimes([
      collectSampleTimes(width),
      collectSampleTimes(height),
    ]),
  };
}

function hasSizeAnimation(samples: ReturnType<typeof readSizeSamples>): boolean {
  const widthAnimated = samples.width.length > 0
    && samples.baseWidth > 0
    && isAnimatedFloat(samples.width);
  const heightAnimated = samples.height.length > 0
    && samples.baseHeight > 0
    && isAnimatedFloat(samples.height);
  return widthAnimated || heightAnimated;
}

function resolveScaleFromSizeSamples(
  samples: ReturnType<typeof readSizeSamples>,
  time: number,
): { scaleX: number; scaleY: number } {
  let scaleX = 1;
  let scaleY = 1;

  if (samples.width.length > 0 && samples.baseWidth > 0) {
    const width = sampleFloatAt(samples.width, time);
    scaleX = width / samples.baseWidth;
  }
  if (samples.height.length > 0 && samples.baseHeight > 0) {
    const height = sampleFloatAt(samples.height, time);
    scaleY = height / samples.baseHeight;
  }

  return { scaleX, scaleY };
}

function resolveRotationPivot(
  node: MotionCapableNode,
  sizeSamples: ReturnType<typeof readSizeSamples>,
  time: number,
  scaleX: number,
  scaleY: number,
): { x: number; y: number } {
  const motionSize = motionLayoutSizeForExport(node);
  let width = motionSize?.width ?? sizeSamples.baseWidth;
  let height = motionSize?.height ?? sizeSamples.baseHeight;

  if (motionSize?.width === undefined && 'width' in node && typeof node.width === 'number') {
    width = node.width;
  }
  if (motionSize?.height === undefined && 'height' in node && typeof node.height === 'number') {
    height = node.height;
  }

  if (sizeSamples.width.length > 0) {
    width = sampleFloatAt(sizeSamples.width, time);
  } else if (Math.abs(scaleX - 1) > 1e-4) {
    width *= scaleX;
  }

  if (sizeSamples.height.length > 0) {
    height = sampleFloatAt(sizeSamples.height, time);
  } else if (Math.abs(scaleY - 1) > 1e-4) {
    height *= scaleY;
  }

  return { x: width / 2, y: height / 2 };
}

function readTransformSamples(node: MotionCapableNode, diagnostics: Diagnostic[]): {
  translationX: FloatSample[];
  translationY: FloatSample[];
  translationXY: VectorSample[];
  rotation: FloatSample[];
  scaleX: FloatSample[];
  scaleY: FloatSample[];
  scaleXY: VectorSample[];
  sampleTimes: number[];
} {
  const animations = node.animations;
  const bindings: Partial<Record<TransformField, KeyframeBinding>> = {};

  for (const field of TRANSFORM_FIELDS) {
    const binding = animations[field];
    if (binding) {
      bindings[field] = binding;
      collectSetTrackWarnings(binding, diagnostics, node.id, field);
    }
  }

  const translationX = bindings.TRANSLATION_X ? collectFloatSamples(bindings.TRANSLATION_X) : [];
  const translationY = bindings.TRANSLATION_Y ? collectFloatSamples(bindings.TRANSLATION_Y) : [];
  const translationXY = bindings.TRANSLATION_XY ? collectVectorSamples(bindings.TRANSLATION_XY) : [];
  const rotation = bindings.ROTATION ? collectFloatSamples(bindings.ROTATION) : defaultRotationSamples();
  const scaleX = bindings.SCALE_X ? collectFloatSamples(bindings.SCALE_X) : defaultScaleSamples(1);
  const scaleY = bindings.SCALE_Y ? collectFloatSamples(bindings.SCALE_Y) : defaultScaleSamples(1);
  const scaleXY = bindings.SCALE_XY ? collectVectorSamples(bindings.SCALE_XY) : [];

  const sampleTimes = mergeSampleTimes([
    collectSampleTimes(translationX),
    collectSampleTimes(translationY),
    collectSampleTimes(translationXY),
    collectSampleTimes(rotation),
    collectSampleTimes(scaleX),
    collectSampleTimes(scaleY),
    collectSampleTimes(scaleXY),
  ]);

  return {
    translationX,
    translationY,
    translationXY,
    rotation,
    scaleX,
    scaleY,
    scaleXY,
    sampleTimes,
  };
}

function hasTransformAnimation(samples: ReturnType<typeof readTransformSamples>): boolean {
  return isAnimatedFloat(samples.translationX)
    || isAnimatedFloat(samples.translationY)
    || isAnimatedVector(samples.translationXY)
    || isAnimatedFloat(samples.rotation)
    || isAnimatedFloat(samples.scaleX)
    || isAnimatedFloat(samples.scaleY)
    || isAnimatedVector(samples.scaleXY);
}

function buildMatrixSampleTimes(
  transformSamples: ReturnType<typeof readTransformSamples>,
  sizeSamples: ReturnType<typeof readSizeSamples>,
  durationFrames: number,
): number[] {
  if (isAnimatedFloat(transformSamples.rotation)) {
    const times: number[] = [];
    for (let frame = 0; frame <= durationFrames; frame += 1) {
      times.push(frame / MOTION_FRAME_RATE);
    }
    return times;
  }

  return mergeSampleTimes([
    transformSamples.sampleTimes,
    sizeSamples.sampleTimes,
  ]);
}

function buildMatrixChannel(
  node: MotionCapableNode,
  parent: SceneNode | null,
  diagnostics: Diagnostic[],
  durationFrames: number,
): PagxChannel | null {
  const transformSamples = readTransformSamples(node, diagnostics);
  const sizeSamples = readSizeSamples(node, diagnostics);
  const hasTransform = hasTransformAnimation(transformSamples);
  const hasSize = hasSizeAnimation(sizeSamples);
  if (!hasTransform && !hasSize) {
    return null;
  }

  const useEasedSampling = isAnimatedFloat(transformSamples.rotation);
  const sampleFloat = useEasedSampling ? sampleFloatAtEased : sampleFloatAt;
  const sampleTimes = buildMatrixSampleTimes(transformSamples, sizeSamples, durationFrames);
  const rotationBase = transformSamples.rotation[0]?.value ?? 0;
  const rotationDirection = resolveRotationDirection(node);

  const keyframes: PagxKeyframe[] = [];
  for (const time of sampleTimes) {
    let translationX = 0;
    let translationY = 0;
    if (transformSamples.translationXY.length > 0) {
      const vector = sampleVectorAt(transformSamples.translationXY, time);
      translationX = vector.x;
      translationY = vector.y;
    } else {
      if (transformSamples.translationX.length > 0) {
        translationX = sampleFloat(transformSamples.translationX, time);
      }
      if (transformSamples.translationY.length > 0) {
        translationY = sampleFloat(transformSamples.translationY, time);
      }
    }

    let scaleX = 1;
    let scaleY = 1;
    if (transformSamples.scaleXY.length > 0) {
      const vector = sampleVectorAt(transformSamples.scaleXY, time);
      scaleX = vector.x;
      scaleY = vector.y;
    } else {
      scaleX = sampleFloat(transformSamples.scaleX, time);
      scaleY = sampleFloat(transformSamples.scaleY, time);
    }

    const sizeScale = resolveScaleFromSizeSamples(sizeSamples, time);
    scaleX *= sizeScale.scaleX;
    scaleY *= sizeScale.scaleY;

    const rotation = applyRotationDirection(
      sampleFloat(transformSamples.rotation, time),
      rotationDirection,
      rotationBase,
    );
    const pivot = resolveRotationPivot(node, sizeSamples, time, scaleX, scaleY);
    const matrix = pagxMotionMatrixStringFromComponents(
      translationX,
      translationY,
      rotation,
      scaleX,
      scaleY,
      pivot.x,
      pivot.y,
    ) ?? '1,0,0,1,0,0';

    keyframes.push({
      time: secondsToFrame(time),
      value: matrix,
    });
  }

  if (keyframes.length === 0) {
    return null;
  }

  const dedupedKeyframes: PagxKeyframe[] = [];
  for (const keyframe of keyframes) {
    const last = dedupedKeyframes[dedupedKeyframes.length - 1];
    if (last && last.value === keyframe.value) {
      continue;
    }
    dedupedKeyframes.push(keyframe);
  }

  return { name: 'matrix', type: 'matrix', keyframes: dedupedKeyframes };
}

function resolveDurationSeconds(root: MotionCapableNode, nodes: MotionCapableNode[]): number {
  const rootTimeline = root.timelines[0]?.duration;
  let maxDuration = rootTimeline ?? 0;

  for (const node of nodes) {
    const opacityDuration = node.animations.OPACITY?.timelineDuration ?? 0;
    maxDuration = Math.max(maxDuration, opacityDuration);
    for (const field of TRANSFORM_FIELDS) {
      const binding = node.animations[field];
      if (binding) {
        maxDuration = Math.max(maxDuration, binding.timelineDuration);
      }
    }
    for (const field of SIZE_FIELDS) {
      const binding = getSizeBinding(node.animations, field);
      if (binding) {
        maxDuration = Math.max(maxDuration, binding.timelineDuration);
      }
    }
  }

  for (const node of nodes) {
    const collectTimes = (binding: KeyframeBinding | undefined): number => {
      if (!binding) {
        return 0;
      }
      let maxTime = 0;
      for (const track of binding.tracks) {
        for (const keyframe of track.keyframes) {
          maxTime = Math.max(maxTime, keyframe.timelinePosition);
        }
      }
      return maxTime;
    };

    maxDuration = Math.max(maxDuration, collectTimes(node.animations.OPACITY));
    for (const field of TRANSFORM_FIELDS) {
      maxDuration = Math.max(maxDuration, collectTimes(node.animations[field]));
    }
    for (const field of SIZE_FIELDS) {
      maxDuration = Math.max(maxDuration, collectTimes(getSizeBinding(node.animations, field)));
    }
  }

  return maxDuration;
}

function resolveParentForNode(exportRoot: SceneNode, node: SceneNode): SceneNode | null {
  if (node === exportRoot) {
    return null;
  }
  const parent = node.parent;
  if (!parent || parent.type === 'PAGE' || parent.type === 'DOCUMENT') {
    return null;
  }
  let ancestor: BaseNode | null = parent;
  while (ancestor && ancestor !== exportRoot) {
    ancestor = ancestor.parent;
  }
  if (ancestor !== exportRoot) {
    return null;
  }
  return parent as SceneNode;
}

export function applyRotationDirectionForTest(
  degrees: number,
  direction: RotationDirection | null,
  baseDegrees: number,
): number {
  return applyRotationDirection(degrees, direction, baseDegrees);
}

export function springProgressForTest(progress: number, bounce: number): number {
  return springProgress(progress, bounce);
}

export function sampleFloatAtEasedForTest(samples: FloatSample[], time: number): number {
  return sampleFloatAtEased(samples, time);
}

export function collectMotionAnimations(
  root: SceneNode,
  layerIdByFigmaId: Map<string, string>,
  diagnostics: Diagnostic[],
): PagxAnimation[] {
  if (!isMotionNode(root)) {
    return [];
  }

  logMotionDebugData(root);

  const motionNodes: MotionCapableNode[] = [];
  walkSubtree(root, motionNodes);
  if (motionNodes.length === 0) {
    return [];
  }

  const durationSeconds = resolveDurationSeconds(root, motionNodes);
  const durationFrames = Math.max(1, Math.ceil(durationSeconds * MOTION_FRAME_RATE));

  const objects: PagxAnimationObject[] = [];
  for (const node of motionNodes) {
    const targetId = layerIdByFigmaId.get(node.id);
    if (!targetId) {
      addDiagnostic(
        diagnostics,
        'warning',
        'MOTION_UNMAPPED_NODE',
        `节点有动画但未导出为 Layer，已跳过`,
        node.id,
      );
      continue;
    }

    const parent = resolveParentForNode(root, node);
    const channels: PagxChannel[] = [];
    const alpha = buildAlphaChannel(node, diagnostics);
    if (alpha) {
      channels.push(alpha);
    }
    const matrix = buildMatrixChannel(node, parent, diagnostics, durationFrames);
    if (matrix) {
      channels.push(matrix);
    }

    if (channels.length === 0) {
      continue;
    }

    objects.push({ target: targetId, channels });
  }

  if (objects.length === 0) {
    return [];
  }

  return [{
    id: MOTION_ANIMATION_ID,
    duration: durationFrames,
    frameRate: MOTION_FRAME_RATE,
    loop: 'once',
    objects,
  }];
}

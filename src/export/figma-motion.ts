import type {
  Diagnostic,
  PagxAnimation,
  PagxAnimationObject,
  PagxChannel,
  PagxKeyframe,
} from './types';
import { roundDimension } from './color';
import { addDiagnostic, layoutPositionAttrs, nodeBoundsInParent, nodePositionInParent, pagxMotionMatrixStringFromComponents } from './figma-reader';

export const MOTION_FRAME_RATE = 30;
export const ALLOWED_FRAME_RATES = [24, 30, 60] as const;
export type AllowedFrameRate = (typeof ALLOWED_FRAME_RATES)[number];
const MOTION_ANIMATION_ID = 'motion-main';

type MotionCapableNode = SceneNode & {
  animations: Animations;
  animationStyles: ReadonlyArray<AppliedAnimationStyle>;
  timelines: ReadonlyArray<Timeline>;
};

type RotationDirection = 'clockwise' | 'counterclockwise';
type RotationPresetType = 'rotateIn' | 'rotateOut' | 'custom';

function isRotationStyle(style: AppliedAnimationStyle): boolean {
  const name = style.name ?? '';
  const type = typeof style.props?.type === 'string' ? style.props.type : '';
  return name.includes('rotation')
    || type === 'rotateIn'
    || type === 'rotateOut'
    || type === 'custom';
}

function readNumberProp(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' ? value : null;
}

function readRotationDirectionFromProps(record: Record<string, unknown> | undefined): RotationDirection | null {
  if (!record) {
    return null;
  }

  const type = typeof record.type === 'string' ? record.type : '';
  if (type === 'custom') {
    const start = readNumberProp(record, 'start');
    const end = readNumberProp(record, 'end');
    if (start !== null && end !== null) {
      if (end > start) {
        return 'clockwise';
      }
      if (end < start) {
        return 'counterclockwise';
      }
    }
    return null;
  }

  return normalizeRotationDirection(record.direction);
}

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

function resolveRotationDirection(node: MotionCapableNode): RotationDirection | null {
  for (const style of node.animationStyles ?? []) {
    if (!isRotationStyle(style)) {
      continue;
    }
    const direction = readRotationDirectionFromProps(style.props as Record<string, unknown> | undefined);
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

function resolveRotationPresetType(node: MotionCapableNode): RotationPresetType | null {
  for (const style of node.animationStyles ?? []) {
    if (!isRotationStyle(style)) {
      continue;
    }
    const type = typeof style.props?.type === 'string' ? style.props.type : '';
    if (type === 'rotateIn' || type === 'rotateOut' || type === 'custom') {
      return type;
    }
  }

  return null;
}

function hasSetRotationAnimation(node: MotionCapableNode): boolean {
  const binding = node.animations.ROTATION;
  return !!binding && bindingUsesSetOperation(binding);
}

function hasRotationStyleAnimation(node: MotionCapableNode): boolean {
  return (node.animationStyles ?? []).some(isRotationStyle);
}

function hasOnlySetRotationTransformAnimation(node: MotionCapableNode): boolean {
  if (!hasSetRotationAnimation(node)) {
    return false;
  }
  return TRANSFORM_FIELDS.every((field) => {
    if (field === 'ROTATION') {
      return true;
    }
    return !node.animations[field];
  });
}

function bindingUsesSetVectorOperation(binding: KeyframeBinding | undefined): boolean {
  return !!binding && binding.tracks.some((track) => track.keyframeOperation === 'SET');
}

function hasOnlySetScaleTransformAnimation(node: MotionCapableNode): boolean {
  const scaleBinding = node.animations.SCALE_XY;
  if (!bindingUsesSetVectorOperation(scaleBinding)) {
    return false;
  }
  return TRANSFORM_FIELDS.every((field) => {
    if (field === 'SCALE_XY') {
      return true;
    }
    return !node.animations[field];
  });
}

type MotionPivotSource = 'cached' | 'inferred-render-bounds' | 'rotation-top-left' | 'center';
type MotionPivot = { x: number; y: number; source: MotionPivotSource };

const PAGX_PLUGIN_NAMESPACE = 'pagx';
const PAGX_ANCHOR_KEY = 'anchor';

function parseCachedMotionPivot(node: SceneNode): MotionPivot | null {
  if (!('getSharedPluginData' in node)) {
    return null;
  }
  const value = node.getSharedPluginData(PAGX_PLUGIN_NAMESPACE, PAGX_ANCHOR_KEY);
  const [xText, yText] = value.split(',');
  const x = Number(xText);
  const y = Number(yText);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y, source: 'cached' };
}

function cacheMotionPivot(node: SceneNode, pivot: MotionPivot): void {
  if (!('setSharedPluginData' in node)) {
    return;
  }
  node.setSharedPluginData(
    PAGX_PLUGIN_NAMESPACE,
    PAGX_ANCHOR_KEY,
    `${roundDimension(pivot.x)},${roundDimension(pivot.y)}`,
  );
}

function snapToCommonAnchor(value: number, size: number): number {
  const candidates = [0, size / 2, size];
  const tolerance = Math.max(1, size * 0.03);
  for (const candidate of candidates) {
    if (Math.abs(value - candidate) <= tolerance) {
      return roundDimension(candidate);
    }
  }
  return roundDimension(value);
}

function inferScalePivotFromRenderBounds(
  node: MotionCapableNode,
  width: number,
  height: number,
): MotionPivot | null {
  if (
    !hasOnlySetScaleTransformAnimation(node)
    || !('absoluteBoundingBox' in node)
    || !('absoluteRenderBounds' in node)
    || !node.absoluteBoundingBox
    || !node.absoluteRenderBounds
    || width <= 0
    || height <= 0
  ) {
    return null;
  }

  const bounds = node.absoluteBoundingBox;
  const renderBounds = node.absoluteRenderBounds;
  const scaleX = renderBounds.width / bounds.width;
  const scaleY = renderBounds.height / bounds.height;
  if (
    Math.abs(renderBounds.width - bounds.width) < 0.2
    && Math.abs(renderBounds.height - bounds.height) < 0.2
  ) {
    return null;
  }

  const pivotX = (renderBounds.x - bounds.x) / (1 - scaleX);
  const pivotY = (renderBounds.y - bounds.y) / (1 - scaleY);
  if (!Number.isFinite(pivotX) || !Number.isFinite(pivotY)) {
    return null;
  }

  return {
    x: snapToCommonAnchor(pivotX, width),
    y: snapToCommonAnchor(pivotY, height),
    source: 'inferred-render-bounds',
  };
}

export function motionPivotForExport(
  node: SceneNode,
  width: number,
  height: number,
): MotionPivot {
  if (isMotionNode(node)) {
    const inferredPivot = inferScalePivotFromRenderBounds(node, width, height);
    if (inferredPivot) {
      cacheMotionPivot(node, inferredPivot);
      return inferredPivot;
    }
  }

  const cachedPivot = parseCachedMotionPivot(node);
  if (cachedPivot) {
    return cachedPivot;
  }

  if (isMotionNode(node)) {
    if (hasOnlySetRotationTransformAnimation(node) && !hasRotationStyleAnimation(node)) {
      return { x: 0, y: 0, source: 'rotation-top-left' };
    }
  }

  return { x: roundDimension(width / 2), y: roundDimension(height / 2), source: 'center' };
}

export function refreshMotionPivotCache(node: SceneNode): MotionPivot | null {
  if (
    !isMotionNode(node)
    || !('width' in node)
    || !('height' in node)
    || typeof node.width !== 'number'
    || typeof node.height !== 'number'
  ) {
    return null;
  }

  const inferredPivot = inferScalePivotFromRenderBounds(node, node.width, node.height);
  if (!inferredPivot) {
    if (hasOnlySetRotationTransformAnimation(node) && !hasRotationStyleAnimation(node)) {
      const rotationPivot: MotionPivot = { x: 0, y: 0, source: 'rotation-top-left' };
      cacheMotionPivot(node, rotationPivot);
      return rotationPivot;
    }
    return null;
  }

  cacheMotionPivot(node, inferredPivot);
  return inferredPivot;
}

function readSetRotationOrigin(binding: KeyframeBinding): number {
  let minTime = Number.POSITIVE_INFINITY;
  let origin = 0;
  for (const track of binding.tracks) {
    if (track.keyframeOperation !== 'SET') {
      continue;
    }
    for (const keyframe of track.keyframes) {
      if (keyframe.value.type !== 'FLOAT') {
        continue;
      }
      if (keyframe.timelinePosition <= minTime) {
        minTime = keyframe.timelinePosition;
        origin = keyframe.value.value;
      }
    }
  }
  return origin;
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
type MotionField = TransformField | SizeField | 'OPACITY';

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

function getSizeBinding(animations: Animations, field: SizeField): KeyframeBinding | undefined {
  const binding = animations[field as keyof Animations];
  return isKeyframeBinding(binding) ? binding : undefined;
}

function getTransformBinding(
  animations: Animations,
  field: TransformField,
): KeyframeBinding | undefined {
  const binding = animations[field];
  return isKeyframeBinding(binding) ? binding : undefined;
}

function bindingUsesSetOperation(binding: KeyframeBinding): boolean {
  return binding.tracks.some((track) => track.keyframeOperation === 'SET');
}

function hasTranslationAnimation(node: MotionCapableNode): boolean {
  return !!(
    getTransformBinding(node.animations, 'TRANSLATION_X')
    || getTransformBinding(node.animations, 'TRANSLATION_Y')
    || getTransformBinding(node.animations, 'TRANSLATION_XY')
  );
}

function hasSetTranslationAnimation(node: MotionCapableNode): boolean {
  for (const field of ['TRANSLATION_X', 'TRANSLATION_Y', 'TRANSLATION_XY'] as const) {
    const binding = getTransformBinding(node.animations, field);
    if (binding && bindingUsesSetOperation(binding)) {
      return true;
    }
  }
  return false;
}

function figmaRawTranslationToPagx(value: number): number {
  return -value || 0;
}

function shouldNegateRotationDegrees(
  presetType: RotationPresetType | null,
  direction: RotationDirection | null,
  usesSetRotation: boolean,
): boolean {
  if (usesSetRotation) {
    return true;
  }
  if (presetType === 'rotateIn') {
    return true;
  }
  if (presetType === 'rotateOut' || presetType === 'custom') {
    return direction === 'counterclockwise';
  }
  return direction === 'counterclockwise';
}

function figmaRotationDegreesToPagx(
  degrees: number,
  presetType: RotationPresetType | null,
  direction: RotationDirection | null,
  usesSetRotation: boolean,
): number {
  if (shouldNegateRotationDegrees(presetType, direction, usesSetRotation)) {
    return -degrees || 0;
  }
  return degrees;
}

function readConstraintAxis(node: SceneNode, axis: 'x' | 'y'): Constraints['horizontal'] | null {
  if (!('constraints' in node)) {
    return null;
  }
  return axis === 'x' ? node.constraints.horizontal : node.constraints.vertical;
}

function parentHasPureAxisFlip(parent: SceneNode | null): boolean {
  if (!parent || !('absoluteTransform' in parent)) {
    return false;
  }

  const transform = parent.absoluteTransform;
  const epsilon = 1e-4;
  return Math.abs(transform[0][0] + 1) < epsilon
    && Math.abs(transform[1][1] + 1) < epsilon
    && Math.abs(transform[1][0]) < epsilon
    && Math.abs(transform[0][1]) < epsilon;
}

function shouldNegateOffsetForAxis(
  node: SceneNode,
  parent: SceneNode | null,
  axis: 'x' | 'y',
): boolean {
  if (axis === 'y') {
    return false;
  }

  if (parentHasPureAxisFlip(parent)) {
    return true;
  }

  if (
    parent
    && 'width' in node
    && 'height' in node
    && 'width' in parent
    && 'height' in parent
  ) {
    // GROUP 子节点的 node.x/y 常为画布绝对坐标；Figma OFFSET 符号已与 PAGX 一致，不做靠边角取反。
    if (parent.type === 'GROUP') {
      return readConstraintAxis(node, axis) === 'MAX';
    }

    const position = nodePositionInParent(node, parent);
    if (position.left !== undefined) {
      const distanceToLeft = position.left;
      const distanceToRight = parent.width - (position.left + node.width);
      return distanceToRight < distanceToLeft;
    }
  }

  const constraint = readConstraintAxis(node, axis);
  return constraint === 'MAX';
}

function resolveFloatKeyframeValue(
  rawValue: number,
  operation: 'SET' | 'OFFSET' | 'SCALE',
  translationContext?: TranslationSampleContext,
): number {
  if (!translationContext) {
    return rawValue;
  }
  if (operation === 'OFFSET') {
    return figmaOffsetValueToPagx(
      rawValue,
      translationContext.axis,
      translationContext.node,
      translationContext.parent,
    );
  }
  return rawValue;
}

function figmaOffsetValueToPagx(
  value: number,
  axis: 'x' | 'y',
  node: SceneNode,
  parent: SceneNode | null,
): number {
  return shouldNegateOffsetForAxis(node, parent, axis)
    ? (-value || 0)
    : (value || 0);
}

function styleMatchesMotionField(style: AppliedAnimationStyle, field: MotionField): boolean {
  const name = style.name ?? '';
  const type = typeof style.props?.type === 'string' ? style.props.type : '';

  switch (field) {
    case 'OPACITY':
      return name.includes('opacity') || type === 'fadeIn' || type === 'fadeOut';
    case 'TRANSLATION_X':
    case 'TRANSLATION_Y':
    case 'TRANSLATION_XY':
      return name.includes('position') || type.startsWith('slide_');
    case 'ROTATION':
      return isRotationStyle(style);
    case 'SCALE_X':
    case 'SCALE_Y':
    case 'SCALE_XY':
      return name.includes('scale') || type === 'scaleIn' || type === 'scaleOut';
    case 'WIDTH':
    case 'HEIGHT':
      return name.includes('size') || type === 'resizeIn' || type === 'resizeOut';
  }
}

function motionStyleTimelineOffset(node: MotionCapableNode, field: MotionField): number {
  for (const style of node.animationStyles ?? []) {
    if (styleMatchesMotionField(style, field) && typeof style.timelineOffset === 'number') {
      return style.timelineOffset;
    }
  }
  return 0;
}

function translationKeyframeValueToPagx(
  value: number,
  axis: 'x' | 'y',
  operation: 'SET' | 'OFFSET',
  node: SceneNode,
  parent: SceneNode | null,
): number {
  if (operation === 'OFFSET') {
    return figmaOffsetValueToPagx(value, axis, node, parent);
  }
  return value;
}

function readPagxTranslationSpan(
  node: MotionCapableNode,
  parent: SceneNode | null,
): { x: number; y: number } | null {
  let minTime = Number.POSITIVE_INFINITY;
  let maxTime = Number.NEGATIVE_INFINITY;
  let startX = 0;
  let startY = 0;
  let endX = 0;
  let endY = 0;
  let hasSample = false;

  const readFloatKeyframes = (binding: KeyframeBinding, axis: 'x' | 'y'): void => {
    for (const track of binding.tracks) {
      if (track.keyframeOperation !== 'SET' && track.keyframeOperation !== 'OFFSET') {
        continue;
      }
      for (const keyframe of track.keyframes) {
        if (keyframe.value.type !== 'FLOAT') {
          continue;
        }
        hasSample = true;
        const pagxValue = translationKeyframeValueToPagx(
          keyframe.value.value,
          axis,
          track.keyframeOperation,
          node,
          parent,
        );
        if (keyframe.timelinePosition <= minTime) {
          minTime = keyframe.timelinePosition;
          if (axis === 'x') {
            startX = pagxValue;
          } else {
            startY = pagxValue;
          }
        }
        if (keyframe.timelinePosition >= maxTime) {
          maxTime = keyframe.timelinePosition;
          if (axis === 'x') {
            endX = pagxValue;
          } else {
            endY = pagxValue;
          }
        }
      }
    }
  };

  const readVectorKeyframes = (binding: KeyframeBinding): void => {
    for (const track of binding.tracks) {
      if (track.keyframeOperation !== 'SET' && track.keyframeOperation !== 'OFFSET') {
        continue;
      }
      for (const keyframe of track.keyframes) {
        if (keyframe.value.type !== 'VECTOR') {
          continue;
        }
        hasSample = true;
        const pagxX = translationKeyframeValueToPagx(
          keyframe.value.value.x,
          'x',
          track.keyframeOperation,
          node,
          parent,
        );
        const pagxY = translationKeyframeValueToPagx(
          keyframe.value.value.y,
          'y',
          track.keyframeOperation,
          node,
          parent,
        );
        if (keyframe.timelinePosition <= minTime) {
          minTime = keyframe.timelinePosition;
          startX = pagxX;
          startY = pagxY;
        }
        if (keyframe.timelinePosition >= maxTime) {
          maxTime = keyframe.timelinePosition;
          endX = pagxX;
          endY = pagxY;
        }
      }
    }
  };

  const translationXY = getTransformBinding(node.animations, 'TRANSLATION_XY');
  if (translationXY) {
    readVectorKeyframes(translationXY);
  } else {
    const translationX = getTransformBinding(node.animations, 'TRANSLATION_X');
    const translationY = getTransformBinding(node.animations, 'TRANSLATION_Y');
    if (translationX) {
      readFloatKeyframes(translationX, 'x');
    }
    if (translationY) {
      readFloatKeyframes(translationY, 'y');
    }
  }

  if (!hasSample) {
    return null;
  }

  return {
    x: endX - startX,
    y: endY - startY,
  };
}

export function motionLayoutPositionForExport(
  node: SceneNode,
  parent: SceneNode | null,
): Record<string, string | number | boolean> {
  if (!parent || !isMotionNode(node) || !hasTranslationAnimation(node)) {
    return layoutPositionAttrs(node, parent);
  }

  const span = readPagxTranslationSpan(node, parent);
  if (!span) {
    return layoutPositionAttrs(node, parent);
  }

  const bbox = nodeBoundsInParent(node, parent);
  if (bbox && parent.type !== 'GROUP' && 'x' in node && 'y' in node) {
    const shiftX = bbox.left - node.x;
    const shiftY = bbox.top - node.y;
    const epsilon = 1e-2;
    if (Math.abs(shiftX - span.x) < epsilon && Math.abs(shiftY - span.y) < epsilon) {
      return {
        left: roundDimension(node.x),
        top: roundDimension(node.y),
      };
    }
  }

  return layoutPositionAttrs(node, parent);
}

function readSetTranslationOrigin(
  node: MotionCapableNode,
  transformSamples: ReturnType<typeof readTransformSamples>,
): { x: number; y: number } {
  const translationXY = getTransformBinding(node.animations, 'TRANSLATION_XY');
  if (
    translationXY
    && bindingUsesSetOperation(translationXY)
    && transformSamples.translationXY.length > 0
  ) {
    return {
      x: transformSamples.translationXY[0].x,
      y: transformSamples.translationXY[0].y,
    };
  }

  let originX = 0;
  let originY = 0;
  const translationX = getTransformBinding(node.animations, 'TRANSLATION_X');
  if (
    translationX
    && bindingUsesSetOperation(translationX)
    && transformSamples.translationX.length > 0
  ) {
    originX = transformSamples.translationX[0].value;
  }
  const translationY = getTransformBinding(node.animations, 'TRANSLATION_Y');
  if (
    translationY
    && bindingUsesSetOperation(translationY)
    && transformSamples.translationY.length > 0
  ) {
    originY = transformSamples.translationY[0].value;
  }

  return { x: originX, y: originY };
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
  for (const effectAnimation of Object.values(animations.effects ?? {})) {
    if (effectAnimation?.RADIUS) {
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

function serializeTransform(transform: Transform | undefined): Transform | undefined {
  return transform ? [[...transform[0]], [...transform[1]]] : undefined;
}

function serializeRect(rect: Rect | null | undefined): Rect | undefined {
  return rect ? {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  } : undefined;
}

function probeAnchorFields(node: SceneNode): Record<string, string> {
  const fields = [
    'anchorPoint',
    'anchor',
    'pivot',
    'pivotPoint',
    'transformPivot',
    'transformOrigin',
    'rotationOrigin',
    'rotationCenter',
    'origin',
    'motionAnchor',
    'motionPivot',
    'manualAnchor',
  ];
  const result: Record<string, string> = {};
  const nodeRecord = node as unknown as Record<string, unknown>;

  for (const field of fields) {
    try {
      result[field] = nodeRecord[field] === undefined ? 'missing' : 'present';
    } catch (error) {
      result[field] = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

function motionPivotDebugData(node: SceneNode): MotionPivot | undefined {
  if (!('width' in node) || !('height' in node)) {
    return undefined;
  }
  const motionSize = motionLayoutSizeForExport(node);
  const width = motionSize?.width ?? roundDimension(node.width);
  const height = motionSize?.height ?? roundDimension(node.height);
  return motionPivotForExport(node, width, height);
}

export function collectMotionDebugData(root: SceneNode): unknown[] {
  const entries: unknown[] = [];

  function walk(node: SceneNode, parent: SceneNode | null): void {
    if (isMotionNode(node)) {
      const animationKeys = Object.keys(node.animations).filter(
        (field) => node.animations[field as keyof Animations],
      );
      entries.push({
        id: node.id,
        name: node.name,
        type: node.type,
        layout: {
          x: 'x' in node ? node.x : undefined,
          y: 'y' in node ? node.y : undefined,
          width: 'width' in node ? node.width : undefined,
          height: 'height' in node ? node.height : undefined,
          constraints: 'constraints' in node ? node.constraints : undefined,
          parentWidth: parent && 'width' in parent ? parent.width : undefined,
          parentHeight: parent && 'height' in parent ? parent.height : undefined,
        },
        transform: {
          rotation: 'rotation' in node ? node.rotation : undefined,
          relativeTransform: 'relativeTransform' in node ? serializeTransform(node.relativeTransform) : undefined,
          absoluteTransform: 'absoluteTransform' in node ? serializeTransform(node.absoluteTransform) : undefined,
          absoluteBoundingBox: 'absoluteBoundingBox' in node ? serializeRect(node.absoluteBoundingBox) : undefined,
          absoluteRenderBounds: 'absoluteRenderBounds' in node ? serializeRect(node.absoluteRenderBounds) : undefined,
          anchorProbe: probeAnchorFields(node),
          motionPivot: motionPivotDebugData(node),
        },
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
        walk(child, node);
      }
    }
  }

  walk(root, null);
  return entries;
}

function logMotionDebugData(root: SceneNode): void {
  console.log('[figma-motion-export-pagx] motion debug data:', JSON.stringify(collectMotionDebugData(root), null, 2));
}

function secondsToFrame(seconds: number, frameRate: number): number {
  return Math.max(0, Math.round(seconds * frameRate));
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
    if (
      track.keyframeOperation !== 'SET'
      && track.keyframeOperation !== 'OFFSET'
      && track.keyframeOperation !== 'SCALE'
    ) {
      addDiagnostic(
        diagnostics,
        'warning',
        'MOTION_UNSUPPORTED_KEYFRAME_OP',
        `${fieldName} 的 ${track.keyframeOperation} 轨道暂不支持`,
        nodeId,
      );
    }
  }
}

function sortAndDedupeFloatSamples(samples: FloatSample[]): FloatSample[] {
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

function sortAndDedupeVectorSamples(samples: VectorSample[]): VectorSample[] {
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

type TranslationSampleContext = {
  axis: 'x' | 'y';
  node: SceneNode;
  parent: SceneNode | null;
};

function collectFloatSamples(
  binding: KeyframeBinding,
  translationContext?: TranslationSampleContext,
  timeOffset = 0,
): FloatSample[] {
  const base = binding.baseValue.type === 'FLOAT' ? binding.baseValue.value : 0;
  const samples: FloatSample[] = [];
  let usesSetKeyframeTrack = false;

  for (const track of binding.tracks) {
    if (track.keyframeOperation === 'OFFSET') {
      for (const keyframe of track.keyframes) {
        if (keyframe.value.type !== 'FLOAT') {
          continue;
        }
        samples.push({
          time: keyframe.timelinePosition + timeOffset,
          value: resolveFloatKeyframeValue(
            keyframe.value.value,
            track.keyframeOperation,
            translationContext,
          ),
          easing: keyframe.easing,
        });
      }
      continue;
    }

    if (track.keyframeOperation === 'SET') {
      usesSetKeyframeTrack = true;
    }

    for (const keyframe of track.keyframes) {
      if (keyframe.value.type !== 'FLOAT') {
        continue;
      }
      samples.push({
        time: keyframe.timelinePosition + timeOffset,
        value: resolveFloatKeyframeValue(
          keyframe.value.value,
          track.keyframeOperation,
          translationContext,
        ),
        easing: keyframe.easing,
      });
    }
  }

  if (usesSetKeyframeTrack) {
    const hasKeyframeAtOffset = samples.some((sample) => Math.abs(sample.time - timeOffset) < 1e-6);
    if (!hasKeyframeAtOffset) {
      samples.push({
        time: timeOffset,
        value: resolveFloatKeyframeValue(base, 'SET', translationContext),
        easing: LINEAR_EASING,
      });
    }
  }

  return sortAndDedupeFloatSamples(samples);
}

function resolveSizeKeyframeValue(
  base: number,
  rawValue: number,
  operation: 'SET' | 'OFFSET' | 'SCALE',
): number {
  if (operation === 'OFFSET') {
    return base + rawValue;
  }
  if (operation === 'SCALE') {
    return base * rawValue;
  }
  return rawValue;
}

function collectSizeSamples(binding: KeyframeBinding, timeOffset = 0): FloatSample[] {
  const base = binding.baseValue.type === 'FLOAT' ? binding.baseValue.value : 0;
  const samples: FloatSample[] = [];

  for (const track of binding.tracks) {
    for (const keyframe of track.keyframes) {
      if (keyframe.value.type !== 'FLOAT') {
        continue;
      }
      samples.push({
        time: keyframe.timelinePosition + timeOffset,
        value: resolveSizeKeyframeValue(base, keyframe.value.value, track.keyframeOperation),
        easing: keyframe.easing,
      });
    }
  }

  return sortAndDedupeFloatSamples(samples);
}

function collectVectorSamples(
  binding: KeyframeBinding,
  node?: SceneNode,
  parent?: SceneNode | null,
  timeOffset = 0,
): VectorSample[] {
  const baseX = binding.baseValue.type === 'VECTOR' ? binding.baseValue.value.x : 0;
  const baseY = binding.baseValue.type === 'VECTOR' ? binding.baseValue.value.y : 0;
  const samples: VectorSample[] = [];
  let usesSetTrack = false;

  for (const track of binding.tracks) {
    if (track.keyframeOperation === 'OFFSET') {
      for (const keyframe of track.keyframes) {
        if (keyframe.value.type !== 'VECTOR') {
          continue;
        }
        samples.push({
          time: keyframe.timelinePosition + timeOffset,
          x: node
            ? figmaOffsetValueToPagx(keyframe.value.value.x, 'x', node, parent ?? null)
            : figmaRawTranslationToPagx(keyframe.value.value.x),
          y: node
            ? figmaOffsetValueToPagx(keyframe.value.value.y, 'y', node, parent ?? null)
            : figmaRawTranslationToPagx(keyframe.value.value.y),
          easing: keyframe.easing,
        });
      }
      continue;
    }

    usesSetTrack = true;
    for (const keyframe of track.keyframes) {
      if (keyframe.value.type !== 'VECTOR') {
        continue;
      }
      samples.push({
        time: keyframe.timelinePosition + timeOffset,
        x: keyframe.value.value.x,
        y: keyframe.value.value.y,
        easing: keyframe.easing,
      });
    }
  }

  if (usesSetTrack) {
    const hasKeyframeAtOffset = samples.some((sample) => Math.abs(sample.time - timeOffset) < 1e-6);
    if (!hasKeyframeAtOffset) {
      samples.push({
        time: timeOffset,
        x: baseX,
        y: baseY,
        easing: LINEAR_EASING,
      });
    }
  }

  return sortAndDedupeVectorSamples(samples);
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
  frameRate: number,
  timeOffset = 0,
): PagxChannel | null {
  collectSetTrackWarnings(binding, diagnostics, nodeId, fieldName);
  const samples = collectFloatSamples(binding, undefined, timeOffset);
  if (!isAnimatedFloat(samples)) {
    return null;
  }

  const keyframes: PagxKeyframe[] = samples.map((sample, index) => {
    const frame = secondsToFrame(sample.time, frameRate);
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
  frameRate: number,
): PagxChannel | null {
  const binding = node.animations.OPACITY;
  if (!binding) {
    return null;
  }
  return buildFloatChannel(
    binding,
    node.id,
    'OPACITY',
    'alpha',
    diagnostics,
    frameRate,
    motionStyleTimelineOffset(node, 'OPACITY'),
  );
}

function buildBlurChannels(
  node: MotionCapableNode,
  effectTargetIdByFigmaId: Map<string, string>,
  diagnostics: Diagnostic[],
  frameRate: number,
): PagxAnimationObject[] {
  const objects: PagxAnimationObject[] = [];
  const effectAnimations = node.animations.effects;
  if (!effectAnimations) {
    return objects;
  }
  for (const effectIndexText of Object.keys(effectAnimations)) {
    const effectIndex = Number(effectIndexText);
    const binding = effectAnimations[effectIndex]?.RADIUS;
    const targetId = effectTargetIdByFigmaId.get(`${node.id}:${effectIndex}`);
    if (!binding || !targetId) {
      continue;
    }
    const blurX = buildFloatChannel(
      binding,
      node.id,
      `effects[${effectIndex}].RADIUS`,
      'blurX',
      diagnostics,
      frameRate,
    );
    if (!blurX) {
      continue;
    }
    blurX.keyframes = blurX.keyframes.filter((keyframe, index, keyframes) => (
      index === keyframes.length - 1 || keyframe.time !== keyframes[index + 1].time
    ));
    objects.push({
      target: targetId,
      channels: [blurX, { ...blurX, name: 'blurY', keyframes: blurX.keyframes.map((keyframe) => ({ ...keyframe })) }],
    });
  }
  return objects;
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

  const width = widthBinding ? collectSizeSamples(widthBinding, motionStyleTimelineOffset(node, 'WIDTH')) : [];
  const height = heightBinding ? collectSizeSamples(heightBinding, motionStyleTimelineOffset(node, 'HEIGHT')) : [];
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

  return motionPivotForExport(node, width, height);
}

function readTransformSamples(
  node: MotionCapableNode,
  parent: SceneNode | null,
  diagnostics: Diagnostic[],
): {
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

  const translationX = bindings.TRANSLATION_X
    ? collectFloatSamples(
      bindings.TRANSLATION_X,
      { axis: 'x', node, parent },
      motionStyleTimelineOffset(node, 'TRANSLATION_X'),
    )
    : [];
  const translationY = bindings.TRANSLATION_Y
    ? collectFloatSamples(
      bindings.TRANSLATION_Y,
      { axis: 'y', node, parent },
      motionStyleTimelineOffset(node, 'TRANSLATION_Y'),
    )
    : [];
  const translationXY = bindings.TRANSLATION_XY
    ? collectVectorSamples(bindings.TRANSLATION_XY, node, parent, motionStyleTimelineOffset(node, 'TRANSLATION_XY'))
    : [];
  const rotation = bindings.ROTATION
    ? collectFloatSamples(bindings.ROTATION, undefined, motionStyleTimelineOffset(node, 'ROTATION'))
    : defaultRotationSamples();
  const scaleX = bindings.SCALE_X
    ? collectFloatSamples(bindings.SCALE_X, undefined, motionStyleTimelineOffset(node, 'SCALE_X'))
    : defaultScaleSamples(1);
  const scaleY = bindings.SCALE_Y
    ? collectFloatSamples(bindings.SCALE_Y, undefined, motionStyleTimelineOffset(node, 'SCALE_Y'))
    : defaultScaleSamples(1);
  const scaleXY = bindings.SCALE_XY
    ? collectVectorSamples(bindings.SCALE_XY, undefined, undefined, motionStyleTimelineOffset(node, 'SCALE_XY'))
    : [];

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

export function needsMotionTransformGroup(node: SceneNode): boolean {
  if (!isMotionNode(node)) {
    return false;
  }

  return TRANSFORM_FIELDS.some((field) => getTransformBinding(node.animations, field));
}

type MatrixTransformStep = 'translation' | 'scale' | 'rotation';

type AffineMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};

const IDENTITY_AFFINE_MATRIX: AffineMatrix = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

function mapStyleToMatrixTransformStep(style: AppliedAnimationStyle): MatrixTransformStep | null {
  const name = style.name ?? '';
  const type = typeof style.props?.type === 'string' ? style.props.type : '';

  if (name.includes('position') || type.startsWith('slide_')) {
    return 'translation';
  }
  if (name.includes('scale') || type === 'scaleIn' || type === 'scaleOut') {
    return 'scale';
  }
  if (name.includes('rotation') || type === 'rotateIn' || type === 'rotateOut' || type === 'custom') {
    return 'rotation';
  }

  return null;
}

function resolveMatrixTransformOrder(
  node: MotionCapableNode,
  transformSamples: ReturnType<typeof readTransformSamples>,
): MatrixTransformStep[] {
  const order: MatrixTransformStep[] = [];
  for (const style of node.animationStyles ?? []) {
    const step = mapStyleToMatrixTransformStep(style);
    if (step && !order.includes(step)) {
      order.push(step);
    }
  }
  if (order.length > 0) {
    return order;
  }

  const fallback: MatrixTransformStep[] = [];
  if (
    isAnimatedFloat(transformSamples.translationX)
    || isAnimatedFloat(transformSamples.translationY)
    || isAnimatedVector(transformSamples.translationXY)
  ) {
    fallback.push('translation');
  }
  if (
    isAnimatedFloat(transformSamples.scaleX)
    || isAnimatedFloat(transformSamples.scaleY)
    || isAnimatedVector(transformSamples.scaleXY)
  ) {
    fallback.push('scale');
  }
  if (isAnimatedFloat(transformSamples.rotation)) {
    fallback.push('rotation');
  }
  return fallback;
}

function multiplyAffineMatrices(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    tx: left.a * right.tx + left.c * right.ty + left.tx,
    ty: left.b * right.tx + left.d * right.ty + left.ty,
  };
}

function translationAffineMatrix(translationX: number, translationY: number): AffineMatrix {
  return {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: translationX,
    ty: translationY,
  };
}

function scaleAroundPivotAffineMatrix(
  scaleX: number,
  scaleY: number,
  pivotX: number,
  pivotY: number,
): AffineMatrix {
  return multiplyAffineMatrices(
    multiplyAffineMatrices(
      translationAffineMatrix(pivotX, pivotY),
      { a: scaleX, b: 0, c: 0, d: scaleY, tx: 0, ty: 0 },
    ),
    translationAffineMatrix(-pivotX, -pivotY),
  );
}

function rotationAroundPivotAffineMatrix(
  rotationDegrees: number,
  pivotX: number,
  pivotY: number,
): AffineMatrix {
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return multiplyAffineMatrices(
    multiplyAffineMatrices(
      translationAffineMatrix(pivotX, pivotY),
      { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 },
    ),
    translationAffineMatrix(-pivotX, -pivotY),
  );
}

function buildTransformStepAffineMatrix(
  step: MatrixTransformStep,
  translationX: number,
  translationY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number,
  pivotX: number,
  pivotY: number,
): AffineMatrix {
  switch (step) {
    case 'translation':
      return translationAffineMatrix(translationX, translationY);
    case 'scale':
      return scaleAroundPivotAffineMatrix(scaleX, scaleY, pivotX, pivotY);
    case 'rotation':
      return rotationAroundPivotAffineMatrix(rotationDegrees, pivotX, pivotY);
  }
}

function composeAffineMatrixFromTransformOrder(
  order: MatrixTransformStep[],
  translationX: number,
  translationY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number,
  pivotX: number,
  pivotY: number,
): AffineMatrix {
  let matrix = IDENTITY_AFFINE_MATRIX;
  for (const step of order) {
    const stepMatrix = buildTransformStepAffineMatrix(
      step,
      translationX,
      translationY,
      scaleX,
      scaleY,
      rotationDegrees,
      pivotX,
      pivotY,
    );
    matrix = multiplyAffineMatrices(stepMatrix, matrix);
  }
  return matrix;
}

function affineMatrixToString(matrix: AffineMatrix): string {
  if (
    Math.abs(matrix.a - 1) < 1e-4
    && Math.abs(matrix.b) < 1e-4
    && Math.abs(matrix.c) < 1e-4
    && Math.abs(matrix.d - 1) < 1e-4
    && Math.abs(matrix.tx) < 1e-4
    && Math.abs(matrix.ty) < 1e-4
  ) {
    return '1,0,0,1,0,0';
  }

  return `${roundDimension(matrix.a)},${roundDimension(matrix.b)},${roundDimension(matrix.c)},${roundDimension(matrix.d)},${roundDimension(matrix.tx)},${roundDimension(matrix.ty)}`;
}

function maxSampleTimeSeconds(samples: Array<{ time: number }>): number {
  let max = 0;
  for (const sample of samples) {
    max = Math.max(max, sample.time);
  }
  return max;
}

function maxTransformKeyframeSeconds(
  transformSamples: ReturnType<typeof readTransformSamples>,
  sizeSamples: ReturnType<typeof readSizeSamples>,
): number {
  return Math.max(
    maxSampleTimeSeconds(transformSamples.translationX),
    maxSampleTimeSeconds(transformSamples.translationY),
    maxSampleTimeSeconds(transformSamples.translationXY),
    maxSampleTimeSeconds(transformSamples.rotation),
    maxSampleTimeSeconds(transformSamples.scaleX),
    maxSampleTimeSeconds(transformSamples.scaleY),
    maxSampleTimeSeconds(transformSamples.scaleXY),
    maxSampleTimeSeconds(sizeSamples.width),
    maxSampleTimeSeconds(sizeSamples.height),
  );
}

function hasSpringEasing(samples: Array<{ easing: MotionEasing | VariableAlias }>): boolean {
  return samples.some((sample) => !isVariableAlias(sample.easing) && sample.easing.type === 'CUSTOM_SPRING');
}

function hasAnySpringEasing(
  transformSamples: ReturnType<typeof readTransformSamples>,
  sizeSamples: ReturnType<typeof readSizeSamples>,
): boolean {
  return hasSpringEasing(transformSamples.translationX)
    || hasSpringEasing(transformSamples.translationY)
    || hasSpringEasing(transformSamples.translationXY)
    || hasSpringEasing(transformSamples.rotation)
    || hasSpringEasing(transformSamples.scaleX)
    || hasSpringEasing(transformSamples.scaleY)
    || hasSpringEasing(transformSamples.scaleXY)
    || hasSpringEasing(sizeSamples.width)
    || hasSpringEasing(sizeSamples.height);
}

function resolveRotationBase(): number {
  // OFFSET 与 SET 的动画增量都以 0 为基准；静止角 baseValue 由静态 Layer matrix 表达
  return 0;
}

function shouldBakeMatrixPerFrame(
  node: MotionCapableNode,
  transformSamples: ReturnType<typeof readTransformSamples>,
  sizeSamples?: ReturnType<typeof readSizeSamples>,
): boolean {
  if (sizeSamples && hasAnySpringEasing(transformSamples, sizeSamples)) {
    return true;
  }

  const transformStyleCount = (node.animationStyles ?? [])
    .filter((style) => mapStyleToMatrixTransformStep(style) !== null).length;
  if (transformStyleCount > 1) {
    return true;
  }

  const animatedChannelCount = [
    isAnimatedFloat(transformSamples.translationX),
    isAnimatedFloat(transformSamples.translationY),
    isAnimatedVector(transformSamples.translationXY),
    isAnimatedFloat(transformSamples.scaleX),
    isAnimatedFloat(transformSamples.scaleY),
    isAnimatedFloat(transformSamples.rotation),
  ].filter(Boolean).length;
  if (animatedChannelCount > 1) {
    return true;
  }

  return isAnimatedFloat(transformSamples.rotation);
}

function buildMatrixSampleTimes(
  node: MotionCapableNode,
  transformSamples: ReturnType<typeof readTransformSamples>,
  sizeSamples: ReturnType<typeof readSizeSamples>,
  frameRate: number,
): number[] {
  if (shouldBakeMatrixPerFrame(node, transformSamples, sizeSamples)) {
    const endFrame = Math.max(1, secondsToFrame(maxTransformKeyframeSeconds(transformSamples, sizeSamples), frameRate));
    const times: number[] = [];
    for (let frame = 0; frame <= endFrame; frame += 1) {
      times.push(frame / frameRate);
    }
    return times;
  }

  return mergeSampleTimes([
    transformSamples.sampleTimes,
    sizeSamples.sampleTimes,
  ]);
}

function findSampleEasingAtTime<T extends { time: number; easing: MotionEasing | VariableAlias }>(
  samples: T[],
  time: number,
): MotionEasing | VariableAlias | null {
  const sample = samples.find((item) => Math.abs(item.time - time) < 1e-6);
  return sample?.easing ?? null;
}

function matrixKeyframeEasingAtTime(
  transformSamples: ReturnType<typeof readTransformSamples>,
  sizeSamples: ReturnType<typeof readSizeSamples>,
  time: number,
): MotionEasing | VariableAlias | null {
  return (isAnimatedVector(transformSamples.translationXY) ? findSampleEasingAtTime(transformSamples.translationXY, time) : null)
    ?? (isAnimatedFloat(transformSamples.translationX) ? findSampleEasingAtTime(transformSamples.translationX, time) : null)
    ?? (isAnimatedFloat(transformSamples.translationY) ? findSampleEasingAtTime(transformSamples.translationY, time) : null)
    ?? (isAnimatedFloat(transformSamples.rotation) ? findSampleEasingAtTime(transformSamples.rotation, time) : null)
    ?? (isAnimatedVector(transformSamples.scaleXY) ? findSampleEasingAtTime(transformSamples.scaleXY, time) : null)
    ?? (isAnimatedFloat(transformSamples.scaleX) ? findSampleEasingAtTime(transformSamples.scaleX, time) : null)
    ?? (isAnimatedFloat(transformSamples.scaleY) ? findSampleEasingAtTime(transformSamples.scaleY, time) : null)
    ?? (isAnimatedFloat(sizeSamples.width) ? findSampleEasingAtTime(sizeSamples.width, time) : null)
    ?? (isAnimatedFloat(sizeSamples.height) ? findSampleEasingAtTime(sizeSamples.height, time) : null);
}

function buildMatrixChannel(
  node: MotionCapableNode,
  parent: SceneNode | null,
  diagnostics: Diagnostic[],
  frameRate: number,
): PagxChannel | null {
  const transformSamples = readTransformSamples(node, parent, diagnostics);
  const sizeSamples = readSizeSamples(node, diagnostics);
  const hasTransform = hasTransformAnimation(transformSamples);
  const hasSize = hasSizeAnimation(sizeSamples);
  if (!hasTransform && !hasSize) {
    return null;
  }

  const bakePerFrame = shouldBakeMatrixPerFrame(node, transformSamples, sizeSamples);
  const sampleMatrixFloat = bakePerFrame ? sampleFloatAtEased : sampleFloatAt;
  const sampleTimes = buildMatrixSampleTimes(node, transformSamples, sizeSamples, frameRate);
  const rotationBinding = node.animations.ROTATION;
  const rotationBase = resolveRotationBase();
  const rotationDirection = resolveRotationDirection(node);
  const rotationPresetType = resolveRotationPresetType(node);
  const usesSetRotation = hasSetRotationAnimation(node);
  const setRotationOrigin = usesSetRotation && rotationBinding
    ? readSetRotationOrigin(rotationBinding)
    : null;
  const setTranslationOrigin = hasSetTranslationAnimation(node)
    ? readSetTranslationOrigin(node, transformSamples)
    : null;
  const transformOrder = resolveMatrixTransformOrder(node, transformSamples);

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
        translationX = sampleMatrixFloat(transformSamples.translationX, time);
      }
      if (transformSamples.translationY.length > 0) {
        translationY = sampleMatrixFloat(transformSamples.translationY, time);
      }
    }

    if (setTranslationOrigin) {
      translationX -= setTranslationOrigin.x;
      translationY -= setTranslationOrigin.y;
    }

    let scaleX = 1;
    let scaleY = 1;
    if (transformSamples.scaleXY.length > 0) {
      const vector = sampleVectorAt(transformSamples.scaleXY, time);
      scaleX = vector.x;
      scaleY = vector.y;
    } else {
      scaleX = sampleMatrixFloat(transformSamples.scaleX, time);
      scaleY = sampleMatrixFloat(transformSamples.scaleY, time);
    }

    const sizeScale = resolveScaleFromSizeSamples(sizeSamples, time);
    scaleX *= sizeScale.scaleX;
    scaleY *= sizeScale.scaleY;

    let rotationSample = sampleMatrixFloat(transformSamples.rotation, time);
    if (setRotationOrigin !== null) {
      rotationSample -= setRotationOrigin;
    }

    const rotation = figmaRotationDegreesToPagx(
      applyRotationDirection(
        rotationSample,
        rotationDirection,
        rotationBase,
      ),
      rotationPresetType,
      rotationDirection,
      usesSetRotation,
    );
    const pivot = resolveRotationPivot(node, sizeSamples, time, scaleX, scaleY);
    const matrix = transformOrder.length > 0
      ? affineMatrixToString(composeAffineMatrixFromTransformOrder(
        transformOrder,
        translationX,
        translationY,
        scaleX,
        scaleY,
        rotation,
        pivot.x,
        pivot.y,
      ))
      : (pagxMotionMatrixStringFromComponents(
        translationX,
        translationY,
        rotation,
        scaleX,
        scaleY,
        pivot.x,
        pivot.y,
      ) ?? '1,0,0,1,0,0');

    const keyframe: PagxKeyframe = {
      time: secondsToFrame(time, frameRate),
      value: matrix,
    };
    if (!bakePerFrame) {
      const easing = matrixKeyframeEasingAtTime(transformSamples, sizeSamples, time);
      if (easing && time !== sampleTimes[sampleTimes.length - 1]) {
        Object.assign(keyframe, mapEasing(easing, diagnostics, node.id));
      }
    }
    keyframes.push(keyframe);
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

function keyframesFromFloatSamples(
  samples: FloatSample[],
  nodeId: string,
  diagnostics: Diagnostic[],
  mapValue: (value: number) => number,
  frameRate: number,
): PagxKeyframe[] {
  return samples.map((sample, index) => {
    const keyframe: PagxKeyframe = {
      time: secondsToFrame(sample.time, frameRate),
      value: String(roundDimension(mapValue(sample.value))),
    };
    if (index < samples.length - 1) {
      Object.assign(keyframe, mapEasing(sample.easing, diagnostics, nodeId));
    }
    return keyframe;
  });
}

function buildFloatSamplesChannel(
  name: string,
  samples: FloatSample[],
  nodeId: string,
  diagnostics: Diagnostic[],
  mapValue: (value: number) => number,
  frameRate: number,
): PagxChannel | null {
  if (!isAnimatedFloat(samples)) {
    return null;
  }
  return {
    name,
    type: 'float',
    keyframes: keyframesFromFloatSamples(samples, nodeId, diagnostics, mapValue, frameRate),
  };
}

function buildSizeScaleChannels(
  samples: ReturnType<typeof readSizeSamples>,
  nodeId: string,
  diagnostics: Diagnostic[],
  frameRate: number,
): PagxChannel[] {
  const channels: PagxChannel[] = [];
  if (samples.baseWidth > 0) {
    const scaleX = buildFloatSamplesChannel(
      'scale.x',
      samples.width,
      nodeId,
      diagnostics,
      (value) => value / samples.baseWidth,
      frameRate,
    );
    if (scaleX) {
      channels.push(scaleX);
    }
  }
  if (samples.baseHeight > 0) {
    const scaleY = buildFloatSamplesChannel(
      'scale.y',
      samples.height,
      nodeId,
      diagnostics,
      (value) => value / samples.baseHeight,
      frameRate,
    );
    if (scaleY) {
      channels.push(scaleY);
    }
  }
  return channels;
}

function buildGroupTransformChannels(
  node: MotionCapableNode,
  parent: SceneNode | null,
  diagnostics: Diagnostic[],
  frameRate: number,
): PagxChannel[] {
  const transformSamples = readTransformSamples(node, parent, diagnostics);
  const channels: PagxChannel[] = [];
  const sizeSamples = readSizeSamples(node, diagnostics);
  const pivot = resolveRotationPivot(node, sizeSamples, 0, 1, 1);
  const rotationBinding = node.animations.ROTATION;
  const rotationDirection = resolveRotationDirection(node);
  const rotationPresetType = resolveRotationPresetType(node);
  const usesSetRotation = hasSetRotationAnimation(node);
  const setRotationOrigin = usesSetRotation && rotationBinding
    ? readSetRotationOrigin(rotationBinding)
    : null;
  const setTranslationOrigin = hasSetTranslationAnimation(node)
    ? readSetTranslationOrigin(node, transformSamples)
    : null;

  if (transformSamples.translationXY.length > 0 && isAnimatedVector(transformSamples.translationXY)) {
    const xSamples = transformSamples.translationXY.map((sample) => ({
      time: sample.time,
      value: sample.x,
      easing: sample.easing,
    }));
    const ySamples = transformSamples.translationXY.map((sample) => ({
      time: sample.time,
      value: sample.y,
      easing: sample.easing,
    }));
    const originX = setTranslationOrigin?.x ?? 0;
    const originY = setTranslationOrigin?.y ?? 0;
    channels.push({
      name: 'position.x',
      type: 'float',
      keyframes: keyframesFromFloatSamples(xSamples, node.id, diagnostics, (value) => pivot.x + value - originX, frameRate),
    });
    channels.push({
      name: 'position.y',
      type: 'float',
      keyframes: keyframesFromFloatSamples(ySamples, node.id, diagnostics, (value) => pivot.y + value - originY, frameRate),
    });
  } else {
    const originX = setTranslationOrigin?.x ?? 0;
    const originY = setTranslationOrigin?.y ?? 0;
    const positionX = buildFloatSamplesChannel(
      'position.x',
      transformSamples.translationX,
      node.id,
      diagnostics,
      (value) => pivot.x + value - originX,
      frameRate,
    );
    if (positionX) {
      channels.push(positionX);
    }
    const positionY = buildFloatSamplesChannel(
      'position.y',
      transformSamples.translationY,
      node.id,
      diagnostics,
      (value) => pivot.y + value - originY,
      frameRate,
    );
    if (positionY) {
      channels.push(positionY);
    }
  }

  const rotation = buildFloatSamplesChannel(
    'rotation',
    transformSamples.rotation,
    node.id,
    diagnostics,
    (value) => {
      const relativeValue = setRotationOrigin !== null ? value - setRotationOrigin : value;
      return figmaRotationDegreesToPagx(
        applyRotationDirection(relativeValue, rotationDirection, 0),
        rotationPresetType,
        rotationDirection,
        usesSetRotation,
      );
    },
    frameRate,
  );
  if (rotation) {
    channels.push(rotation);
  }

  if (transformSamples.scaleXY.length > 0 && isAnimatedVector(transformSamples.scaleXY)) {
    const xSamples = transformSamples.scaleXY.map((sample) => ({
      time: sample.time,
      value: sample.x,
      easing: sample.easing,
    }));
    const ySamples = transformSamples.scaleXY.map((sample) => ({
      time: sample.time,
      value: sample.y,
      easing: sample.easing,
    }));
    channels.push({
      name: 'scale.x',
      type: 'float',
      keyframes: keyframesFromFloatSamples(xSamples, node.id, diagnostics, (value) => value, frameRate),
    });
    channels.push({
      name: 'scale.y',
      type: 'float',
      keyframes: keyframesFromFloatSamples(ySamples, node.id, diagnostics, (value) => value, frameRate),
    });
  } else {
    const scaleX = buildFloatSamplesChannel('scale.x', transformSamples.scaleX, node.id, diagnostics, (value) => value, frameRate);
    if (scaleX) {
      channels.push(scaleX);
    }
    const scaleY = buildFloatSamplesChannel('scale.y', transformSamples.scaleY, node.id, diagnostics, (value) => value, frameRate);
    if (scaleY) {
      channels.push(scaleY);
    }
  }

  for (const channel of buildSizeScaleChannels(sizeSamples, node.id, diagnostics, frameRate)) {
    if (!channels.some((item) => item.name === channel.name)) {
      channels.push(channel);
    }
  }

  return channels;
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
    for (const effectAnimation of Object.values(node.animations.effects ?? {})) {
      const binding = effectAnimation?.RADIUS;
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
    for (const effectAnimation of Object.values(node.animations.effects ?? {})) {
      maxDuration = Math.max(maxDuration, collectTimes(effectAnimation?.RADIUS));
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

export function resolveRotationDirectionFromPropsForTest(
  props: Record<string, unknown>,
): RotationDirection | null {
  return readRotationDirectionFromProps(props);
}

export function resolvePagxRotationDegreesForTest(
  degrees: number,
  direction: RotationDirection | null,
  baseDegrees: number,
  presetType: RotationPresetType | null = null,
  usesSetRotation = false,
): number {
  return figmaRotationDegreesToPagx(
    applyRotationDirection(degrees, direction, baseDegrees),
    presetType,
    direction,
    usesSetRotation,
  );
}

export function resolveRotationBaseForTest(_binding: KeyframeBinding | undefined): number {
  return resolveRotationBase();
}

export function shouldBakeMatrixPerFrameForTest(
  node: MotionCapableNode,
  transformSamples: ReturnType<typeof readTransformSamples>,
): boolean {
  return shouldBakeMatrixPerFrame(node, transformSamples);
}

export function buildMatrixChannelForTest(
  node: MotionCapableNode,
  parent: SceneNode | null = null,
  frameRate: number = MOTION_FRAME_RATE,
): PagxChannel | null {
  return buildMatrixChannel(node, parent, [], frameRate);
}

export function springProgressForTest(progress: number, bounce: number): number {
  return springProgress(progress, bounce);
}

export function sampleFloatAtEasedForTest(samples: FloatSample[], time: number): number {
  return sampleFloatAtEased(samples, time);
}

export function collectFloatSamplesForTest(
  binding: KeyframeBinding,
  translationContext?: TranslationSampleContext,
): FloatSample[] {
  return collectFloatSamples(binding, translationContext);
}

export function resolveMatrixTransformOrderForTest(
  node: MotionCapableNode,
  transformSamples: ReturnType<typeof readTransformSamples>,
): MatrixTransformStep[] {
  return resolveMatrixTransformOrder(node, transformSamples);
}

export function composeMotionMatrixForTest(
  order: MatrixTransformStep[],
  translationX: number,
  translationY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number,
  pivotX: number,
  pivotY: number,
): string {
  return affineMatrixToString(composeAffineMatrixFromTransformOrder(
    order,
    translationX,
    translationY,
    scaleX,
    scaleY,
    rotationDegrees,
    pivotX,
    pivotY,
  ));
}

export function readFigmaTranslationSpanForTest(
  node: MotionCapableNode,
  parent: SceneNode | null = null,
): { x: number; y: number } | null {
  return readPagxTranslationSpan(node, parent);
}

export function resolveMatrixTranslationForTest(
  node: MotionCapableNode,
  transformSamples: ReturnType<typeof readTransformSamples>,
  time: number,
): { x: number; y: number } {
  let translationX = 0;
  let translationY = 0;
  if (transformSamples.translationXY.length > 0) {
    const vector = sampleVectorAt(transformSamples.translationXY, time);
    translationX = vector.x;
    translationY = vector.y;
  } else {
    if (transformSamples.translationX.length > 0) {
      translationX = sampleFloatAt(transformSamples.translationX, time);
    }
    if (transformSamples.translationY.length > 0) {
      translationY = sampleFloatAt(transformSamples.translationY, time);
    }
  }

  if (hasSetTranslationAnimation(node)) {
    const origin = readSetTranslationOrigin(node, transformSamples);
    translationX -= origin.x;
    translationY -= origin.y;
  }

  return { x: translationX, y: translationY };
}

export function readTransformSamplesForTest(
  node: MotionCapableNode,
  parent: SceneNode | null = null,
  diagnostics: Diagnostic[] = [],
): ReturnType<typeof readTransformSamples> {
  return readTransformSamples(node, parent, diagnostics);
}

export type PagMotionFrame = {
  frame: number;
  /** Parent-space position of the layer transform anchor. */
  positionX: number;
  positionY: number;
  /** Transform scale only — Figma WIDTH/HEIGHT is NOT folded in here. */
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  /** Layout content size at this frame (for Shape size animation). */
  contentWidth: number;
  contentHeight: number;
};

export type PagMotionResult = {
  frames: PagMotionFrame[];
  durationFrames: number;
  /**
   * True when Figma WIDTH/HEIGHT is animated.
   * PAGX maps this to matrix scale from the layer origin (top-left);
   * PAG should animate Shape size with layer anchor at (0,0), not center scale.
   */
  sizeAnimated: boolean;
};

/**
 * Bake motion transform/opacity/size samples for PAG export.
 * - Transform scale/rotation/translation → Transform2D
 * - Figma size (WIDTH/HEIGHT) → contentWidth/Height (caller animates Shape.size)
 * - When sizeAnimated, position is top-left based (anchor should be 0,0)
 */
export function collectPagMotionFrames(
  node: SceneNode,
  parent: SceneNode | null,
  width: number,
  height: number,
  layoutLeft: number,
  layoutTop: number,
  diagnostics: Diagnostic[],
  frameRate: number = MOTION_FRAME_RATE,
): PagMotionResult | null {
  if (!isMotionNode(node)) {
    return null;
  }

  const pivot = motionPivotForExport(node, width, height);
  const transformSamples = readTransformSamples(node, parent, diagnostics);
  const sizeSamples = readSizeSamples(node, diagnostics);
  const hasTransform = hasTransformAnimation(transformSamples);
  const sizeAnimated = hasSizeAnimation(sizeSamples);
  const opacityBinding = node.animations.OPACITY;
  const opacitySamples = opacityBinding
    ? collectFloatSamples(opacityBinding, undefined, motionStyleTimelineOffset(node, 'OPACITY'))
    : [];
  const hasOpacity = opacitySamples.length > 0 && isAnimatedFloat(opacitySamples);

  if (!hasTransform && !sizeAnimated && !hasOpacity) {
    return null;
  }

  const bakePerFrame = shouldBakeMatrixPerFrame(node, transformSamples, sizeSamples) || hasOpacity;
  const sampleFloat = bakePerFrame ? sampleFloatAtEased : sampleFloatAt;
  const endSeconds = Math.max(
    maxTransformKeyframeSeconds(transformSamples, sizeSamples),
    opacitySamples.length > 0 ? opacitySamples[opacitySamples.length - 1].time : 0,
  );
  const durationFrames = Math.max(1, Math.ceil(endSeconds * frameRate));
  const sampleTimes = bakePerFrame
    ? Array.from({ length: durationFrames + 1 }, (_, frame) => frame / frameRate)
    : mergeSampleTimes([
      transformSamples.sampleTimes,
      sizeSamples.sampleTimes,
      collectSampleTimes(opacitySamples),
    ]);

  const rotationBinding = node.animations.ROTATION;
  const rotationBase = resolveRotationBase();
  const rotationDirection = resolveRotationDirection(node);
  const rotationPresetType = resolveRotationPresetType(node);
  const usesSetRotation = hasSetRotationAnimation(node);
  const setRotationOrigin = usesSetRotation && rotationBinding
    ? readSetRotationOrigin(rotationBinding)
    : null;
  const baseOpacity = 'opacity' in node ? node.opacity : 1;

  const frames: PagMotionFrame[] = [];

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
    // Intentionally NOT folding WIDTH/HEIGHT into scale — that caused center-scale.
    // Size is exposed as contentWidth/Height for Shape.size animation.

    let contentWidth = width;
    let contentHeight = height;
    if (sizeAnimated) {
      if (sizeSamples.width.length > 0) {
        contentWidth = sampleFloat(sizeSamples.width, time);
      }
      if (sizeSamples.height.length > 0) {
        contentHeight = sampleFloat(sizeSamples.height, time);
      }
    }

    let rotationSample = sampleFloat(transformSamples.rotation, time);
    if (setRotationOrigin !== null) {
      rotationSample -= setRotationOrigin;
    }
    const rotation = figmaRotationDegreesToPagx(
      applyRotationDirection(rotationSample, rotationDirection, rotationBase),
      rotationPresetType,
      rotationDirection,
      usesSetRotation,
    );

    const opacity = hasOpacity
      ? sampleFloat(opacitySamples, time)
      : baseOpacity;

    // Size anim: top-left origin (matches PAGX matrix scale-from-origin).
    // Otherwise: center pivot (matches rotation/scale transform group).
    const positionX = sizeAnimated
      ? layoutLeft + translationX
      : layoutLeft + pivot.x + translationX;
    const positionY = sizeAnimated
      ? layoutTop + translationY
      : layoutTop + pivot.y + translationY;

    frames.push({
      frame: Math.round(time * frameRate),
      positionX,
      positionY,
      scaleX,
      scaleY,
      rotation,
      opacity,
      contentWidth,
      contentHeight,
    });
  }

  return { frames, durationFrames, sizeAnimated };
}

export function collectMotionAnimations(
  root: SceneNode,
  layerIdByFigmaId: Map<string, string>,
  motionTargetIdByFigmaId: Map<string, string>,
  diagnostics: Diagnostic[],
  frameRate: number = MOTION_FRAME_RATE,
  effectTargetIdByFigmaId: Map<string, string> = new Map(),
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
  const durationFrames = Math.max(1, Math.ceil(durationSeconds * frameRate));

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
    objects.push(...buildBlurChannels(node, effectTargetIdByFigmaId, diagnostics, frameRate));
    const alpha = buildAlphaChannel(node, diagnostics, frameRate);
    if (alpha) {
      objects.push({ target: targetId, channels: [alpha] });
    }

    const motionTargetId = motionTargetIdByFigmaId.get(node.id);
    const transformChannels = motionTargetId
      ? buildGroupTransformChannels(node, parent, diagnostics, frameRate)
      : [];
    if (motionTargetId && transformChannels.length > 0) {
      objects.push({ target: motionTargetId, channels: transformChannels });
      continue;
    }

    const matrix = buildMatrixChannel(node, parent, diagnostics, frameRate);
    if (matrix) {
      objects.push({ target: targetId, channels: [matrix] });
    }
  }

  if (objects.length === 0) {
    return [];
  }

  return [{
    id: MOTION_ANIMATION_ID,
    duration: durationFrames,
    frameRate,
    loop: 'once',
    objects,
  }];
}

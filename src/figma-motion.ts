import type { IrDiagnostic, IrEasing, IrProperty, IrTrack, TrackSource } from './ir-types';

const supportedProperties: Partial<Record<KeyframePropertyFieldName, IrProperty>> = {
  HEIGHT: 'size.height',
  OPACITY: 'opacity',
  ROTATION: 'rotation',
  SCALE_X: 'scale.x',
  SCALE_Y: 'scale.y',
  TRANSLATION_X: 'translation.x',
  TRANSLATION_Y: 'translation.y',
  WIDTH: 'size.width',
};

export function hasMotion(node: BaseNode): node is SceneNode & MotionNodeMixin {
  return 'animations' in node;
}

export function getNumberValue(value: KeyframeValue): number | undefined {
  if (value.type !== 'FLOAT') {
    return undefined;
  }

  return value.value;
}

export function getOperation(operation: ManualKeyframeTrack['keyframeOperation']): IrTrack['operation'] {
  if (operation === 'OFFSET') {
    return 'relative';
  }

  if (operation === 'SCALE') {
    return 'scale';
  }

  return 'absolute';
}

export function isNoopTrack(operation: IrTrack['operation'], baseValue: number | undefined, values: number[]): boolean {
  if (values.length === 0) {
    return true;
  }

  const [firstValue] = values;
  const hasSameValue = values.every((value) => value === firstValue);

  if (!hasSameValue) {
    return false;
  }

  if (operation === 'relative') {
    return firstValue === 0;
  }

  if (operation === 'absolute') {
    return baseValue !== undefined && firstValue === baseValue;
  }

  return firstValue === 1;
}

export function toIrEasing(easing: MotionEasing | VariableAlias | undefined): IrEasing | undefined {
  if (!easing || easing.type === 'VARIABLE_ALIAS') {
    return undefined;
  }

  if (easing.type === 'CUSTOM_CUBIC_BEZIER' && easing.easingFunctionCubicBezier) {
    const bezier = easing.easingFunctionCubicBezier;
    return { type: 'cubicBezier', x1: bezier.x1, y1: bezier.y1, x2: bezier.x2, y2: bezier.y2 };
  }

  if (easing.type === 'CUSTOM_SPRING' && easing.easingFunctionSpring) {
    return { type: 'spring', bounce: easing.easingFunctionSpring.bounce };
  }

  if (easing.type === 'LINEAR') {
    return { type: 'linear' };
  }

  return { type: 'figma', name: easing.type };
}

export function findStyleSource(track: ManualKeyframeTrack, styles: readonly AppliedAnimationStyle[]): TrackSource {
  const preset = getTrackPreset(track);
  const presetId = getStringField(preset, 'id');
  const matchedStyle = presetId ? styles.find((style) => style.id === presetId) : undefined;
  const fallbackStyle = styles.length === 1 ? styles[0] : undefined;
  const style = matchedStyle ?? fallbackStyle;

  return {
    timelineOffset: getNumberField(preset, 'timelineOffset') ?? style?.timelineOffset ?? 0,
    duration: getNumberField(preset, 'duration') ?? style?.duration,
    animationStyleId: presetId ?? style?.id,
    animationStyleName: getStringField(preset, 'name') ?? style?.name,
  };
}

export function findTimelineId(node: SceneNode & MotionNodeMixin, binding: KeyframeBinding): string {
  const timeline = node.timelines.find((item) => item.duration === binding.timelineDuration) ?? node.timelines[0];
  return timeline?.id ?? `${node.id}:timeline`;
}

export function getTrackDuration(track: ManualKeyframeTrack, source: TrackSource): number {
  if (source.duration !== undefined) {
    return source.duration;
  }

  if (track.keyframes.length === 0) {
    return 0;
  }

  const times = track.keyframes.map((keyframe) => keyframe.timelinePosition);
  return Math.max(...times) - Math.min(...times);
}

export function toIrTrack(
  property: KeyframePropertyFieldName,
  binding: KeyframeBinding,
  track: ManualKeyframeTrack,
  diagnostics: IrDiagnostic[],
  nodeId: string,
): IrTrack | undefined {
  const irProperty = supportedProperties[property];

  if (!irProperty) {
    diagnostics.push({
      level: 'warning',
      code: 'UNSUPPORTED_PROPERTY',
      message: `暂不支持属性 ${property}`,
      nodeId,
      property,
      sourceTrackId: track.id,
    });
    return undefined;
  }

  const baseValue = getNumberValue(binding.baseValue);
  const keyframes = [];

  for (const keyframe of track.keyframes) {
    const value = getNumberValue(keyframe.value);

    if (value === undefined) {
      diagnostics.push({
        level: 'warning',
        code: 'UNSUPPORTED_KEYFRAME_VALUE',
        message: `暂不支持 ${property} 的非数字关键帧`,
        nodeId,
        property,
        sourceTrackId: track.id,
      });
      return undefined;
    }

    keyframes.push({
      time: keyframe.timelinePosition,
      value,
      easing: toIrEasing(keyframe.easing),
    });
  }

  const operation = getOperation(track.keyframeOperation);

  if (isNoopTrack(operation, baseValue, keyframes.map((keyframe) => keyframe.value))) {
    diagnostics.push({
      level: 'info',
      code: 'NOOP_TRACK_IGNORED',
      message: `忽略无变化轨道 ${property}`,
      nodeId,
      property,
      sourceTrackId: track.id,
    });
    return undefined;
  }

  return {
    property: irProperty,
    operation,
    baseValue,
    keyframes,
    source: {
      property,
      trackId: track.id,
    },
  };
}

function getObjectValue(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function getTrackPreset(track: ManualKeyframeTrack): Record<string, unknown> | undefined {
  return getObjectValue((track as unknown as Record<string, unknown>).animationPreset);
}

function getNumberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const field = value?.[key];
  return typeof field === 'number' ? field : undefined;
}

function getStringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === 'string' ? field : undefined;
}

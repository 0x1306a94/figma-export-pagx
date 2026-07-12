/** Figma SceneNode → PagFile IR (shared reader/motion, PAG-specific mapping). */

import type { Diagnostic } from '../types';
import { roundDimension } from '../color';
import {
  addDiagnostic,
  geometryPathData,
  hasImageFill,
  isContainerNode,
  isGeometryNode,
  nodePositionInParent,
  readCornerRadius,
} from '../figma-reader';
import {
  MOTION_FRAME_RATE,
  collectPagMotionFrames,
  isMotionNode,
  motionLayoutPositionForExport,
  motionLayoutSizeForExport,
  motionPivotForExport,
  type PagMotionResult,
} from '../figma-motion';
import { canonicalizePathData, svgPathToPagPathData } from '../path-detect';
import { exportLayerName, parseSolidMarker } from '../solid-marker';
import { encodePagFile } from './encode/encode-file';
import { makeEllipse, makeRectangle, makeSolidFill, makeSolidStroke } from './encode/encode-shapes';
import { ensureImageBytes, scaleFromImagePaint } from './image-bytes';
import {
  buildTextDocument,
  pointTextAnchorPosition,
  textLayoutModeFromAutoResize,
} from './text-document';
import {
  BlendMode,
  ColorBlack,
  ColorWhite,
  DEFAULT_RATIO,
  KeyframeInterpolationType,
  LayerType,
  MaskMode,
  OPAQUE,
  PagBlurDimensions,
  PagEffect,
  PagFile,
  PagImageBytes,
  PagKeyframe,
  PagLayer,
  PagLayerStyle,
  PagMaskData,
  PagPathData,
  PagPoint,
  PagProperty,
  PagShapeElement,
  PagShapeLayer,
  PagTransform2D,
  PagVectorComposition,
  PathVerb,
  staticProperty,
  defaultTransform2D,
} from './types';

export type PagExportContext = {
  diagnostics: Diagnostic[];
  nodeCount: number;
  nextLayerId: number;
  nextCompositionId: number;
  nextImageId: number;
  nextMaskId: number;
  compositions: PagVectorComposition[];
  images: PagImageBytes[];
  imageIdByHash: Map<string, number>;
  fonts: Array<{ fontFamily: string; fontStyle: string }>;
  fontKeys: Set<string>;
  durationFrames: number;
  frameRate: number;
  encodeWebp?: (bytes: Uint8Array) => Promise<Uint8Array>;
};

export type PagExportResult = {
  bytes: Uint8Array;
  file: PagFile;
  diagnostics: Diagnostic[];
  nodeCount: number;
  width: number;
  height: number;
};

function createPagExportContext(
  frameRate: number = MOTION_FRAME_RATE,
  encodeWebp?: (bytes: Uint8Array) => Promise<Uint8Array>,
): PagExportContext {
  return {
    diagnostics: [],
    nodeCount: 0,
    nextLayerId: 1,
    nextCompositionId: 1,
    nextImageId: 1,
    nextMaskId: 1,
    compositions: [],
    images: [],
    imageIdByHash: new Map(),
    fonts: [],
    fontKeys: new Set(),
    durationFrames: 1,
    frameRate,
    encodeWebp,
  };
}

function allocLayerId(ctx: PagExportContext): number {
  const id = ctx.nextLayerId;
  ctx.nextLayerId += 1;
  return id;
}

function allocCompositionId(ctx: PagExportContext): number {
  const id = ctx.nextCompositionId;
  ctx.nextCompositionId += 1;
  return id;
}

function allocMaskId(ctx: PagExportContext): number {
  const id = ctx.nextMaskId;
  ctx.nextMaskId += 1;
  return id;
}

function opacityToPag(opacity: number): number {
  return Math.round(Math.max(0, Math.min(1, opacity)) * 255);
}

function normalizedDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function roundEffectValue(value: number): number {
  return Math.round(value * 10000) / 10000;
}

type EffectRadiusSample = {
  frame: number;
  value: number;
  easing: MotionEasing | VariableAlias;
};

function pagEffectEasing(
  easing: MotionEasing | VariableAlias,
  diagnostics: Diagnostic[],
  nodeId: string,
): Pick<PagKeyframe<number>, 'interpolationType' | 'bezierOut' | 'bezierIn'> {
  if (easing.type === 'VARIABLE_ALIAS') {
    addDiagnostic(
      diagnostics,
      'warning',
      'PAG_EFFECT_VARIABLE_EASING_FALLBACK',
      'PAG 效果动画暂不支持变量 easing，已降级为 Linear',
      nodeId,
    );
    return { interpolationType: KeyframeInterpolationType.Linear };
  }

  const bezier = (x1: number, y1: number, x2: number, y2: number) => ({
    interpolationType: KeyframeInterpolationType.Bezier,
    bezierOut: [{ x: x1, y: y1 }],
    bezierIn: [{ x: x2, y: y2 }],
  });
  switch (easing.type) {
    case 'HOLD':
      return { interpolationType: KeyframeInterpolationType.Hold };
    case 'CUSTOM_CUBIC_BEZIER': {
      const curve = easing.easingFunctionCubicBezier;
      return curve
        ? bezier(curve.x1, curve.y1, curve.x2, curve.y2)
        : { interpolationType: KeyframeInterpolationType.Linear };
    }
    case 'EASE_IN': return bezier(0.42, 0, 1, 1);
    case 'EASE_OUT': return bezier(0, 0, 0.58, 1);
    case 'EASE_IN_AND_OUT': return bezier(0.42, 0, 0.58, 1);
    case 'EASE_IN_BACK': return bezier(0.36, 0, 0.66, -0.56);
    case 'EASE_OUT_BACK': return bezier(0.34, 1.56, 0.64, 1);
    case 'EASE_IN_AND_OUT_BACK': return bezier(0.68, -0.6, 0.32, 1.6);
    case 'GENTLE': return bezier(0.4, 0, 0.2, 1);
    case 'QUICK': return bezier(0.4, 0, 1, 1);
    case 'BOUNCY': return bezier(0.34, 1.56, 0.64, 1);
    case 'SLOW': return bezier(0, 0, 0.2, 1);
    case 'CUSTOM_SPRING':
      addDiagnostic(
        diagnostics,
        'warning',
        'PAG_EFFECT_SPRING_EASING_FALLBACK',
        'PAG 效果动画暂不支持 Spring easing，已降级为 Linear',
        nodeId,
      );
      return { interpolationType: KeyframeInterpolationType.Linear };
    case 'LINEAR':
    default:
      return { interpolationType: KeyframeInterpolationType.Linear };
  }
}

function animatedEffectRadius(
  node: SceneNode,
  effectIndex: number,
  fallbackRadius: number,
  diagnostics: Diagnostic[],
  frameRate: number,
): { property: PagProperty<number>; durationFrames: number } {
  if (!isMotionNode(node)) {
    return { property: staticProperty(fallbackRadius), durationFrames: 0 };
  }
  const binding = node.animations.effects?.[effectIndex]?.RADIUS;
  if (!binding) {
    return { property: staticProperty(fallbackRadius), durationFrames: 0 };
  }

  const baseValue = binding.baseValue.type === 'FLOAT'
    ? binding.baseValue.value
    : fallbackRadius;
  const samples: EffectRadiusSample[] = [];
  for (const track of binding.tracks) {
    if (!['SET', 'OFFSET', 'SCALE'].includes(track.keyframeOperation)) {
      addDiagnostic(
        diagnostics,
        'warning',
        'PAG_EFFECT_KEYFRAME_OP_FALLBACK',
        `PAG 模糊动画暂不支持 ${track.keyframeOperation} 轨道`,
        node.id,
      );
      continue;
    }
    for (const keyframe of track.keyframes) {
      if (keyframe.value.type !== 'FLOAT') {
        continue;
      }
      let value = keyframe.value.value;
      if (track.keyframeOperation === 'OFFSET') {
        value = baseValue + value;
      } else if (track.keyframeOperation === 'SCALE') {
        value = baseValue * value;
      }
      samples.push({
        frame: Math.max(0, Math.round(keyframe.timelinePosition * frameRate)),
        value: Math.max(0, value),
        easing: keyframe.easing,
      });
    }
  }
  samples.sort((left, right) => left.frame - right.frame);
  const deduped = samples.filter((sample, index) => (
    index === samples.length - 1 || sample.frame !== samples[index + 1].frame
  ));
  if (deduped.length < 2) {
    return {
      property: staticProperty(deduped[0]?.value ?? fallbackRadius),
      durationFrames: deduped[0]?.frame ?? 0,
    };
  }
  if (deduped[0].frame > 0) {
    deduped.unshift({
      frame: 0,
      value: baseValue,
      easing: { type: 'LINEAR' },
    });
  }

  const keyframes: PagKeyframe<number>[] = [];
  for (let index = 0; index < deduped.length - 1; index += 1) {
    const start = deduped[index];
    const end = deduped[index + 1];
    keyframes.push({
      startTime: start.frame,
      endTime: end.frame,
      startValue: start.value,
      endValue: end.value,
      ...pagEffectEasing(start.easing, diagnostics, node.id),
    });
  }
  return {
    property: { animatable: true, keyframes },
    durationFrames: deduped[deduped.length - 1].frame,
  };
}

export function mapNodeEffects(
  node: SceneNode,
  diagnostics: Diagnostic[],
  frameRate: number = MOTION_FRAME_RATE,
): { effects: PagEffect[]; layerStyles: PagLayerStyle[]; durationFrames: number } {
  const effects: PagEffect[] = [];
  const layerStyles: PagLayerStyle[] = [];
  let durationFrames = 0;
  if (!('effects' in node)) {
    return { effects, layerStyles, durationFrames };
  }

  for (const [effectIndex, effect] of node.effects.entries()) {
    if (effect.visible === false) {
      continue;
    }
    if (effect.type === 'LAYER_BLUR') {
      if ('blurType' in effect && effect.blurType === 'PROGRESSIVE') {
        addDiagnostic(
          diagnostics,
          'warning',
          'PAG_PROGRESSIVE_BLUR_FALLBACK',
          'PAG 不支持渐进模糊，已降级为均匀模糊',
          node.id,
        );
      }
      const radius = animatedEffectRadius(
        node,
        effectIndex,
        Math.max(0, effect.radius),
        diagnostics,
        frameRate,
      );
      durationFrames = Math.max(durationFrames, radius.durationFrames);
      effects.push({
        kind: 'fastBlur',
        blurriness: radius.property,
        blurDimensions: staticProperty(PagBlurDimensions.All),
        repeatEdgePixels: staticProperty(true),
        effectOpacity: staticProperty(OPAQUE),
      });
      continue;
    }
    if (effect.type === 'DROP_SHADOW') {
      const offsetX = Number.isFinite(effect.offset.x) ? effect.offset.x : 0;
      const offsetY = Number.isFinite(effect.offset.y) ? effect.offset.y : 0;
      const distance = Math.hypot(offsetX, offsetY);
      const angle = distance === 0
        ? 0
        : normalizedDegrees((Math.atan2(-offsetY, offsetX) * 180) / Math.PI + 180);
      const figmaSpread = Math.max(0, effect.spread ?? 0);
      const size = Math.max(0, effect.radius) + figmaSpread;
      if (effect.blendMode !== 'NORMAL') {
        addDiagnostic(
          diagnostics,
          'warning',
          'PAG_DROP_SHADOW_BLEND_MODE_FALLBACK',
          `PAG 阴影暂不支持混合模式 ${effect.blendMode}，已降级为 Normal`,
          node.id,
        );
      }
      layerStyles.push({
        kind: 'dropShadow',
        blendMode: staticProperty(BlendMode.Normal),
        color: staticProperty({
          red: Math.round(effect.color.r * 255),
          green: Math.round(effect.color.g * 255),
          blue: Math.round(effect.color.b * 255),
        }),
        opacity: staticProperty(opacityToPag(effect.color.a)),
        angle: staticProperty(roundEffectValue(angle)),
        distance: staticProperty(roundEffectValue(distance)),
        size: staticProperty(roundEffectValue(size)),
        spread: staticProperty(roundEffectValue(size > 0 ? figmaSpread / size : 0)),
      });
      continue;
    }
    addDiagnostic(
      diagnostics,
      'warning',
      'PAG_UNSUPPORTED_EFFECT',
      `PAG 暂不支持效果 ${effect.type}`,
      node.id,
    );
  }
  if (effects.length > 0 && layerStyles.length > 0) {
    addDiagnostic(
      diagnostics,
      'warning',
      'PAG_EFFECT_ORDER_DIFFERENCE',
      'PAG 会先合成图层样式再应用图层效果，可能与 Figma 的效果顺序不同',
      node.id,
    );
  }
  return { effects, layerStyles, durationFrames };
}

function parseHexColor(hex: string): { color: { red: number; green: number; blue: number }; opacity: number } {
  const raw = hex.replace('#', '');
  if (raw.length === 6 || raw.length === 8) {
    const red = Number.parseInt(raw.slice(0, 2), 16);
    const green = Number.parseInt(raw.slice(2, 4), 16);
    const blue = Number.parseInt(raw.slice(4, 6), 16);
    const opacity = raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) : 255;
    return { color: { red, green, blue }, opacity };
  }
  return { color: ColorBlack, opacity: OPAQUE };
}

function solidFromPaint(paint: Paint): { color: { red: number; green: number; blue: number }; opacity: number } | null {
  if (paint.type !== 'SOLID' || paint.visible === false) {
    return null;
  }
  const alpha = paint.opacity ?? 1;
  return {
    color: {
      red: Math.round(paint.color.r * 255),
      green: Math.round(paint.color.g * 255),
      blue: Math.round(paint.color.b * 255),
    },
    opacity: opacityToPag(alpha),
  };
}

export function mapFigmaBlendMode(mode: SolidPaint['blendMode'], nodeName: string): BlendMode {
  switch (mode) {
    case 'NORMAL': return BlendMode.Normal;
    case 'MULTIPLY': return BlendMode.Multiply;
    case 'SCREEN': return BlendMode.Screen;
    case 'OVERLAY': return BlendMode.Overlay;
    case 'DARKEN': return BlendMode.Darken;
    case 'LIGHTEN': return BlendMode.Lighten;
    case 'COLOR_DODGE': return BlendMode.ColorDodge;
    case 'COLOR_BURN': return BlendMode.ColorBurn;
    case 'HARD_LIGHT': return BlendMode.HardLight;
    case 'SOFT_LIGHT': return BlendMode.SoftLight;
    case 'DIFFERENCE': return BlendMode.Difference;
    case 'EXCLUSION': return BlendMode.Exclusion;
    case 'HUE': return BlendMode.Hue;
    case 'SATURATION': return BlendMode.Saturation;
    case 'COLOR': return BlendMode.Color;
    case 'LUMINOSITY': return BlendMode.Luminosity;
    case 'LINEAR_DODGE': return BlendMode.Add;
    default:
      throw new Error(`PAG 不支持图层「${nodeName}」的填充混合模式 ${mode}`);
  }
}

function blendModeFromPaint(paint: SolidPaint | ImagePaint, node: SceneNode): BlendMode {
  return mapFigmaBlendMode(paint.blendMode ?? 'NORMAL', node.name);
}

function svgToPagPath(data: string): PagPathData {
  const parsed = svgPathToPagPathData(data);
  const verbs: PathVerb[] = [];
  for (const verb of parsed.verbs) {
    if (verb === 'move') verbs.push(PathVerb.MoveTo);
    else if (verb === 'line') verbs.push(PathVerb.LineTo);
    else if (verb === 'cubic') verbs.push(PathVerb.CurveTo);
    else verbs.push(PathVerb.Close);
  }
  return { verbs, points: parsed.points };
}

function resolvedSize(node: SceneNode): { width: number; height: number } {
  const motionSize = motionLayoutSizeForExport(node);
  const width = motionSize?.width
    ?? ('width' in node ? roundDimension(node.width) : 0);
  const height = motionSize?.height
    ?? ('height' in node ? roundDimension(node.height) : 0);
  return { width, height };
}

function layoutLeftTop(node: SceneNode, parent: SceneNode | null): { left: number; top: number } {
  const motionPos = motionLayoutPositionForExport(node, parent);
  if (typeof motionPos.left === 'number' && typeof motionPos.top === 'number') {
    return { left: Number(motionPos.left), top: Number(motionPos.top) };
  }
  const pos = nodePositionInParent(node, parent);
  return { left: pos.left ?? 0, top: pos.top ?? 0 };
}

function keyframesFromValues<T>(
  frames: Array<{ frame: number; value: T }>,
): PagProperty<T> {
  if (frames.length === 0) {
    throw new Error('keyframesFromValues requires at least one frame');
  }
  if (frames.length === 1) {
    return staticProperty(frames[0].value);
  }
  const keyframes: PagKeyframe<T>[] = [];
  for (let i = 0; i < frames.length - 1; i += 1) {
    keyframes.push({
      startTime: frames[i].frame,
      endTime: frames[i + 1].frame,
      startValue: frames[i].value,
      endValue: frames[i + 1].value,
      interpolationType: KeyframeInterpolationType.Linear,
    });
  }
  return { animatable: true, keyframes };
}

function buildTransform(
  node: SceneNode,
  parent: SceneNode | null,
  width: number,
  height: number,
  ctx: PagExportContext,
  motion: PagMotionResult | null,
): PagTransform2D {
  const { left, top } = parent ? layoutLeftTop(node, parent) : { left: 0, top: 0 };
  const pivot = motionPivotForExport(node, width, height);
  const sizeAnimated = motion?.sizeAnimated ?? false;
  const staticPosition = sizeAnimated
    ? { x: left, y: top }
    : { x: left + pivot.x, y: top + pivot.y };
  const staticAnchor = sizeAnimated ? { x: 0, y: 0 } : { x: pivot.x, y: pivot.y };
  const staticOpacity = opacityToPag('opacity' in node ? node.opacity : 1);

  if (!motion || motion.frames.length === 0) {
    return defaultTransform2D({
      anchorPoint: staticAnchor,
      position: staticPosition,
      opacity: staticOpacity,
    });
  }

  ctx.durationFrames = Math.max(ctx.durationFrames, motion.durationFrames);

  return {
    anchorPoint: staticProperty(staticAnchor),
    position: keyframesFromValues(
      motion.frames.map((frame) => ({
        frame: frame.frame,
        value: { x: frame.positionX, y: frame.positionY },
      })),
    ),
    scale: keyframesFromValues(
      motion.frames.map((frame) => ({
        frame: frame.frame,
        value: { x: frame.scaleX, y: frame.scaleY },
      })),
    ),
    rotation: keyframesFromValues(
      motion.frames.map((frame) => ({
        frame: frame.frame,
        value: frame.rotation,
      })),
    ),
    opacity: keyframesFromValues(
      motion.frames.map((frame) => ({
        frame: frame.frame,
        value: opacityToPag(frame.opacity),
      })),
    ),
  };
}

function readMotionForNode(
  node: SceneNode,
  parent: SceneNode | null,
  width: number,
  height: number,
  ctx: PagExportContext,
): PagMotionResult | null {
  const { left, top } = parent ? layoutLeftTop(node, parent) : { left: 0, top: 0 };
  const motion = collectPagMotionFrames(
    node,
    parent,
    width,
    height,
    left,
    top,
    ctx.diagnostics,
    ctx.frameRate,
  );
  if (motion) {
    ctx.durationFrames = Math.max(ctx.durationFrames, motion.durationFrames);
  }
  return motion;
}

function applySizeAnimationToContents(
  contents: PagShapeElement[],
  motion: PagMotionResult,
): PagShapeElement[] {
  if (!motion.sizeAnimated) {
    return contents;
  }

  const sizeProperty = keyframesFromValues(
    motion.frames.map((frame) => ({
      frame: frame.frame,
      value: { x: frame.contentWidth, y: frame.contentHeight },
    })),
  );
  const positionProperty = keyframesFromValues(
    motion.frames.map((frame) => ({
      frame: frame.frame,
      value: { x: frame.contentWidth / 2, y: frame.contentHeight / 2 },
    })),
  );

  return contents.map((element) => {
    if (element.kind === 'rectangle') {
      return {
        ...element,
        size: sizeProperty,
        position: positionProperty,
      };
    }
    if (element.kind === 'ellipse') {
      return {
        ...element,
        size: sizeProperty,
        position: positionProperty,
      };
    }
    if (element.kind === 'path') {
      // Path has no size property; fall back to layer-origin scale like PAGX matrix.
      // Caller should also set Transform2D.scale from content size ratios when needed.
      return element;
    }
    return element;
  });
}

/** When path + size anim: fold size into Transform2D.scale from top-left (PAGX matrix behavior). */
function scaleFromSizeFrames(motion: PagMotionResult, baseWidth: number, baseHeight: number): PagTransform2D['scale'] {
  return keyframesFromValues(
    motion.frames.map((frame) => ({
      frame: frame.frame,
      value: {
        x: baseWidth > 0 ? frame.contentWidth / baseWidth : 1,
        y: baseHeight > 0 ? frame.contentHeight / baseHeight : 1,
      },
    })),
  );
}

/** Fold Figma WIDTH/HEIGHT animation into PAG Transform2D.scale. */
export function scaleFromMotionAndSizeFrames(
  motion: PagMotionResult,
  baseWidth: number,
  baseHeight: number,
): PagTransform2D['scale'] {
  return keyframesFromValues(
    motion.frames.map((frame) => ({
      frame: frame.frame,
      value: {
        x: frame.scaleX * (baseWidth > 0 ? frame.contentWidth / baseWidth : 1),
        y: frame.scaleY * (baseHeight > 0 ? frame.contentHeight / baseHeight : 1),
      },
    })),
  );
}

function layerBase(
  node: SceneNode,
  parent: SceneNode | null,
  width: number,
  height: number,
  ctx: PagExportContext,
  motion: PagMotionResult | null = null,
  nameOverride?: string,
): Omit<PagShapeLayer, 'type' | 'contents'> {
  const resolvedMotion = motion ?? readMotionForNode(node, parent, width, height, ctx);
  const mappedEffects = mapNodeEffects(node, ctx.diagnostics, ctx.frameRate);
  ctx.durationFrames = Math.max(ctx.durationFrames, mappedEffects.durationFrames);
  return {
    id: allocLayerId(ctx),
    name: nameOverride ?? exportLayerName(node.name),
    isActive: !('visible' in node) || node.visible !== false,
    autoOrientation: false,
    parentId: null,
    stretch: { ...DEFAULT_RATIO },
    startTime: 0,
    duration: Math.max(1, ctx.durationFrames),
    blendMode: BlendMode.Normal,
    trackMatteType: 0,
    transform: buildTransform(node, parent, width, height, ctx, resolvedMotion),
    masks: [],
    effects: mappedEffects.effects,
    layerStyles: mappedEffects.layerStyles,
  };
}

function shapeContentsFromNode(
  node: SceneNode,
  ctx: PagExportContext,
): PagShapeElement[] {
  const contents: PagShapeElement[] = [];
  const size = resolvedSize(node);
  const nodeId = node.id;

  if (node.type === 'RECTANGLE') {
    const roundness = readCornerRadius(node, nodeId, ctx.diagnostics);
    contents.push(...makeRectangle(size.width, size.height, roundness));
  } else if (node.type === 'ELLIPSE') {
    contents.push(...makeEllipse(size.width, size.height));
  } else if (
    node.type === 'VECTOR'
    || node.type === 'BOOLEAN_OPERATION'
    || node.type === 'STAR'
    || node.type === 'POLYGON'
    || node.type === 'LINE'
  ) {
    const pathData = geometryPathData(node);
    if (!pathData) {
      addDiagnostic(ctx.diagnostics, 'warning', 'EMPTY_PATH', '节点缺少可导出的路径数据', nodeId);
    } else {
      const shape = canonicalizePathData(pathData);
      if (shape.kind === 'rectangle') {
        contents.push(...makeRectangle(shape.width, shape.height, shape.roundness ?? 0));
      } else if (shape.kind === 'ellipse') {
        contents.push(...makeEllipse(shape.width, shape.height));
      } else {
        contents.push({
          kind: 'path',
          shapePath: staticProperty(svgToPagPath(shape.data)),
        });
      }
    }
  } else if (isContainerNode(node) && 'width' in node && 'height' in node) {
    const fills = 'fills' in node ? node.fills : [];
    const strokes = 'strokes' in node ? node.strokes : [];
    const hasPaint = (Array.isArray(fills) && fills.length > 0)
      || (Array.isArray(strokes) && strokes.length > 0);
    if (hasPaint) {
      contents.push(...makeRectangle(size.width, size.height));
    }
  }

  if ('fills' in node && Array.isArray(node.fills)) {
    for (const paint of node.fills) {
      const solid = solidFromPaint(paint);
      if (solid) {
        contents.push(makeSolidFill(solid.color, solid.opacity));
      } else if (paint.type !== 'IMAGE' && paint.visible !== false) {
        addDiagnostic(
          ctx.diagnostics,
          'warning',
          'UNSUPPORTED_PAINT',
          `PAG 导出暂仅支持纯色填充，已跳过 ${paint.type}`,
          nodeId,
        );
      }
    }
  }

  if ('strokes' in node && 'strokeWeight' in node && Array.isArray(node.strokes)) {
    const weight = typeof node.strokeWeight === 'number' ? node.strokeWeight : 0;
    if (weight > 0) {
      for (const paint of node.strokes) {
        const solid = solidFromPaint(paint);
        if (solid) {
          contents.push(makeSolidStroke(solid.color, roundDimension(weight), solid.opacity));
        }
      }
    }
  }

  return contents;
}

function registerFont(ctx: PagExportContext, fontFamily: string, fontStyle: string): void {
  const key = `${fontFamily}|${fontStyle}`;
  if (ctx.fontKeys.has(key)) {
    return;
  }
  ctx.fontKeys.add(key);
  ctx.fonts.push({ fontFamily, fontStyle });
}

function mapTextLayer(
  node: TextNode,
  parent: SceneNode | null,
  ctx: PagExportContext,
): PagLayer {
  ctx.nodeCount += 1;
  const size = resolvedSize(node);
  const base = layerBase(node, parent, size.width, size.height, ctx);
  const fontFamily = node.fontName === figma.mixed ? 'Inter' : node.fontName.family;
  const fontStyle = node.fontName === figma.mixed ? 'Regular' : (node.fontName.style || 'Regular');
  const fontSize = node.fontSize === figma.mixed ? 12 : roundDimension(node.fontSize as number);
  registerFont(ctx, fontFamily, fontStyle);

  let fillColor = ColorBlack;
  let fillOpacity = OPAQUE;
  if (Array.isArray(node.fills)) {
    for (const paint of node.fills) {
      const solid = solidFromPaint(paint);
      if (solid) {
        fillColor = solid.color;
        fillOpacity = solid.opacity;
        break;
      }
    }
  }

  const mode = textLayoutModeFromAutoResize(node.textAutoResize);
  if (mode === 'point') {
    if (base.transform.position.animatable) {
      addDiagnostic(
        ctx.diagnostics,
        'warning',
        'TEXT_POINT_MOTION',
        '点文本含位移动画时暂不覆盖基线锚点，仍用中心锚点采样',
        node.id,
      );
    } else {
      const { left, top } = parent ? layoutLeftTop(node, parent) : { left: 0, top: 0 };
      const align =
        typeof node.textAlignHorizontal === 'string' ? node.textAlignHorizontal : 'LEFT';
      const override = pointTextAnchorPosition({
        left,
        top,
        width: size.width,
        height: size.height,
        fontSize,
        align,
      });
      base.transform.anchorPoint = staticProperty(override.anchor);
      base.transform.position = staticProperty(override.position);
    }
  }

  const sourceText = buildTextDocument(node, size, ctx.diagnostics, fillColor);

  // Text color opacity goes into layer opacity if not already animated
  if (fillOpacity < OPAQUE && base.transform.opacity.animatable === false) {
    const layerOpacity = Math.round((base.transform.opacity.value / 255) * (fillOpacity / 255) * 255);
    base.transform.opacity = staticProperty(layerOpacity);
  }

  return {
    ...base,
    type: LayerType.Text,
    sourceText,
  };
}

function multiplyScaleProperty(
  motionScale: PagProperty<PagPoint>,
  contentScale: PagPoint,
): PagProperty<PagPoint> {
  if (motionScale.animatable === false) {
    return staticProperty({
      x: motionScale.value.x * contentScale.x,
      y: motionScale.value.y * contentScale.y,
    });
  }
  return {
    animatable: true,
    keyframes: motionScale.keyframes.map((keyframe) => ({
      ...keyframe,
      startValue: {
        x: keyframe.startValue.x * contentScale.x,
        y: keyframe.startValue.y * contentScale.y,
      },
      endValue: {
        x: keyframe.endValue.x * contentScale.x,
        y: keyframe.endValue.y * contentScale.y,
      },
    })),
  };
}

async function mapImageLayer(
  node: SceneNode & MinimalFillsMixin,
  parent: SceneNode | null,
  ctx: PagExportContext,
  imagePaintOverride?: ImagePaint,
): Promise<PagLayer | null> {
  if (!hasImageFill(node.fills) || node.fills === figma.mixed || !Array.isArray(node.fills)) {
    return null;
  }

  const imageFills = imagePaintOverride ? [imagePaintOverride] : node.fills.filter(
    (paint): paint is ImagePaint => paint.type === 'IMAGE' && paint.visible !== false,
  );
  if (imageFills.length === 0) {
    return null;
  }
  if (imageFills.length > 1) {
    addDiagnostic(
      ctx.diagnostics,
      'warning',
      'IMAGE_MULTI_FILL',
      `节点有 ${imageFills.length} 个 IMAGE fill，仅导出第一个`,
      node.id,
    );
  }

  const imagePaint = imageFills[0];
  if (!imagePaint.imageHash) {
    addDiagnostic(ctx.diagnostics, 'warning', 'IMAGE_MISSING_HASH', 'IMAGE fill 缺少 imageHash', node.id);
    return null;
  }

  try {
    const image = await ensureImageBytes(imagePaint.imageHash, ctx, node.id);
    const size = resolvedSize(node);
    const contentScale = scaleFromImagePaint(
      imagePaint,
      size.width,
      size.height,
      image.width,
      image.height,
      ctx.diagnostics,
      node.id,
    );

    ctx.nodeCount += 1;
    // layerBase uses node box for position (node center in parent); override footage anchor/scale.
    const base = layerBase(node, parent, size.width, size.height, ctx);
    base.transform.anchorPoint = staticProperty({
      x: image.width / 2,
      y: image.height / 2,
    });
    base.transform.scale = multiplyScaleProperty(base.transform.scale, contentScale);

    return {
      ...base,
      blendMode: blendModeFromPaint(imagePaint, node),
      type: LayerType.Image,
      imageId: image.id,
    };
  } catch (error) {
    addDiagnostic(
      ctx.diagnostics,
      'warning',
      'IMAGE_EXPORT_FAILED',
      `图片导出失败: ${error instanceof Error ? error.message : String(error)}`,
      node.id,
    );
    return null;
  }
}

function maskPathFromNode(node: SceneNode, ctx: PagExportContext): PagPathData | null {
  const size = resolvedSize(node);
  if (node.type === 'RECTANGLE') {
    const w = size.width;
    const h = size.height;
    return {
      verbs: [PathVerb.MoveTo, PathVerb.LineTo, PathVerb.LineTo, PathVerb.LineTo, PathVerb.Close],
      points: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
    };
  }
  if (node.type === 'ELLIPSE') {
    // Approximate ellipse as path via geometry if available
    const pathData = 'fillGeometry' in node ? geometryPathData(node as GeometryMixin) : '';
    if (pathData) {
      return svgToPagPath(pathData);
    }
  }
  if ('fillGeometry' in node || 'strokeGeometry' in node) {
    const pathData = geometryPathData(node as GeometryMixin);
    if (pathData) {
      return svgToPagPath(pathData);
    }
  }
  addDiagnostic(ctx.diagnostics, 'warning', 'MASK_PATH_EMPTY', '遮罩节点无可用路径', node.id);
  return null;
}

function isMaskNode(node: SceneNode): node is SceneNode & { isMask: boolean; maskType: MaskType } {
  return 'isMask' in node && Boolean((node as { isMask?: boolean }).isMask);
}

function visiblePaints(paints: readonly Paint[] | PluginAPI['mixed']): Paint[] {
  if (!Array.isArray(paints)) {
    return [];
  }
  return paints.filter((paint) => paint.visible !== false);
}

function solidEligibleGeometry(node: SceneNode): { width: number; height: number } | null {
  const size = resolvedSize(node);
  if (node.type === 'RECTANGLE') {
    return size;
  }
  if (
    node.type === 'VECTOR'
    || node.type === 'BOOLEAN_OPERATION'
    || node.type === 'STAR'
    || node.type === 'POLYGON'
  ) {
    const pathData = geometryPathData(node);
    if (!pathData) {
      return null;
    }
    const shape = canonicalizePathData(pathData);
    if (shape.kind === 'rectangle' && !(shape.roundness && shape.roundness > 0)) {
      return { width: shape.width, height: shape.height };
    }
  }
  return null;
}

function assertSolidEligible(node: SceneNode, exportName: string): {
  width: number;
  height: number;
  solidColor: { red: number; green: number; blue: number };
  fillOpacity: number;
  fillBlendMode: BlendMode;
} {
  const label = exportName || node.name;
  const geometry = solidEligibleGeometry(node);
  if (!geometry || geometry.width <= 0 || geometry.height <= 0) {
    throw new Error(
      `#solid 图层「${label}」必须是轴对齐直角矩形（无圆角），当前类型=${node.type}`,
    );
  }

  if (node.type === 'RECTANGLE') {
    const radius = readCornerRadius(node, node.id, []);
    if (radius > 0) {
      throw new Error(`#solid 图层「${label}」不能有圆角（当前 radius=${radius}）`);
    }
  }

  const fills = visiblePaints('fills' in node ? node.fills : []);
  if (fills.length !== 1) {
    throw new Error(`#solid 图层「${label}」需要恰好 1 个可见填充（当前 ${fills.length} 个）`);
  }
  const solid = solidFromPaint(fills[0]);
  if (!solid) {
    throw new Error(`#solid 图层「${label}」填充必须是纯色（不能是渐变/图片）`);
  }

  const strokes = visiblePaints('strokes' in node ? node.strokes : []);
  const strokeWeight = 'strokeWeight' in node && typeof node.strokeWeight === 'number'
    ? node.strokeWeight
    : 0;
  if (strokes.length > 0 && strokeWeight > 0) {
    throw new Error(`#solid 图层「${label}」不能有描边`);
  }

  return {
    width: geometry.width,
    height: geometry.height,
    solidColor: solid.color,
    fillOpacity: solid.opacity,
    fillBlendMode: mapFigmaBlendMode((fills[0] as SolidPaint).blendMode ?? 'NORMAL', label),
  };
}

function mapSolidLayer(
  node: SceneNode,
  parent: SceneNode | null,
  ctx: PagExportContext,
  exportName: string,
): PagLayer {
  const eligible = assertSolidEligible(node, exportName);
  ctx.nodeCount += 1;
  const motion = readMotionForNode(node, parent, eligible.width, eligible.height, ctx);

  const base = layerBase(
    node,
    parent,
    eligible.width,
    eligible.height,
    ctx,
    motion,
    exportName,
  );
  base.blendMode = eligible.fillBlendMode;
  if (motion?.sizeAnimated) {
    base.transform.scale = scaleFromMotionAndSizeFrames(
      motion,
      eligible.width,
      eligible.height,
    );
  }

  // Bake fill opacity into layer opacity (Solid color is RGB only).
  if (eligible.fillOpacity < OPAQUE) {
    const ratio = eligible.fillOpacity / 255;
    const opacity = base.transform.opacity;
    if (opacity.animatable === false) {
      base.transform.opacity = staticProperty(Math.round(opacity.value * ratio));
    } else {
      base.transform.opacity = {
        animatable: true,
        keyframes: opacity.keyframes.map((keyframe) => ({
          ...keyframe,
          startValue: Math.round(keyframe.startValue * ratio),
          endValue: Math.round(keyframe.endValue * ratio),
        })),
      };
    }
  }

  return {
    ...base,
    type: LayerType.Solid,
    solidColor: eligible.solidColor,
    width: eligible.width,
    height: eligible.height,
  };
}

function canMapFillToSolidLayer(node: SceneNode): boolean {
  const geometry = solidEligibleGeometry(node);
  if (!geometry || geometry.width <= 0 || geometry.height <= 0) {
    return false;
  }
  if (node.type === 'RECTANGLE' && readCornerRadius(node, node.id, []) > 0) {
    return false;
  }
  return true;
}

function mapSolidPaintLayer(
  node: SceneNode,
  ctx: PagExportContext,
  paint: SolidPaint,
): PagLayer {
  const size = resolvedSize(node);
  const solid = solidFromPaint(paint)!;
  return {
    id: allocLayerId(ctx),
    name: exportLayerName(node.name),
    isActive: true,
    autoOrientation: false,
    parentId: null,
    stretch: { ...DEFAULT_RATIO },
    startTime: 0,
    duration: Math.max(1, ctx.durationFrames),
    blendMode: blendModeFromPaint(paint, node),
    trackMatteType: 0,
    transform: defaultTransform2D({
      anchorPoint: { x: size.width / 2, y: size.height / 2 },
      position: { x: size.width / 2, y: size.height / 2 },
      opacity: solid.opacity,
    }),
    masks: [],
    effects: [],
    layerStyles: [],
    type: LayerType.Solid,
    solidColor: solid.color,
    width: size.width,
    height: size.height,
  };
}

async function mapImagePaintLayer(
  node: SceneNode,
  ctx: PagExportContext,
  paint: ImagePaint,
): Promise<PagLayer> {
  if (!paint.imageHash) {
    throw new Error(`图层「${node.name}」的 IMAGE fill 缺少 imageHash`);
  }
  const image = await ensureImageBytes(paint.imageHash, ctx, node.id);
  const size = resolvedSize(node);
  const contentScale = scaleFromImagePaint(
    paint,
    size.width,
    size.height,
    image.width,
    image.height,
    ctx.diagnostics,
    node.id,
  );
  return {
    id: allocLayerId(ctx),
    name: exportLayerName(node.name),
    isActive: true,
    autoOrientation: false,
    parentId: null,
    stretch: { ...DEFAULT_RATIO },
    startTime: 0,
    duration: Math.max(1, ctx.durationFrames),
    blendMode: blendModeFromPaint(paint, node),
    trackMatteType: 0,
    transform: defaultTransform2D({
      anchorPoint: { x: image.width / 2, y: image.height / 2 },
      position: { x: size.width / 2, y: size.height / 2 },
      scale: contentScale,
      opacity: opacityToPag(paint.opacity ?? 1),
    }),
    masks: [],
    effects: [],
    layerStyles: [],
    type: LayerType.Image,
    imageId: image.id,
  };
}

function mapShapePaintLayer(
  node: SceneNode,
  ctx: PagExportContext,
  paint: SolidPaint,
): PagLayer {
  const size = resolvedSize(node);
  const solid = solidFromPaint(paint)!;
  return {
    id: allocLayerId(ctx),
    name: exportLayerName(node.name),
    isActive: true,
    autoOrientation: false,
    parentId: null,
    stretch: { ...DEFAULT_RATIO },
    startTime: 0,
    duration: Math.max(1, ctx.durationFrames),
    blendMode: blendModeFromPaint(paint, node),
    trackMatteType: 0,
    transform: defaultTransform2D({
      anchorPoint: { x: size.width / 2, y: size.height / 2 },
      position: { x: size.width / 2, y: size.height / 2 },
    }),
    masks: [],
    effects: [],
    layerStyles: [],
    type: LayerType.Shape,
    contents: [
      ...shapeContentsFromNode(node, ctx).filter(
        (element) => element.kind !== 'fill' && element.kind !== 'stroke',
      ),
      makeSolidFill(solid.color, solid.opacity),
    ],
  };
}

async function mapGeometryLayers(
  node: SceneNode,
  parent: SceneNode | null,
  ctx: PagExportContext,
): Promise<PagLayer[]> {
  const solidMarker = parseSolidMarker(node.name);
  if (solidMarker.isSolid) {
    return [mapSolidLayer(node, parent, ctx, solidMarker.exportName)];
  }

  const fills = 'fills' in node && Array.isArray(node.fills)
    ? node.fills.filter((paint) => paint.visible !== false)
    : [];
  const supportedFills = fills.filter(
    (paint): paint is SolidPaint | ImagePaint => paint.type === 'SOLID' || paint.type === 'IMAGE',
  );
  if (supportedFills.length > 1) {
    const size = resolvedSize(node);
    const motion = readMotionForNode(node, parent, size.width, size.height, ctx);
    const layers: PagLayer[] = [];
    for (const paint of supportedFills) {
      if (paint.type === 'IMAGE') {
        layers.push(await mapImagePaintLayer(node, ctx, paint));
        continue;
      }

      ctx.nodeCount += 1;
      if (canMapFillToSolidLayer(node)) {
        layers.push(mapSolidPaintLayer(node, ctx, paint));
        continue;
      }
      layers.push(mapShapePaintLayer(node, ctx, paint));
    }

    // PAG stores top-most layers first. Figma fills are bottom-to-top.
    layers.reverse();
    const compositionId = allocCompositionId(ctx);
    ctx.compositions.push({
      id: compositionId,
      width: Math.max(1, Math.round(size.width)),
      height: Math.max(1, Math.round(size.height)),
      duration: Math.max(1, ctx.durationFrames),
      frameRate: ctx.frameRate,
      backgroundColor: ColorWhite,
      layers,
    });

    ctx.nodeCount += 1;
    const base = layerBase(node, parent, size.width, size.height, ctx, motion);
    if (motion?.sizeAnimated) {
      base.transform.scale = scaleFromMotionAndSizeFrames(motion, size.width, size.height);
    }
    return [{
      ...base,
      type: LayerType.PreCompose,
      compositionId,
      compositionStartTime: 0,
    }];
  }

  if (supportedFills.some((paint) => paint.type === 'IMAGE')) {
    const imageLayer = await mapImageLayer(
      node as SceneNode & MinimalFillsMixin,
      parent,
      ctx,
    );
    return imageLayer ? [imageLayer] : [];
  }

  ctx.nodeCount += 1;
  const size = resolvedSize(node);
  const motion = readMotionForNode(node, parent, size.width, size.height, ctx);
  const base = layerBase(node, parent, size.width, size.height, ctx, motion);
  let contents = shapeContentsFromNode(node, ctx);
  if (contents.length === 0) {
    addDiagnostic(ctx.diagnostics, 'warning', 'EMPTY_SHAPE', '形状层无内容，已跳过', node.id);
    return [];
  }

  if (motion?.sizeAnimated) {
    const hasSizedShape = contents.some(
      (element) => element.kind === 'rectangle' || element.kind === 'ellipse',
    );
    if (hasSizedShape) {
      contents = applySizeAnimationToContents(contents, motion);
    } else {
      // Path-only: match PAGX matrix scale-from-origin
      base.transform.scale = scaleFromSizeFrames(motion, size.width, size.height);
    }
  }

  return [{
    ...base,
    type: LayerType.Shape,
    contents,
  }];
}

async function mapContainerAsComposition(
  node: SceneNode & ChildrenMixin,
  ctx: PagExportContext,
): Promise<{ compositionId: number; width: number; height: number }> {
  const size = resolvedSize(node);
  const compositionId = allocCompositionId(ctx);
  const layers: PagLayer[] = [];

  // Own fill/stroke as a shape layer at origin
  const selfContents = shapeContentsFromNode(node, ctx);
  const hasSelfPaint = selfContents.some(
    (element) => element.kind === 'fill' || element.kind === 'stroke',
  );
  if (hasSelfPaint) {
    ctx.nodeCount += 1;
    layers.push({
      id: allocLayerId(ctx),
      name: exportLayerName(node.name),
      isActive: true,
      autoOrientation: false,
      parentId: null,
      stretch: { ...DEFAULT_RATIO },
      startTime: 0,
      duration: Math.max(1, ctx.durationFrames),
      blendMode: BlendMode.Normal,
      trackMatteType: 0,
      transform: defaultTransform2D({
        anchorPoint: { x: size.width / 2, y: size.height / 2 },
        position: { x: size.width / 2, y: size.height / 2 },
      }),
      masks: [],
      effects: [],
      layerStyles: [],
      type: LayerType.Shape,
      contents: selfContents,
    });
  }

  let pendingMask: PagMaskData | null = null;
  const children = [...node.children];
  for (const child of children) {
    if (isMaskNode(child)) {
      if (child.maskType && child.maskType !== 'ALPHA') {
        addDiagnostic(
          ctx.diagnostics,
          'warning',
          'MASK_APPROXIMATION',
          `Figma maskType=${child.maskType} 无法完全对齐 PAG MaskData，已用路径 + Add 近似`,
          child.id,
        );
      }
      const path = maskPathFromNode(child, ctx);
      if (path) {
        const { left, top } = layoutLeftTop(child, node);
        // Offset path into parent composition space
        const offsetPoints = path.points.map((point) => ({
          x: point.x + left,
          y: point.y + top,
        }));
        pendingMask = {
          id: allocMaskId(ctx),
          inverted: false,
          maskMode: MaskMode.Add,
          maskPath: staticProperty({ verbs: path.verbs, points: offsetPoints }),
          maskOpacity: staticProperty(OPAQUE),
          maskExpansion: staticProperty(0),
        };
      }
      continue;
    }

    const mappedLayers = await mapNodeToLayers(child, node, ctx);
    if (mappedLayers.length === 0) {
      continue;
    }
    if (pendingMask) {
      for (const mapped of mappedLayers) {
        mapped.masks = [...mapped.masks, pendingMask];
      }
    }
    layers.push(...mappedLayers);
  }

  // PAG draws first layer at bottom; Figma children[0] is top → reverse
  layers.reverse();

  ctx.compositions.push({
    id: compositionId,
    width: Math.max(1, Math.round(size.width)),
    height: Math.max(1, Math.round(size.height)),
    duration: Math.max(1, ctx.durationFrames),
    frameRate: ctx.frameRate,
    backgroundColor: ColorWhite,
    layers,
  });

  return { compositionId, width: size.width, height: size.height };
}

async function mapNodeToLayers(
  node: SceneNode,
  parent: SceneNode | null,
  ctx: PagExportContext,
): Promise<PagLayer[]> {
  if (node.type === 'SLICE') {
    return [];
  }

  if (isContainerNode(node)) {
    const nested = await mapContainerAsComposition(node, ctx);
    ctx.nodeCount += 1;
    const base = layerBase(node, parent, nested.width, nested.height, ctx);
    return [{
      ...base,
      type: LayerType.PreCompose,
      compositionId: nested.compositionId,
      compositionStartTime: 0,
    }];
  }

  if (node.type === 'TEXT') {
    return [mapTextLayer(node, parent, ctx)];
  }

  if (isGeometryNode(node)) {
    return mapGeometryLayers(node, parent, ctx);
  }

  addDiagnostic(
    ctx.diagnostics,
    'warning',
    'UNSUPPORTED_NODE',
    `跳过不支持的节点类型 ${node.type}`,
    node.id,
  );
  return [];
}

function finalizeDurations(ctx: PagExportContext): void {
  const duration = Math.max(1, ctx.durationFrames);
  for (const composition of ctx.compositions) {
    composition.duration = duration;
    for (const layer of composition.layers) {
      layer.duration = duration;
    }
  }
}

export async function mapFigmaToPag(root: SceneNode, ctx: PagExportContext): Promise<PagFile> {
  const width = roundDimension(
    'width' in root ? root.width : 1,
  );
  const height = roundDimension(
    'height' in root ? root.height : 1,
  );

  // First pass: if root has motion, expand duration early
  if (isMotionNode(root)) {
    const motion = collectPagMotionFrames(root, null, width, height, 0, 0, ctx.diagnostics, ctx.frameRate);
    if (motion) {
      ctx.durationFrames = Math.max(ctx.durationFrames, motion.durationFrames);
    }
  }

  const mainId = allocCompositionId(ctx);
  const layers: PagLayer[] = [];

  if (isContainerNode(root)) {
    // Root composition IS the container content (not wrapped in PreCompose)
    const nested = await mapContainerAsComposition(root, ctx);
    // mapContainerAsComposition already pushed a composition — use it as main by moving to end
    const created = ctx.compositions.find((item) => item.id === nested.compositionId);
    if (created) {
      // Remove and re-add as last (main)
      ctx.compositions = ctx.compositions.filter((item) => item.id !== nested.compositionId);
      created.id = mainId;
      ctx.compositions.push(created);
    }
  } else if (root.type === 'TEXT') {
    const layer = mapTextLayer(root, null, ctx);
    // 点文本已在 mapTextLayer 按基线放置；框文本 root 仍用中心锚点对齐 composition
    if (
      !layer.transform.position.animatable
      && layer.type === LayerType.Text
      && layer.sourceText.boxText
    ) {
      const pivot = motionPivotForExport(root, width, height);
      layer.transform.position = staticProperty({ x: pivot.x, y: pivot.y });
      layer.transform.anchorPoint = staticProperty({ x: pivot.x, y: pivot.y });
    }
    layers.push(layer);
    ctx.compositions.push({
      id: mainId,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      duration: Math.max(1, ctx.durationFrames),
      frameRate: ctx.frameRate,
      backgroundColor: ColorWhite,
      layers,
    });
  } else if (isGeometryNode(root)) {
    const rootLayers = await mapNodeToLayers(root, null, ctx);
    for (const layer of rootLayers) {
      // Root layer at origin
      if (layer.transform.position.animatable === false) {
        const pivot = motionPivotForExport(root, width, height);
        layer.transform.position = staticProperty({ x: pivot.x, y: pivot.y });
        layer.transform.anchorPoint = staticProperty({ x: pivot.x, y: pivot.y });
      }
      layers.push(layer);
    }
    layers.reverse();
    ctx.compositions.push({
      id: mainId,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      duration: Math.max(1, ctx.durationFrames),
      frameRate: ctx.frameRate,
      backgroundColor: ColorWhite,
      layers,
    });
  } else {
    addDiagnostic(ctx.diagnostics, 'error', 'UNSUPPORTED_ROOT', `不支持的 root 节点类型 ${root.type}`, root.id);
    ctx.compositions.push({
      id: mainId,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      duration: 1,
      frameRate: ctx.frameRate,
      backgroundColor: ColorWhite,
      layers: [],
    });
  }

  finalizeDurations(ctx);

  return {
    compositions: ctx.compositions,
    images: ctx.images,
    fonts: ctx.fonts,
  };
}

export async function exportPag(
  root: SceneNode,
  options?: { frameRate?: number; encodeWebp?: (bytes: Uint8Array) => Promise<Uint8Array> },
): Promise<PagExportResult> {
  const frameRate = options?.frameRate ?? MOTION_FRAME_RATE;
  const ctx = createPagExportContext(frameRate, options?.encodeWebp);
  const file = await mapFigmaToPag(root, ctx);
  const bytes = encodePagFile(file);
  const main = file.compositions[file.compositions.length - 1];
  return {
    bytes,
    file,
    diagnostics: ctx.diagnostics,
    nodeCount: ctx.nodeCount,
    width: main?.width ?? 0,
    height: main?.height ?? 0,
  };
}

// Re-export helpers used by tests
export { encodePagFile, createPagExportContext, opacityToPag, svgToPagPath, keyframesFromValues };
export type { PagPoint };

/** PAG IR types aligned with libpag include/pag/file.h (v1 subset). */

export const PAG_VERSION = 1;
export const OPAQUE = 255;
export const SPATIAL_PRECISION = 0.05;
export const BEZIER_PRECISION = 0.005;
export const LENGTH_FOR_STORE_NUM_BITS = 5;
export const DEFAULT_RATIO: PagRatio = { numerator: 1, denominator: 1 };

export type PagPoint = { x: number; y: number };
export type PagColor = { red: number; green: number; blue: number };
export type PagRatio = { numerator: number; denominator: number };
export type PagOpacity = number; // 0–255

export const PointZero: PagPoint = { x: 0, y: 0 };
export const PointOne: PagPoint = { x: 1, y: 1 };
export const ColorRed: PagColor = { red: 255, green: 0, blue: 0 };
export const ColorBlack: PagColor = { red: 0, green: 0, blue: 0 };
export const ColorWhite: PagColor = { red: 255, green: 255, blue: 255 };

export enum LayerType {
  Unknown = 0,
  Null = 1,
  Solid = 2,
  Text = 3,
  Shape = 4,
  Image = 5,
  PreCompose = 6,
  Camera = 7,
}

export enum MaskMode {
  None = 0,
  Add = 1,
  Subtract = 2,
  Intersect = 3,
  Lighten = 4,
  Darken = 5,
  Difference = 6,
  Accum = 7,
}

export enum BlendMode {
  Normal = 0,
}

export enum PagBlurDimensions {
  All = 0,
  Horizontal = 1,
  Vertical = 2,
}

export enum TrackMatteType {
  None = 0,
}

export enum CompositeOrder {
  BelowPreviousInSameGroup = 0,
  AbovePreviousInSameGroup = 1,
}

export enum FillRule {
  NonZeroWinding = 0,
  EvenOdd = 1,
}

export enum LineCap {
  Butt = 0,
  Round = 1,
  Square = 2,
}

export enum LineJoin {
  Miter = 0,
  Round = 1,
  Bevel = 2,
}

export enum KeyframeInterpolationType {
  None = 0,
  Linear = 1,
  Bezier = 2,
  Hold = 3,
}

export enum PathVerb {
  MoveTo = 0,
  LineTo = 1,
  CurveTo = 2,
  Close = 3,
}

export enum ParagraphJustification {
  LeftJustify = 0,
  CenterJustify = 1,
  RightJustify = 2,
  FullJustifyLastLineLeft = 3,
  FullJustifyLastLineRight = 4,
  FullJustifyLastLineCenter = 5,
  FullJustifyLastLineFull = 6,
}

export type PagPathData = {
  verbs: PathVerb[];
  points: PagPoint[];
};

export type PagKeyframe<T> = {
  startTime: number;
  endTime: number;
  startValue: T;
  endValue: T;
  interpolationType: KeyframeInterpolationType;
  bezierOut?: PagPoint[];
  bezierIn?: PagPoint[];
};

export type PagProperty<T> =
  | { animatable: false; value: T }
  | { animatable: true; keyframes: PagKeyframe<T>[] };

export type PagTransform2D = {
  anchorPoint: PagProperty<PagPoint>;
  position: PagProperty<PagPoint>;
  scale: PagProperty<PagPoint>;
  rotation: PagProperty<number>;
  opacity: PagProperty<PagOpacity>;
};

export type PagMaskData = {
  id: number;
  inverted: boolean;
  maskMode: MaskMode;
  maskPath: PagProperty<PagPathData>;
  maskOpacity: PagProperty<PagOpacity>;
  maskExpansion: PagProperty<number>;
};

export type PagFastBlurEffect = {
  kind: 'fastBlur';
  blurriness: PagProperty<number>;
  blurDimensions: PagProperty<PagBlurDimensions>;
  repeatEdgePixels: PagProperty<boolean>;
  effectOpacity: PagProperty<PagOpacity>;
};

export type PagEffect = PagFastBlurEffect;

export type PagDropShadowStyle = {
  kind: 'dropShadow';
  blendMode: PagProperty<BlendMode>;
  color: PagProperty<PagColor>;
  opacity: PagProperty<PagOpacity>;
  angle: PagProperty<number>;
  distance: PagProperty<number>;
  size: PagProperty<number>;
  spread: PagProperty<number>;
};

export type PagLayerStyle = PagDropShadowStyle;

export type PagShapeElement =
  | {
      kind: 'rectangle';
      reversed: boolean;
      size: PagProperty<PagPoint>;
      position: PagProperty<PagPoint>;
      roundness: PagProperty<number>;
    }
  | {
      kind: 'ellipse';
      reversed: boolean;
      size: PagProperty<PagPoint>;
      position: PagProperty<PagPoint>;
    }
  | {
      kind: 'path';
      shapePath: PagProperty<PagPathData>;
    }
  | {
      kind: 'fill';
      blendMode: BlendMode;
      composite: CompositeOrder;
      fillRule: FillRule;
      color: PagProperty<PagColor>;
      opacity: PagProperty<PagOpacity>;
    }
  | {
      kind: 'stroke';
      blendMode: BlendMode;
      composite: CompositeOrder;
      lineCap: LineCap;
      lineJoin: LineJoin;
      miterLimit: PagProperty<number>;
      color: PagProperty<PagColor>;
      opacity: PagProperty<PagOpacity>;
      strokeWidth: PagProperty<number>;
    };

export type PagTextDocument = {
  applyFill: boolean;
  applyStroke: boolean;
  boxText: boolean;
  fauxBold: boolean;
  fauxItalic: boolean;
  strokeOverFill: boolean;
  baselineShift: number;
  firstBaseLine: number;
  boxTextPos: PagPoint;
  boxTextSize: PagPoint;
  fillColor: PagColor;
  fontSize: number;
  strokeColor: PagColor;
  strokeWidth: number;
  text: string;
  justification: ParagraphJustification;
  leading: number;
  tracking: number;
  fontFamily: string;
  fontStyle: string;
};

export type PagImageBytes = {
  id: number;
  fileBytes: Uint8Array;
  width: number;
  height: number;
  scaleFactor: number;
  anchorX: number;
  anchorY: number;
};

export type PagLayerBase = {
  id: number;
  name: string;
  isActive: boolean;
  autoOrientation: boolean;
  parentId: number | null;
  stretch: PagRatio;
  startTime: number;
  duration: number;
  blendMode: BlendMode;
  trackMatteType: TrackMatteType;
  transform: PagTransform2D;
  masks: PagMaskData[];
  effects: PagEffect[];
  layerStyles: PagLayerStyle[];
};

export type PagShapeLayer = PagLayerBase & {
  type: LayerType.Shape;
  contents: PagShapeElement[];
};

export type PagTextLayer = PagLayerBase & {
  type: LayerType.Text;
  sourceText: PagTextDocument;
};

export type PagImageLayer = PagLayerBase & {
  type: LayerType.Image;
  imageId: number;
};

export type PagPreComposeLayer = PagLayerBase & {
  type: LayerType.PreCompose;
  compositionId: number;
  compositionStartTime: number;
};

export type PagSolidLayer = PagLayerBase & {
  type: LayerType.Solid;
  solidColor: PagColor;
  width: number;
  height: number;
};

export type PagLayer =
  | PagShapeLayer
  | PagTextLayer
  | PagImageLayer
  | PagPreComposeLayer
  | PagSolidLayer;

export type PagVectorComposition = {
  id: number;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  backgroundColor: PagColor;
  layers: PagLayer[];
};

export type PagFile = {
  compositions: PagVectorComposition[];
  images: PagImageBytes[];
  fonts: Array<{ fontFamily: string; fontStyle: string }>;
};

export function staticProperty<T>(value: T): PagProperty<T> {
  return { animatable: false, value };
}

export function defaultTransform2D(
  overrides: Partial<{
    anchorPoint: PagPoint;
    position: PagPoint;
    scale: PagPoint;
    rotation: number;
    opacity: PagOpacity;
  }> = {},
): PagTransform2D {
  return {
    anchorPoint: staticProperty(overrides.anchorPoint ?? PointZero),
    position: staticProperty(overrides.position ?? PointZero),
    scale: staticProperty(overrides.scale ?? PointOne),
    rotation: staticProperty(overrides.rotation ?? 0),
    opacity: staticProperty(overrides.opacity ?? OPAQUE),
  };
}

export function pointsEqual(a: PagPoint, b: PagPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

export function colorsEqual(a: PagColor, b: PagColor): boolean {
  return a.red === b.red && a.green === b.green && a.blue === b.blue;
}

export function pathsEqual(a: PagPathData, b: PagPathData): boolean {
  if (a.verbs.length !== b.verbs.length || a.points.length !== b.points.length) {
    return false;
  }
  for (let i = 0; i < a.verbs.length; i += 1) {
    if (a.verbs[i] !== b.verbs[i]) {
      return false;
    }
  }
  for (let i = 0; i < a.points.length; i += 1) {
    if (!pointsEqual(a.points[i], b.points[i])) {
      return false;
    }
  }
  return true;
}

export function emptyPath(): PagPathData {
  return { verbs: [], points: [] };
}

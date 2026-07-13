/** Shape element tag writers aligned with libpag shapes/*.cpp */

import {
  BlendMode,
  ColorRed,
  ColorWhite,
  CompositeOrder,
  FillRule,
  GradientFillType,
  LineCap,
  LineJoin,
  OPAQUE,
  PagShapeElement,
  PointZero,
  staticProperty,
} from '../types';
import {
  AttributeType,
  boolBitConfig,
  colorConfig,
  floatConfig,
  gradientColorConfig,
  opacityConfig,
  pathConfig,
  pointConfig,
  uint8Config,
  writeTagBlock,
} from './attribute-helper';
import { EncodeStream } from './encode-stream';
import { TagCode } from './tag-code';

function writeRectangle(stream: EncodeStream, shape: Extract<PagShapeElement, { kind: 'rectangle' }>): void {
  writeTagBlock(stream, {
    tagCode: TagCode.Rectangle,
    configs: [
      boolBitConfig(() => shape.reversed),
      pointConfig(AttributeType.MultiDimensionProperty, { x: 100, y: 100 }, () => shape.size),
      pointConfig(AttributeType.SpatialProperty, PointZero, () => shape.position),
      floatConfig(AttributeType.SimpleProperty, 0, () => shape.roundness),
    ],
  });
}

function writeEllipse(stream: EncodeStream, shape: Extract<PagShapeElement, { kind: 'ellipse' }>): void {
  writeTagBlock(stream, {
    tagCode: TagCode.Ellipse,
    configs: [
      boolBitConfig(() => shape.reversed),
      pointConfig(AttributeType.MultiDimensionProperty, { x: 100, y: 100 }, () => shape.size),
      pointConfig(AttributeType.SpatialProperty, PointZero, () => shape.position),
    ],
  });
}

function writeShapePath(stream: EncodeStream, shape: Extract<PagShapeElement, { kind: 'path' }>): void {
  writeTagBlock(stream, {
    tagCode: TagCode.ShapePath,
    configs: [
      pathConfig(AttributeType.SimpleProperty, () => shape.shapePath),
    ],
  });
}

function writeFill(stream: EncodeStream, shape: Extract<PagShapeElement, { kind: 'fill' }>): void {
  writeTagBlock(stream, {
    tagCode: TagCode.Fill,
    configs: [
      uint8Config(AttributeType.Value, BlendMode.Normal, () => shape.blendMode),
      uint8Config(AttributeType.Value, CompositeOrder.BelowPreviousInSameGroup, () => shape.composite),
      uint8Config(AttributeType.Value, FillRule.NonZeroWinding, () => shape.fillRule),
      colorConfig(AttributeType.SimpleProperty, ColorRed, () => shape.color),
      opacityConfig(AttributeType.SimpleProperty, () => shape.opacity),
    ],
  });
}

function writeGradientFill(
  stream: EncodeStream,
  shape: Extract<PagShapeElement, { kind: 'gradientFill' }>,
): void {
  writeTagBlock(stream, {
    tagCode: TagCode.GradientFill,
    configs: [
      uint8Config(AttributeType.Value, BlendMode.Normal, () => shape.blendMode),
      uint8Config(AttributeType.Value, CompositeOrder.BelowPreviousInSameGroup, () => shape.composite),
      uint8Config(AttributeType.Value, FillRule.NonZeroWinding, () => shape.fillRule),
      uint8Config(AttributeType.Value, GradientFillType.Linear, () => shape.fillType),
      pointConfig(AttributeType.SpatialProperty, PointZero, () => shape.startPoint),
      pointConfig(AttributeType.SpatialProperty, { x: 100, y: 0 }, () => shape.endPoint),
      gradientColorConfig(() => shape.colors),
      opacityConfig(AttributeType.SimpleProperty, () => shape.opacity),
    ],
  });
}

function writeStroke(stream: EncodeStream, shape: Extract<PagShapeElement, { kind: 'stroke' }>): void {
  writeTagBlock(stream, {
    tagCode: TagCode.Stroke,
    configs: [
      uint8Config(AttributeType.Value, BlendMode.Normal, () => shape.blendMode),
      uint8Config(AttributeType.Value, CompositeOrder.BelowPreviousInSameGroup, () => shape.composite),
      uint8Config(AttributeType.Value, LineCap.Butt, () => shape.lineCap),
      uint8Config(AttributeType.Value, LineJoin.Miter, () => shape.lineJoin),
      floatConfig(AttributeType.SimpleProperty, 4, () => shape.miterLimit),
      colorConfig(AttributeType.SimpleProperty, ColorWhite, () => shape.color),
      opacityConfig(AttributeType.SimpleProperty, () => shape.opacity),
      floatConfig(AttributeType.SimpleProperty, 2, () => shape.strokeWidth),
      {
        attributeType: AttributeType.Custom,
        defaultValue: null,
        get: () => null,
        writeValue: () => undefined,
        writeCustom: () => false,
      },
    ],
  });
}

export function writeShapes(stream: EncodeStream, contents: PagShapeElement[]): void {
  for (const shape of contents) {
    switch (shape.kind) {
      case 'rectangle':
        writeRectangle(stream, shape);
        break;
      case 'ellipse':
        writeEllipse(stream, shape);
        break;
      case 'path':
        writeShapePath(stream, shape);
        break;
      case 'fill':
        writeFill(stream, shape);
        break;
      case 'gradientFill':
        writeGradientFill(stream, shape);
        break;
      case 'stroke':
        writeStroke(stream, shape);
        break;
      default:
        break;
    }
  }
}

export function makeRectangle(
  width: number,
  height: number,
  roundness = 0,
): PagShapeElement[] {
  return [{
    kind: 'rectangle',
    reversed: false,
    size: staticProperty({ x: width, y: height }),
    position: staticProperty({ x: width / 2, y: height / 2 }),
    roundness: staticProperty(roundness),
  }];
}

export function makeEllipse(width: number, height: number): PagShapeElement[] {
  return [{
    kind: 'ellipse',
    reversed: false,
    size: staticProperty({ x: width, y: height }),
    position: staticProperty({ x: width / 2, y: height / 2 }),
  }];
}

export function makeSolidFill(color: { red: number; green: number; blue: number }, opacity = OPAQUE): PagShapeElement {
  return {
    kind: 'fill',
    blendMode: BlendMode.Normal,
    composite: CompositeOrder.BelowPreviousInSameGroup,
    fillRule: FillRule.NonZeroWinding,
    color: staticProperty(color),
    opacity: staticProperty(opacity),
  };
}

export function makeSolidStroke(
  color: { red: number; green: number; blue: number },
  strokeWidth: number,
  opacity = OPAQUE,
): PagShapeElement {
  return {
    kind: 'stroke',
    blendMode: BlendMode.Normal,
    composite: CompositeOrder.BelowPreviousInSameGroup,
    lineCap: LineCap.Butt,
    lineJoin: LineJoin.Miter,
    miterLimit: staticProperty(4),
    color: staticProperty(color),
    opacity: staticProperty(opacity),
    strokeWidth: staticProperty(strokeWidth),
  };
}

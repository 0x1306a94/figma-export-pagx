/** Layer / Transform2D / Mask writers aligned with libpag LayerTag.cpp */

import {
  BlendMode,
  DEFAULT_RATIO,
  LayerType,
  MaskMode,
  OPAQUE,
  PagLayer,
  PagMaskData,
  PagTextDocument,
  PagTransform2D,
  PointZero,
  TrackMatteType,
  emptyPath,
} from '../types';
import {
  AttributeType,
  boolBitConfig,
  floatConfig,
  idConfig,
  layerIdConfig,
  opacityConfig,
  pathConfig,
  pointConfig,
  ratioConfig,
  stringConfig,
  timeConfig,
  uint8Config,
  writeBlock,
  writeTagBlock,
} from './attribute-helper';
import { writeColor, writeTime } from './data-types';
import { EncodeStream } from './encode-stream';
import { writeShapes } from './encode-shapes';
import { TagCode, writeEndTag, writeTagHeader } from './tag-code';

export type EncodeContext = {
  fontIdByKey: Map<string, number>;
};

function writeTransform2D(stream: EncodeStream, transform: PagTransform2D): void {
  writeTagBlock(stream, {
    tagCode: TagCode.Transform2D,
    configs: [
      pointConfig(AttributeType.SpatialProperty, PointZero, () => transform.anchorPoint),
      pointConfig(AttributeType.SpatialProperty, PointZero, () => transform.position),
      floatConfig(AttributeType.SimpleProperty, 0, () => null),
      floatConfig(AttributeType.SimpleProperty, 0, () => null),
      pointConfig(AttributeType.MultiDimensionProperty, { x: 1, y: 1 }, () => transform.scale),
      floatConfig(AttributeType.SimpleProperty, 0, () => transform.rotation),
      opacityConfig(AttributeType.SimpleProperty, () => transform.opacity),
    ],
  });
}

function writeMask(stream: EncodeStream, mask: PagMaskData): void {
  writeTagBlock(stream, {
    tagCode: TagCode.MaskBlock,
    configs: [
      idConfig(() => mask.id),
      boolBitConfig(() => mask.inverted),
      uint8Config(AttributeType.Value, MaskMode.Add, () => mask.maskMode),
      pathConfig(AttributeType.SimpleProperty, () => mask.maskPath),
      opacityConfig(AttributeType.SimpleProperty, () => mask.maskOpacity),
      floatConfig(AttributeType.SimpleProperty, 0, () => mask.maskExpansion),
    ],
  });
}

function writeLayerAttributes(stream: EncodeStream, layer: PagLayer): void {
  const hasName = layer.name.length > 0;
  writeTagBlock(stream, {
    tagCode: hasName ? TagCode.LayerAttributesV2 : TagCode.LayerAttributes,
    configs: [
      boolBitConfig(() => layer.isActive),
      boolBitConfig(() => layer.autoOrientation),
      layerIdConfig(null, () => layer.parentId),
      ratioConfig(DEFAULT_RATIO, () => layer.stretch),
      timeConfig(AttributeType.Value, 0, () => layer.startTime),
      uint8Config(AttributeType.Value, BlendMode.Normal, () => layer.blendMode),
      uint8Config(AttributeType.Value, TrackMatteType.None, () => layer.trackMatteType),
      floatConfig(AttributeType.SimpleProperty, 0, () => null),
      timeConfig(AttributeType.FixedValue, 0, () => layer.duration),
      ...(hasName ? [stringConfig('', () => layer.name)] : []),
    ],
  });
}

function writeTextDocument(stream: EncodeStream, doc: PagTextDocument, ctx: EncodeContext): void {
  writeBlock(stream, {
    tagCode: TagCode.TextSource,
    configs: [
      boolBitConfig(() => doc.applyFill),
      boolBitConfig(() => doc.applyStroke),
      boolBitConfig(() => doc.boxText),
      boolBitConfig(() => doc.fauxBold),
      boolBitConfig(() => doc.fauxItalic),
      boolBitConfig(() => doc.strokeOverFill),
      floatConfig(AttributeType.Value, 0, () => doc.baselineShift),
      floatConfig(AttributeType.Value, 0, () => doc.firstBaseLine),
      pointConfig(AttributeType.Value, PointZero, () => doc.boxTextPos),
      pointConfig(AttributeType.Value, PointZero, () => doc.boxTextSize),
      {
        attributeType: AttributeType.Value,
        defaultValue: { red: 0, green: 0, blue: 0 },
        get: () => doc.fillColor,
        writeValue: (s, value) => {
          const color = value as { red: number; green: number; blue: number };
          s.writeUint8(color.red);
          s.writeUint8(color.green);
          s.writeUint8(color.blue);
        },
        equals: (a, b) => {
          const left = a as { red: number; green: number; blue: number };
          const right = b as { red: number; green: number; blue: number };
          return left.red === right.red && left.green === right.green && left.blue === right.blue;
        },
      },
      floatConfig(AttributeType.Value, 24, () => doc.fontSize),
      {
        attributeType: AttributeType.Value,
        defaultValue: { red: 0, green: 0, blue: 0 },
        get: () => doc.strokeColor,
        writeValue: (s, value) => {
          const color = value as { red: number; green: number; blue: number };
          s.writeUint8(color.red);
          s.writeUint8(color.green);
          s.writeUint8(color.blue);
        },
        equals: (a, b) => {
          const left = a as { red: number; green: number; blue: number };
          const right = b as { red: number; green: number; blue: number };
          return left.red === right.red && left.green === right.green && left.blue === right.blue;
        },
      },
      floatConfig(AttributeType.Value, 1, () => doc.strokeWidth),
      stringConfig('', () => doc.text),
      uint8Config(AttributeType.Value, 0, () => doc.justification),
      floatConfig(AttributeType.Value, 0, () => doc.leading),
      floatConfig(AttributeType.Value, 0, () => doc.tracking),
      {
        attributeType: AttributeType.Custom,
        defaultValue: null,
        get: () => null,
        writeValue: () => undefined,
        writeCustom: (customStream) => {
          const key = `${doc.fontFamily} - ${doc.fontStyle}`;
          const fontId = ctx.fontIdByKey.get(key) ?? 0;
          customStream.writeEncodedUint32(fontId);
          return true;
        },
      },
    ],
  });
}

function writeTextSource(stream: EncodeStream, layer: Extract<PagLayer, { type: LayerType.Text }>, ctx: EncodeContext): void {
  const valueBytes = new EncodeStream();
  // DiscreteProperty static: exist=true, animatable=false, write TextDocument
  writeTextDocument(valueBytes, layer.sourceText, ctx);

  const flagBytes = new EncodeStream();
  flagBytes.writeBitBoolean(true); // exist
  flagBytes.writeBitBoolean(false); // not animatable
  flagBytes.alignWithBytes();
  flagBytes.writeBytes(valueBytes);
  writeTagHeader(stream, flagBytes, TagCode.TextSource);
}

function writeCompositionReference(
  stream: EncodeStream,
  layer: Extract<PagLayer, { type: LayerType.PreCompose }>,
): void {
  const bytes = new EncodeStream();
  bytes.writeEncodedUint32(layer.compositionId);
  writeTime(bytes, layer.compositionStartTime);
  writeTagHeader(stream, bytes, TagCode.CompositionReference);
}

function writeImageReference(
  stream: EncodeStream,
  layer: Extract<PagLayer, { type: LayerType.Image }>,
): void {
  const bytes = new EncodeStream();
  bytes.writeEncodedUint32(layer.imageId);
  writeTagHeader(stream, bytes, TagCode.ImageReference);
}

function writeSolidColor(
  stream: EncodeStream,
  layer: Extract<PagLayer, { type: LayerType.Solid }>,
): void {
  const bytes = new EncodeStream();
  writeColor(bytes, layer.solidColor);
  bytes.writeEncodedInt32(Math.round(layer.width));
  bytes.writeEncodedInt32(Math.round(layer.height));
  writeTagHeader(stream, bytes, TagCode.SolidColor);
}

export function writeLayer(stream: EncodeStream, layer: PagLayer, ctx: EncodeContext): TagCode {
  stream.writeUint8(layer.type);
  stream.writeEncodedUint32(layer.id);
  writeLayerAttributes(stream, layer);

  for (const mask of layer.masks) {
    writeMask(stream, mask);
  }

  writeTransform2D(stream, layer.transform);

  switch (layer.type) {
    case LayerType.Shape:
      writeShapes(stream, layer.contents);
      break;
    case LayerType.PreCompose:
      writeCompositionReference(stream, layer);
      break;
    case LayerType.Image:
      writeImageReference(stream, layer);
      break;
    case LayerType.Text:
      writeTextSource(stream, layer, ctx);
      break;
    case LayerType.Solid:
      writeSolidColor(stream, layer);
      break;
    default:
      break;
  }

  writeEndTag(stream);
  return TagCode.LayerBlock;
}

export function emptyMaskPath(): typeof emptyPath extends () => infer R ? R : never {
  return emptyPath();
}

export function defaultMask(id: number, path: ReturnType<typeof emptyPath>): PagMaskData {
  return {
    id,
    inverted: false,
    maskMode: MaskMode.Add,
    maskPath: { animatable: false, value: path },
    maskOpacity: { animatable: false, value: OPAQUE },
    maskExpansion: { animatable: false, value: 0 },
  };
}

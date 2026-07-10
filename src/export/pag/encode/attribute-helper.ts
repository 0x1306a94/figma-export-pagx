/** Attribute block writer aligned with libpag AttributeHelper WriteTagBlock. */

import {
  BEZIER_PRECISION,
  KeyframeInterpolationType,
  OPAQUE,
  PagColor,
  PagKeyframe,
  PagPathData,
  PagPoint,
  PagProperty,
  SPATIAL_PRECISION,
  colorsEqual,
  emptyPath,
  pathsEqual,
  pointsEqual,
} from '../types';
import { EncodeStream } from './encode-stream';
import { TagCode, writeTagHeader } from './tag-code';
import {
  writeColor,
  writePath,
  writePoint,
  writeTime,
} from './data-types';

export enum AttributeType {
  Value,
  FixedValue,
  SimpleProperty,
  DiscreteProperty,
  MultiDimensionProperty,
  SpatialProperty,
  BitFlag,
  Custom,
}

export type AttributeFlag = {
  exist: boolean;
  animatable: boolean;
  hasSpatial: boolean;
};

export type AttributeConfig = {
  attributeType: AttributeType;
  defaultValue: unknown;
  equals?: (a: unknown, b: unknown) => boolean;
  writeValue: (stream: EncodeStream, value: unknown) => void;
  writeValueList?: (stream: EncodeStream, values: unknown[]) => void;
  dimensionality?: number;
  /** For Custom: return false to mark flag.exist = false */
  writeCustom?: (stream: EncodeStream) => boolean;
  /** Target getter */
  get: () => unknown;
};

export type BlockConfig = {
  tagCode: TagCode;
  configs: AttributeConfig[];
};

export function writeAttributeFlag(
  stream: EncodeStream,
  flag: AttributeFlag,
  attributeType: AttributeType,
): void {
  if (attributeType === AttributeType.FixedValue) {
    return;
  }
  stream.writeBitBoolean(flag.exist);
  if (
    !flag.exist
    || attributeType === AttributeType.Value
    || attributeType === AttributeType.BitFlag
    || attributeType === AttributeType.Custom
  ) {
    return;
  }
  stream.writeBitBoolean(flag.animatable);
  if (!flag.animatable || attributeType !== AttributeType.SpatialProperty) {
    return;
  }
  stream.writeBitBoolean(flag.hasSpatial);
}

function writeKeyframes<T>(
  stream: EncodeStream,
  keyframes: PagKeyframe<T>[],
  attributeType: AttributeType,
): void {
  stream.writeEncodedUint32(keyframes.length);
  if (attributeType === AttributeType.DiscreteProperty) {
    return;
  }
  for (const keyframe of keyframes) {
    stream.writeUBits(keyframe.interpolationType, 2);
  }
}

function writeTimeAndValue<T>(
  stream: EncodeStream,
  keyframes: PagKeyframe<T>[],
  config: AttributeConfig,
): void {
  writeTime(stream, keyframes[0].startTime);
  for (const keyframe of keyframes) {
    writeTime(stream, keyframe.endTime);
  }
  const list: unknown[] = [keyframes[0].startValue];
  for (const keyframe of keyframes) {
    list.push(keyframe.endValue);
  }
  if (config.writeValueList) {
    config.writeValueList(stream, list);
  } else {
    for (const value of list) {
      config.writeValue(stream, value);
    }
  }
}

function writeTimeEase<T>(
  stream: EncodeStream,
  keyframes: PagKeyframe<T>[],
  config: AttributeConfig,
): void {
  const dimensionality = config.attributeType === AttributeType.MultiDimensionProperty
    ? (config.dimensionality ?? 1)
    : 1;
  const bezierList: number[] = [];
  for (const keyframe of keyframes) {
    if (keyframe.interpolationType !== KeyframeInterpolationType.Bezier) {
      continue;
    }
    for (let j = 0; j < dimensionality; j += 1) {
      const outPoint = keyframe.bezierOut?.[j] ?? { x: 0, y: 0 };
      const inPoint = keyframe.bezierIn?.[j] ?? { x: 1, y: 1 };
      bezierList.push(outPoint.x, outPoint.y, inPoint.x, inPoint.y);
    }
  }
  stream.writeFloatList(bezierList, BEZIER_PRECISION);
}

function writeProperty(
  stream: EncodeStream,
  config: AttributeConfig,
  property: PagProperty<unknown> | null | undefined,
): AttributeFlag {
  const flag: AttributeFlag = { exist: false, animatable: false, hasSpatial: false };
  if (!property) {
    return flag;
  }
  if (property.animatable === false) {
    const equals = config.equals ?? ((a, b) => a === b);
    if (equals(property.value, config.defaultValue)) {
      return flag;
    }
    flag.exist = true;
    config.writeValue(stream, property.value);
    return flag;
  }
  flag.exist = true;
  flag.animatable = true;
  writeKeyframes(stream, property.keyframes, config.attributeType);
  writeTimeAndValue(stream, property.keyframes, config);
  writeTimeEase(stream, property.keyframes, config);
  return flag;
}

function writeOneAttribute(
  flagBytes: EncodeStream,
  valueBytes: EncodeStream,
  config: AttributeConfig,
): void {
  let flag: AttributeFlag = { exist: false, animatable: false, hasSpatial: false };
  const target = config.get();

  if (config.attributeType === AttributeType.BitFlag) {
    flag.exist = Boolean(target);
  } else if (config.attributeType === AttributeType.FixedValue) {
    flag.exist = true;
    config.writeValue(valueBytes, target);
  } else if (config.attributeType === AttributeType.Value) {
    const equals = config.equals ?? ((a, b) => a === b);
    if (!equals(target, config.defaultValue)) {
      flag.exist = true;
      config.writeValue(valueBytes, target);
    }
  } else if (config.attributeType === AttributeType.Custom) {
    const customStream = new EncodeStream();
    const wrote = config.writeCustom?.(customStream) ?? false;
    if (wrote) {
      flag.exist = true;
      valueBytes.writeBytes(customStream);
    }
  } else {
    flag = writeProperty(valueBytes, config, target as PagProperty<unknown>);
  }

  writeAttributeFlag(flagBytes, flag, config.attributeType);
}

export function writeTagBlock(stream: EncodeStream, block: BlockConfig): void {
  const flagBytes = new EncodeStream();
  const valueBytes = new EncodeStream();
  for (const config of block.configs) {
    writeOneAttribute(flagBytes, valueBytes, config);
  }
  flagBytes.alignWithBytes();
  flagBytes.writeBytes(valueBytes);
  writeTagHeader(stream, flagBytes, block.tagCode);
}

export function writeBlock(stream: EncodeStream, block: BlockConfig): void {
  stream.alignWithBytes();
  const valueBytes = new EncodeStream();
  for (const config of block.configs) {
    writeOneAttribute(stream, valueBytes, config);
  }
  stream.alignWithBytes();
  stream.writeBytes(valueBytes);
}

export function pointConfig(
  attributeType: AttributeType,
  defaultValue: PagPoint,
  get: () => unknown,
): AttributeConfig {
  return {
    attributeType,
    defaultValue,
    equals: (a, b) => pointsEqual(a as PagPoint, b as PagPoint),
    dimensionality: 2,
    get,
    writeValue: (stream, value) => writePoint(stream, value as PagPoint),
    writeValueList: (stream, values) => {
      if (attributeType === AttributeType.SpatialProperty) {
        const floats: number[] = [];
        for (const value of values) {
          const point = value as PagPoint;
          floats.push(point.x, point.y);
        }
        stream.writeFloatList(floats, SPATIAL_PRECISION);
      } else {
        for (const value of values) {
          writePoint(stream, value as PagPoint);
        }
      }
    },
  };
}

export function floatConfig(
  attributeType: AttributeType,
  defaultValue: number,
  get: () => unknown,
): AttributeConfig {
  return {
    attributeType,
    defaultValue,
    get,
    writeValue: (stream, value) => stream.writeFloat(value as number),
  };
}

export function opacityConfig(
  attributeType: AttributeType,
  get: () => unknown,
): AttributeConfig {
  return {
    attributeType,
    defaultValue: OPAQUE,
    get,
    writeValue: (stream, value) => stream.writeUint8(value as number),
    writeValueList: (stream, values) => {
      stream.writeUint32List(values.map((value) => value as number));
    },
  };
}

export function colorConfig(
  attributeType: AttributeType,
  defaultValue: PagColor,
  get: () => unknown,
): AttributeConfig {
  return {
    attributeType,
    defaultValue,
    equals: (a, b) => colorsEqual(a as PagColor, b as PagColor),
    dimensionality: 3,
    get,
    writeValue: (stream, value) => writeColor(stream, value as PagColor),
  };
}

export function pathConfig(
  attributeType: AttributeType,
  get: () => unknown,
): AttributeConfig {
  const defaultValue = emptyPath();
  return {
    attributeType,
    defaultValue,
    equals: (a, b) => pathsEqual(a as PagPathData, b as PagPathData),
    get,
    writeValue: (stream, value) => writePath(stream, value as PagPathData),
  };
}

export function uint8Config(
  attributeType: AttributeType,
  defaultValue: number,
  get: () => unknown,
): AttributeConfig {
  return {
    attributeType,
    defaultValue,
    get,
    writeValue: (stream, value) => stream.writeUint8(value as number),
  };
}

export function boolBitConfig(get: () => boolean): AttributeConfig {
  return {
    attributeType: AttributeType.BitFlag,
    defaultValue: false,
    get,
    writeValue: () => undefined,
  };
}

export function stringConfig(defaultValue: string, get: () => unknown): AttributeConfig {
  return {
    attributeType: AttributeType.Value,
    defaultValue,
    get,
    writeValue: (stream, value) => stream.writeUTF8String(value as string),
  };
}

export function timeConfig(
  attributeType: AttributeType,
  defaultValue: number,
  get: () => unknown,
): AttributeConfig {
  return {
    attributeType,
    defaultValue,
    get,
    writeValue: (stream, value) => writeTime(stream, value as number),
  };
}

export function idConfig(get: () => number): AttributeConfig {
  return {
    attributeType: AttributeType.FixedValue,
    defaultValue: 0,
    get,
    writeValue: (stream, value) => stream.writeEncodedUint32(value as number),
  };
}

export function layerIdConfig(defaultValue: number | null, get: () => number | null): AttributeConfig {
  return {
    attributeType: AttributeType.Value,
    defaultValue,
    get,
    writeValue: (stream, value) => {
      stream.writeEncodedUint32((value as number | null) ?? 0);
    },
  };
}

export function ratioConfig(
  defaultValue: { numerator: number; denominator: number },
  get: () => unknown,
): AttributeConfig {
  return {
    attributeType: AttributeType.Value,
    defaultValue,
    equals: (a, b) => {
      const left = a as { numerator: number; denominator: number };
      const right = b as { numerator: number; denominator: number };
      return left.numerator === right.numerator && left.denominator === right.denominator;
    },
    get,
    writeValue: (stream, value) => {
      const ratio = value as { numerator: number; denominator: number };
      stream.writeEncodedInt32(ratio.numerator);
      stream.writeEncodedUint32(ratio.denominator);
    },
  };
}

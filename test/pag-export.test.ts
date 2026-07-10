import assert from 'node:assert/strict';
import {
  BlendMode,
  ColorRed,
  CompositeOrder,
  FillRule,
  LayerType,
  OPAQUE,
  defaultTransform2D,
  staticProperty,
} from '../src/export/pag/types';
import { EncodeStream } from '../src/export/pag/encode/encode-stream';
import { encodePagFile } from '../src/export/pag/encode/encode-file';
import { collectPagMotionFrames } from '../src/export/figma-motion';
import { exportLayerName, parseSolidMarker } from '../src/export/solid-marker';
import { keyframesFromValues, opacityToPag, svgToPagPath } from '../src/export/pag/figma-to-pag';
import { KeyframeInterpolationType, PathVerb } from '../src/export/pag/types';

function testEncodeStreamBasics(): void {
  const stream = new EncodeStream();
  stream.writeUint8(1);
  stream.writeUint16(0x0203);
  stream.writeEncodedUint32(300);
  stream.writeFloat(1.5);
  stream.writeBitBoolean(true);
  stream.writeBitBoolean(false);
  stream.alignWithBytes();
  const data = stream.release();
  assert.ok(data.length > 0);
  assert.equal(data[0], 1);
}

function testMinimalShapePag(): void {
  const file = {
    compositions: [{
      id: 1,
      width: 100,
      height: 80,
      duration: 1,
      frameRate: 60,
      backgroundColor: { red: 255, green: 255, blue: 255 },
      layers: [{
        type: LayerType.Shape as const,
        id: 1,
        name: 'Rect',
        isActive: true,
        autoOrientation: false,
        parentId: null,
        stretch: { numerator: 1, denominator: 1 },
        startTime: 0,
        duration: 1,
        blendMode: BlendMode.Normal,
        trackMatteType: 0,
        transform: defaultTransform2D({
          anchorPoint: { x: 50, y: 40 },
          position: { x: 50, y: 40 },
        }),
        masks: [],
        contents: [
          {
            kind: 'rectangle' as const,
            reversed: false,
            size: staticProperty({ x: 100, y: 80 }),
            position: staticProperty({ x: 50, y: 40 }),
            roundness: staticProperty(0),
          },
          {
            kind: 'fill' as const,
            blendMode: BlendMode.Normal,
            composite: CompositeOrder.BelowPreviousInSameGroup,
            fillRule: FillRule.NonZeroWinding,
            color: staticProperty(ColorRed),
            opacity: staticProperty(OPAQUE),
          },
        ],
      }],
    }],
    images: [],
    fonts: [],
  };

  const bytes = encodePagFile(file);
  assert.ok(bytes.length > 16);
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2]), 'PAG');
  assert.equal(bytes[3], 1);
  // bodyLength little-endian u32 at offset 4
  const bodyLength = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  assert.equal(bodyLength, bytes.length - 9);
  assert.equal(bytes[8], 'U'.charCodeAt(0)); // CompressionAlgorithm::UNCOMPRESSED
}

function testOpacityAndPath(): void {
  assert.equal(opacityToPag(1), 255);
  assert.equal(opacityToPag(0.5), 128);
  const path = svgToPagPath('M 0 0 L 10 0 L 10 10 Z');
  assert.equal(path.verbs[0], PathVerb.MoveTo);
  assert.equal(path.verbs[path.verbs.length - 1], PathVerb.Close);
}

function testKeyframes(): void {
  const property = keyframesFromValues([
    { frame: 0, value: 0 },
    { frame: 30, value: 1 },
  ]);
  assert.equal(property.animatable, true);
  if (property.animatable) {
    assert.equal(property.keyframes.length, 1);
    assert.equal(property.keyframes[0].interpolationType, KeyframeInterpolationType.Linear);
  }
}

function testMaskAndMotionPag(): void {
  const path = {
    verbs: [PathVerb.MoveTo, PathVerb.LineTo, PathVerb.LineTo, PathVerb.LineTo, PathVerb.Close],
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ],
  };

  const file = {
    compositions: [{
      id: 1,
      width: 100,
      height: 100,
      duration: 30,
      frameRate: 60,
      backgroundColor: { red: 255, green: 255, blue: 255 },
      layers: [{
        type: LayerType.Shape as const,
        id: 1,
        name: 'Masked',
        isActive: true,
        autoOrientation: false,
        parentId: null,
        stretch: { numerator: 1, denominator: 1 },
        startTime: 0,
        duration: 30,
        blendMode: BlendMode.Normal,
        trackMatteType: 0,
        transform: {
          anchorPoint: staticProperty({ x: 50, y: 50 }),
          position: {
            animatable: true as const,
            keyframes: [{
              startTime: 0,
              endTime: 30,
              startValue: { x: 50, y: 50 },
              endValue: { x: 80, y: 50 },
              interpolationType: KeyframeInterpolationType.Linear,
            }],
          },
          scale: staticProperty({ x: 1, y: 1 }),
          rotation: staticProperty(0),
          opacity: {
            animatable: true as const,
            keyframes: [{
              startTime: 0,
              endTime: 30,
              startValue: 255,
              endValue: 128,
              interpolationType: KeyframeInterpolationType.Linear,
            }],
          },
        },
        masks: [{
          id: 1,
          inverted: false,
          maskMode: 1,
          maskPath: staticProperty(path),
          maskOpacity: staticProperty(OPAQUE),
          maskExpansion: staticProperty(0),
        }],
        contents: [
          {
            kind: 'rectangle' as const,
            reversed: false,
            size: staticProperty({ x: 100, y: 100 }),
            position: staticProperty({ x: 50, y: 50 }),
            roundness: staticProperty(0),
          },
          {
            kind: 'fill' as const,
            blendMode: BlendMode.Normal,
            composite: CompositeOrder.BelowPreviousInSameGroup,
            fillRule: FillRule.NonZeroWinding,
            color: staticProperty(ColorRed),
            opacity: staticProperty(OPAQUE),
          },
        ],
      }],
    }],
    images: [],
    fonts: [],
  };

  const bytes = encodePagFile(file);
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2]), 'PAG');
  assert.ok(bytes.length > 64);
}

function testSizeAnimationUsesShapeSizeNotCenterScale(): void {
  // Frame6 / Rectangle24: WIDTH 100→200 must NOT fold into Transform2D.scale
  // (that caused center-scale). PAGX uses origin scale; PAG animates Shape.size.
  const rectangle = {
    id: '1:24',
    type: 'RECTANGLE',
    x: 20,
    y: 30,
    width: 100,
    height: 80,
    opacity: 1,
    animations: {
      WIDTH: {
        timelineDuration: 1,
        baseValue: { type: 'FLOAT' as const, value: 100 },
        tracks: [{
          keyframeOperation: 'SET' as const,
          keyframes: [
            { timelinePosition: 0, value: { type: 'FLOAT' as const, value: 100 }, easing: { type: 'LINEAR' as const } },
            { timelinePosition: 1, value: { type: 'FLOAT' as const, value: 200 }, easing: { type: 'LINEAR' as const } },
          ],
        }],
      },
    },
    animationStyles: [],
    timelines: [],
  } as unknown as SceneNode;

  const motion = collectPagMotionFrames(rectangle, null, 100, 80, 20, 30, []);
  assert.ok(motion);
  assert.equal(motion!.sizeAnimated, true);
  assert.equal(motion!.frames[0].scaleX, 1);
  assert.equal(motion!.frames[0].scaleY, 1);
  assert.equal(motion!.frames[0].contentWidth, 100);
  assert.equal(motion!.frames[0].positionX, 20);
  assert.equal(motion!.frames[0].positionY, 30);
  const last = motion!.frames[motion!.frames.length - 1];
  assert.equal(last.scaleX, 1);
  assert.equal(last.contentWidth, 200);
  assert.equal(last.positionX, 20);

  const sizeProperty = keyframesFromValues(
    motion!.frames.map((frame) => ({
      frame: frame.frame,
      value: { x: frame.contentWidth, y: frame.contentHeight },
    })),
  );
  const file = {
    compositions: [{
      id: 1,
      width: 300,
      height: 200,
      duration: motion!.durationFrames,
      frameRate: 60,
      backgroundColor: { red: 255, green: 255, blue: 255 },
      layers: [{
        type: LayerType.Shape as const,
        id: 1,
        name: 'Rectangle 24',
        isActive: true,
        autoOrientation: false,
        parentId: null,
        stretch: { numerator: 1, denominator: 1 },
        startTime: 0,
        duration: motion!.durationFrames,
        blendMode: BlendMode.Normal,
        trackMatteType: 0,
        transform: defaultTransform2D({
          anchorPoint: { x: 0, y: 0 },
          position: { x: 20, y: 30 },
        }),
        masks: [],
        contents: [
          {
            kind: 'rectangle' as const,
            reversed: false,
            size: sizeProperty,
            position: keyframesFromValues(
              motion!.frames.map((frame) => ({
                frame: frame.frame,
                value: { x: frame.contentWidth / 2, y: frame.contentHeight / 2 },
              })),
            ),
            roundness: staticProperty(0),
          },
          {
            kind: 'fill' as const,
            blendMode: BlendMode.Normal,
            composite: CompositeOrder.BelowPreviousInSameGroup,
            fillRule: FillRule.NonZeroWinding,
            color: staticProperty(ColorRed),
            opacity: staticProperty(OPAQUE),
          },
        ],
      }],
    }],
    images: [],
    fonts: [],
  };

  const bytes = encodePagFile(file);
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2]), 'PAG');
  assert.ok(sizeProperty.animatable);
  assert.ok(bytes.length > 64);
}

function testSolidMarkerParse(): void {
  assert.deepEqual(parseSolidMarker('Brand'), { isSolid: false, exportName: 'Brand' });
  assert.deepEqual(parseSolidMarker('#solid Brand'), { isSolid: true, exportName: 'Brand' });
  assert.deepEqual(parseSolidMarker('#Solid  Brand'), { isSolid: true, exportName: 'Brand' });
  assert.deepEqual(parseSolidMarker('#solid背景'), { isSolid: true, exportName: '背景' });
  assert.equal(exportLayerName('#solid  Foo'), 'Foo');
}

function testSolidLayerEncode(): void {
  const file = {
    compositions: [{
      id: 1,
      width: 100,
      height: 80,
      duration: 1,
      frameRate: 60,
      backgroundColor: { red: 255, green: 255, blue: 255 },
      layers: [{
        type: LayerType.Solid as const,
        id: 1,
        name: 'Brand',
        isActive: true,
        autoOrientation: false,
        parentId: null,
        stretch: { numerator: 1, denominator: 1 },
        startTime: 0,
        duration: 1,
        blendMode: BlendMode.Normal,
        trackMatteType: 0,
        transform: defaultTransform2D({
          anchorPoint: { x: 50, y: 40 },
          position: { x: 50, y: 40 },
        }),
        masks: [],
        solidColor: ColorRed,
        width: 100,
        height: 80,
      }],
    }],
    images: [],
    fonts: [],
  };

  const bytes = encodePagFile(file);
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2]), 'PAG');
  assert.equal(bytes[8], 'U'.charCodeAt(0));
  // Layer type Solid = 2 appears after composition tags; ensure file encodes.
  assert.ok(bytes.length > 32);
  assert.ok(bytes.includes(2), 'encoded bytes should contain LayerType.Solid (=2)');
}

testEncodeStreamBasics();
testMinimalShapePag();
testOpacityAndPath();
testKeyframes();
testMaskAndMotionPag();
testSizeAnimationUsesShapeSizeNotCenterScale();
testSolidMarkerParse();
testSolidLayerEncode();
console.log('pag-export tests passed');

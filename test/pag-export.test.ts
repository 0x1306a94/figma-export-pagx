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
import { TagCode } from '../src/export/pag/encode/tag-code';
import { writeEffects } from '../src/export/pag/encode/encode-effects';
import { writeLayerStyles } from '../src/export/pag/encode/encode-layer-styles';
import { collectPagMotionFrames } from '../src/export/figma-motion';
import { exportLayerName, parseSolidMarker } from '../src/export/solid-marker';
import {
  keyframesFromValues,
  mapFigmaBlendMode,
  mapNodeEffects,
  opacityToPag,
  scaleFromMotionAndSizeFrames,
  svgToPagPath,
} from '../src/export/pag/figma-to-pag';
import { readEncodedImageSize, scaleFromImagePaint } from '../src/export/pag/image-bytes';
import { KeyframeInterpolationType, PathVerb } from '../src/export/pag/types';
import type { Diagnostic } from '../src/export/types';

function makePngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes[12] = 0x49;
  bytes[13] = 0x48;
  bytes[14] = 0x44;
  bytes[15] = 0x52;
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  return bytes;
}

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

function testFigmaBlendModeMapping(): void {
  assert.equal(mapFigmaBlendMode('NORMAL', 'Layer'), BlendMode.Normal);
  assert.equal(mapFigmaBlendMode('MULTIPLY', 'Layer'), BlendMode.Multiply);
  assert.equal(mapFigmaBlendMode('COLOR_DODGE', 'Layer'), BlendMode.ColorDodge);
  assert.equal(mapFigmaBlendMode('LINEAR_DODGE', 'Layer'), BlendMode.Add);
  assert.throws(
    () => mapFigmaBlendMode('LINEAR_BURN', 'Unsupported Layer'),
    /PAG 不支持图层「Unsupported Layer」的填充混合模式 LINEAR_BURN/,
  );
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

function testMapNodeEffects(): void {
  const diagnostics: Diagnostic[] = [];
  const node = {
    id: '38:13',
    animations: {
      effects: {
        0: {
          RADIUS: {
            baseValue: { type: 'FLOAT', value: 21.2 },
            timelineDuration: 2,
            tracks: [{
              id: 'KeyframeTrackId:46:117',
              keyframeOperation: 'SET',
              keyframes: [{
                id: '46:118',
                easing: {
                  type: 'CUSTOM_CUBIC_BEZIER',
                  easingFunctionCubicBezier: { x1: 0.5, y1: 0, x2: 0.5, y2: 1 },
                },
                value: { type: 'FLOAT', value: 21.2 },
                timelinePosition: 0.007398,
              }, {
                id: '46:119',
                easing: {
                  type: 'CUSTOM_CUBIC_BEZIER',
                  easingFunctionCubicBezier: { x1: 0.5, y1: 0, x2: 0.5, y2: 1 },
                },
                value: { type: 'FLOAT', value: 60 },
                timelinePosition: 0.612,
              }],
            }],
          },
        },
      },
    },
    effects: [{
      type: 'LAYER_BLUR',
      visible: true,
      radius: 20,
      blurType: 'PROGRESSIVE',
    }, {
      type: 'DROP_SHADOW',
      visible: true,
      radius: 8,
      spread: 2,
      offset: { x: 3, y: 4 },
      color: { r: 0.2, g: 0.4, b: 0.6, a: 0.5 },
      blendMode: 'NORMAL',
      showShadowBehindNode: false,
    }, {
      type: 'LAYER_BLUR',
      visible: false,
      radius: 99,
    }],
  } as unknown as SceneNode;

  const mapped = mapNodeEffects(node, diagnostics);
  assert.equal(mapped.effects.length, 1);
  assert.equal(mapped.effects[0].kind, 'fastBlur');
  assert.deepEqual(mapped.effects[0].repeatEdgePixels, staticProperty(true));
  assert.equal(mapped.effects[0].blurriness.animatable, true);
  if (mapped.effects[0].blurriness.animatable) {
    assert.deepEqual(mapped.effects[0].blurriness.keyframes, [{
      startTime: 0,
      endTime: 18,
      startValue: 21.2,
      endValue: 60,
      interpolationType: KeyframeInterpolationType.Bezier,
      bezierOut: [{ x: 0.5, y: 0 }],
      bezierIn: [{ x: 0.5, y: 1 }],
    }]);
  }
  assert.equal(mapped.durationFrames, 18);
  assert.ok(diagnostics.some((item) => item.code === 'PAG_PROGRESSIVE_BLUR_FALLBACK'));

  assert.equal(mapped.layerStyles.length, 1);
  const shadow = mapped.layerStyles[0];
  assert.equal(shadow.kind, 'dropShadow');
  assert.deepEqual(shadow.distance, staticProperty(5));
  assert.deepEqual(shadow.angle, staticProperty(126.8699));
  assert.deepEqual(shadow.size, staticProperty(10));
  assert.deepEqual(shadow.spread, staticProperty(0.2));
  assert.deepEqual(shadow.color, staticProperty({ red: 51, green: 102, blue: 153 }));
  assert.deepEqual(shadow.opacity, staticProperty(128));
}

function firstTagCode(bytes: Uint8Array): number {
  return (bytes[0] | (bytes[1] << 8)) >> 6;
}

function testEffectAndLayerStyleTags(): void {
  const effectStream = new EncodeStream();
  writeEffects(effectStream, [{
    kind: 'fastBlur',
    blurriness: staticProperty(20),
    blurDimensions: staticProperty(0),
    repeatEdgePixels: staticProperty(false),
    effectOpacity: staticProperty(OPAQUE),
  }]);
  assert.equal(firstTagCode(effectStream.release()), TagCode.FastBlurEffect);

  const styleStream = new EncodeStream();
  writeLayerStyles(styleStream, [{
    kind: 'dropShadow',
    blendMode: staticProperty(BlendMode.Normal),
    color: staticProperty({ red: 51, green: 102, blue: 153 }),
    opacity: staticProperty(128),
    angle: staticProperty(126.8699),
    distance: staticProperty(5),
    size: staticProperty(10),
    spread: staticProperty(0.2),
  }]);
  assert.equal(firstTagCode(styleStream.release()), TagCode.DropShadowStyleV2);
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

  const motion = collectPagMotionFrames(rectangle, null, 100, 80, 20, 30, [], 60);
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

  const solidScale = scaleFromMotionAndSizeFrames(motion!, 100, 80);
  assert.ok(solidScale.animatable);
  assert.deepEqual(solidScale.keyframes[0].startValue, { x: 1, y: 1 });
  assert.deepEqual(solidScale.keyframes[solidScale.keyframes.length - 1].endValue, { x: 2, y: 1 });

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

function testReadEncodedImageSize(): void {
  const png = makePngHeader(400, 889);
  assert.deepEqual(readEncodedImageSize(png), { width: 400, height: 889 });

  // Minimal JPEG with SOF0 (baseline): FF D8 FF C0 len=11 precision height width …
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x90, 0x02, 0x80, 0x03, 0x01, 0x11, 0x00,
  ]);
  assert.deepEqual(readEncodedImageSize(jpeg), { width: 640, height: 400 });

  assert.throws(() => readEncodedImageSize(new Uint8Array([1, 2, 3])));
}

function testScaleFromImagePaint(): void {
  const diagnostics: Diagnostic[] = [];
  const fillPaint = { type: 'IMAGE' as const, scaleMode: 'FILL' as const, imageHash: 'h' };
  assert.deepEqual(
    scaleFromImagePaint(fillPaint, 400, 600, 200, 400, diagnostics),
    { x: 2, y: 2 }, // max(400/200, 600/400) = 2
  );

  const fitPaint = { type: 'IMAGE' as const, scaleMode: 'FIT' as const, imageHash: 'h' };
  assert.deepEqual(
    scaleFromImagePaint(fitPaint, 400, 600, 200, 400, diagnostics),
    { x: 1.5, y: 1.5 }, // min(2, 1.5) = 1.5
  );

  const stretchPaint = { type: 'IMAGE' as const, scaleMode: 'TILE' as const, imageHash: 'h' };
  assert.deepEqual(
    scaleFromImagePaint(stretchPaint, 400, 800, 200, 400, diagnostics),
    { x: 2, y: 2 },
  );
  assert.ok(diagnostics.some((item) => item.code === 'IMAGE_TILE_UNSUPPORTED'));

  const cropPaint = {
    type: 'IMAGE' as const,
    scaleMode: 'CROP' as const,
    imageHash: 'h',
    imageTransform: [[0.5, 0, 0], [0, 0.5, 0]] as Transform,
  };
  assert.deepEqual(
    scaleFromImagePaint(cropPaint, 400, 800, 200, 400, diagnostics),
    { x: 4, y: 4 }, // node / (img * |a|)
  );
}

function testImageLayerPagEncode(): void {
  const png = makePngHeader(10, 20);
  const file = {
    compositions: [{
      id: 1,
      width: 100,
      height: 80,
      duration: 1,
      frameRate: 60,
      backgroundColor: { red: 255, green: 255, blue: 255 },
      layers: [{
        type: LayerType.Image as const,
        id: 1,
        name: 'Photo',
        isActive: true,
        autoOrientation: false,
        parentId: null,
        stretch: { numerator: 1, denominator: 1 },
        startTime: 0,
        duration: 1,
        blendMode: BlendMode.Normal,
        trackMatteType: 0,
        transform: defaultTransform2D({
          anchorPoint: { x: 5, y: 10 },
          position: { x: 50, y: 40 },
          scale: { x: 10, y: 4 },
        }),
        masks: [],
        imageId: 1,
      }, {
        type: LayerType.Image as const,
        id: 2,
        name: 'PhotoDup',
        isActive: true,
        autoOrientation: false,
        parentId: null,
        stretch: { numerator: 1, denominator: 1 },
        startTime: 0,
        duration: 1,
        blendMode: BlendMode.Normal,
        trackMatteType: 0,
        transform: defaultTransform2D({
          anchorPoint: { x: 5, y: 10 },
          position: { x: 50, y: 40 },
        }),
        masks: [],
        imageId: 1, // shared ImageBytes (AE footage dedupe)
      }],
    }],
    images: [{
      id: 1,
      fileBytes: png,
      width: 10,
      height: 20,
      scaleFactor: 1,
      anchorX: 0,
      anchorY: 0,
    }],
    fonts: [],
  };

  const bytes = encodePagFile(file);
  assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2]), 'PAG');
  assert.equal(bytes[8], 'U'.charCodeAt(0));
  let foundPng = false;
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    if (
      bytes[i] === 0x89
      && bytes[i + 1] === 0x50
      && bytes[i + 2] === 0x4e
      && bytes[i + 3] === 0x47
    ) {
      foundPng = true;
      break;
    }
  }
  assert.ok(foundPng, 'should embed PNG file bytes');
  assert.ok(bytes.includes(LayerType.Image), 'should encode Image layer type');
  let foundImageBytesTag = false;
  for (let i = 0; i + 1 < bytes.length; i += 1) {
    const header = bytes[i] | (bytes[i + 1] << 8);
    if ((header >> 6) === TagCode.ImageBytesV3) {
      foundImageBytesTag = true;
      break;
    }
  }
  assert.ok(foundImageBytesTag, 'should encode ImageBytesV3 tag');
  assert.equal(file.images.length, 1);
}

testEncodeStreamBasics();
testFigmaBlendModeMapping();
testMinimalShapePag();
testOpacityAndPath();
testMapNodeEffects();
testEffectAndLayerStyleTags();
testKeyframes();
testMaskAndMotionPag();
testSizeAnimationUsesShapeSizeNotCenterScale();
testSolidMarkerParse();
testSolidLayerEncode();
testReadEncodedImageSize();
testScaleFromImagePaint();
testImageLayerPagEncode();
console.log('pag-export tests passed');

/** Frame10-like PAG encode smoke: real JPEG → ImageBytesV3 + ImageLayer. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { encodePagFile } from '../src/export/pag/encode/encode-file';
import { TagCode } from '../src/export/pag/encode/tag-code';
import { readEncodedImageSize, scaleFromImagePaint } from '../src/export/pag/image-bytes';
import {
  BlendMode,
  LayerType,
  defaultTransform2D,
} from '../src/export/pag/types';

const jpegPath = path.join(__dirname, 'fixtures', 'frame10-sample.bin');
if (!fs.existsSync(jpegPath)) {
  console.log('skip frame10 verify: missing fixtures/frame10-sample.bin (download Frame10 asset first)');
  process.exit(0);
}
const jpeg = new Uint8Array(fs.readFileSync(jpegPath));
const size = readEncodedImageSize(jpeg);
assert.equal(size.width, 1440);
assert.equal(size.height, 3200);

const nodeW = 400;
const nodeH = 889;
const frameW = 400;
const frameH = 600;
const diagnostics: import('../src/export/types').Diagnostic[] = [];
const scale = scaleFromImagePaint(
  { type: 'IMAGE', scaleMode: 'FILL', imageHash: 'frame10' },
  nodeW,
  nodeH,
  size.width,
  size.height,
  diagnostics,
);
const expected = Math.max(nodeW / size.width, nodeH / size.height);
assert.ok(Math.abs(scale.x - expected) < 1e-6);
assert.equal(scale.x, scale.y);

const file = {
  compositions: [{
    id: 1,
    width: frameW,
    height: frameH,
    duration: 1,
    frameRate: 60,
    backgroundColor: { red: 147, green: 201, blue: 146 },
    layers: [{
      type: LayerType.Image as const,
      id: 1,
      name: 'IMG_18581',
      isActive: true,
      autoOrientation: false,
      parentId: null,
      stretch: { numerator: 1, denominator: 1 },
      startTime: 0,
      duration: 1,
      blendMode: BlendMode.Normal,
      trackMatteType: 0,
      transform: defaultTransform2D({
        anchorPoint: { x: size.width / 2, y: size.height / 2 },
        position: { x: nodeW / 2, y: nodeH / 2 },
        scale,
      }),
      masks: [],
      imageId: 1,
    }],
  }],
  images: [{
    id: 1,
    fileBytes: jpeg,
    width: size.width,
    height: size.height,
    scaleFactor: 1,
    anchorX: 0,
    anchorY: 0,
  }],
  fonts: [],
};

const bytes = encodePagFile(file);
assert.equal(String.fromCharCode(bytes[0], bytes[1], bytes[2]), 'PAG');
assert.equal(bytes[3], 1);
assert.equal(bytes[8], 'U'.charCodeAt(0));

let foundImageBytesTag = false;
for (let i = 0; i + 1 < bytes.length; i += 1) {
  const header = bytes[i] | (bytes[i + 1] << 8);
  if ((header >> 6) === TagCode.ImageBytesV3) {
    foundImageBytesTag = true;
    break;
  }
}
assert.ok(foundImageBytesTag);

const outPath = path.join(__dirname, 'fixtures', 'frame10-image.pag');
fs.writeFileSync(outPath, bytes);
console.log(
  `frame10 verify ok: ${size.width}x${size.height} jpeg → ${bytes.length} byte .pag (scale=${scale.x.toFixed(4)}) → ${outPath}`,
);
console.log('Open fixtures/frame10-image.pag in PAGViewer to confirm visual (composition 400x600 clips 889-tall layer).');

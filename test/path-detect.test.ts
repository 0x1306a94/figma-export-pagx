import { canonicalizePathData, parseSvgPath } from '../src/export/shared/path';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const paths = {
  bg: 'M800 0 L0 0 L0 800 L800 800 L800 0 Z',
  rect: 'M143 0 L0 0 L0 234 L143 234 L143 0 Z',
  rounded: 'M239 0 L20 0 C8.9543 0 0 8.9543 0 20 L0 183 C0 194.046 8.9543 203 20 203 L239 203 C250.046 203 259 194.046 259 183 L259 20 C259 8.9543 250.046 0 239 0 Z',
  diamond: 'M96 38 L245 0 L245 202 L0 202 L96 38 Z',
  ellipse: 'M50 100 C77.6142 100 100 77.6142 100 50 C100 22.3858 77.6142 0 50 0 C22.3858 0 0 22.3858 0 50 C0 77.6142 22.3858 100 50 100 Z',
};

assert(canonicalizePathData(paths.bg).kind === 'rectangle', 'bg should be rectangle');
assert(canonicalizePathData(paths.rect).kind === 'rectangle', 'rect should be rectangle');
assert(canonicalizePathData(paths.rounded).kind === 'rectangle', 'rounded should be rectangle');
assert(canonicalizePathData(paths.diamond).kind === 'path', 'diamond should stay path');
assert(canonicalizePathData(paths.ellipse).kind === 'ellipse', 'ellipse should be ellipse');

const bgShape = canonicalizePathData(paths.bg);
if (bgShape.kind === 'rectangle') {
  assert(bgShape.width === 800 && bgShape.height === 800, 'bg size mismatch');
}

const roundedShape = canonicalizePathData(paths.rounded);
if (roundedShape.kind === 'rectangle') {
  assert(roundedShape.roundness !== undefined && Math.abs(roundedShape.roundness - 20) < 1, 'rounded rect roundness should be ~20');
}

assert(parseSvgPath(paths.bg).points.length >= 4, 'parser should read bg points');

console.log('path-detect tests passed');

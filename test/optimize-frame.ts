import { readFileSync, writeFileSync } from 'node:fs';
import { shapeElementFromPathData } from '../src/export/path-detect';

function attrsToString(attrs: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
}

function replacePathTags(xml: string): string {
  return xml.replace(/<Path data="([^"]+)"\/>/g, (_match, data: string) => {
    const shape = shapeElementFromPathData(data);
    if (shape.kind === 'rectangle') {
      return `<Rectangle ${attrsToString(shape.attrs)}/>`;
    }
    if (shape.kind === 'ellipse') {
      return `<Ellipse ${attrsToString(shape.attrs)}/>`;
    }
    return `<Path data="${data}"/>`;
  });
}

const input = process.argv[2];
if (!input) {
  throw new Error('usage: node optimize-frame.ts <input.pagx> [output.pagx]');
}
const output = process.argv[3] ?? input.replace(/\.pagx$/, '.optimized.pagx');
writeFileSync(output, replacePathTags(readFileSync(input, 'utf8')));
console.log(`wrote ${output}`);

/** File / Composition encoder aligned with libpag Codec::Encode + FileTags. */

import {
  ColorBlack,
  PAG_VERSION,
  PagFile,
  PagImageBytes,
  PagVectorComposition,
  LayerType,
} from '../types';
import { EncodeContext, writeLayer } from './encode-layer';
import { EncodeStream } from './encode-stream';
import { writeColor, writeTime } from './data-types';
import { TagCode, writeEndTag, writeTagHeader } from './tag-code';

function writeTag(
  stream: EncodeStream,
  writer: (bytes: EncodeStream) => TagCode,
): void {
  const bytes = new EncodeStream();
  const code = writer(bytes);
  writeTagHeader(stream, bytes, code);
}

function writeCompositionAttributes(stream: EncodeStream, composition: PagVectorComposition): TagCode {
  stream.writeEncodedInt32(composition.width);
  stream.writeEncodedInt32(composition.height);
  writeTime(stream, composition.duration);
  stream.writeFloat(composition.frameRate);
  writeColor(stream, composition.backgroundColor);
  return TagCode.CompositionAttributes;
}

function writeVectorComposition(
  stream: EncodeStream,
  composition: PagVectorComposition,
  ctx: EncodeContext,
): TagCode {
  stream.writeEncodedUint32(composition.id);
  writeTag(stream, (bytes) => writeCompositionAttributes(bytes, composition));
  for (const layer of composition.layers) {
    writeTag(stream, (bytes) => writeLayer(bytes, layer, ctx));
  }
  writeEndTag(stream);
  return TagCode.VectorCompositionBlock;
}

function writeFontTables(
  stream: EncodeStream,
  fonts: Array<{ fontFamily: string; fontStyle: string }>,
  ctx: EncodeContext,
): TagCode {
  stream.writeEncodedUint32(fonts.length);
  fonts.forEach((font, index) => {
    stream.writeUTF8String(font.fontFamily);
    stream.writeUTF8String(font.fontStyle);
    ctx.fontIdByKey.set(`${font.fontFamily} - ${font.fontStyle}`, index);
  });
  return TagCode.FontTables;
}

function writeImageBytesV3(stream: EncodeStream, image: PagImageBytes): TagCode {
  stream.writeEncodedUint32(image.id);
  stream.writeByteData(image.fileBytes);
  stream.writeFloat(image.scaleFactor);
  stream.writeEncodedInt32(image.width);
  stream.writeEncodedInt32(image.height);
  stream.writeEncodedInt32(image.anchorX);
  stream.writeEncodedInt32(image.anchorY);
  return TagCode.ImageBytesV3;
}

function collectFonts(file: PagFile): Array<{ fontFamily: string; fontStyle: string }> {
  if (file.fonts.length > 0) {
    return file.fonts;
  }
  const fonts: Array<{ fontFamily: string; fontStyle: string }> = [];
  const seen = new Set<string>();
  for (const composition of file.compositions) {
    for (const layer of composition.layers) {
      if (layer.type !== LayerType.Text) {
        continue;
      }
      const key = `${layer.sourceText.fontFamily}|${layer.sourceText.fontStyle}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      fonts.push({
        fontFamily: layer.sourceText.fontFamily,
        fontStyle: layer.sourceText.fontStyle,
      });
    }
  }
  return fonts;
}

function writeTagsOfFile(stream: EncodeStream, file: PagFile, ctx: EncodeContext): void {
  const fonts = collectFonts(file);
  if (fonts.length > 0) {
    writeTag(stream, (bytes) => writeFontTables(bytes, fonts, ctx));
  }
  for (const image of file.images) {
    if (image.fileBytes.length === 0) {
      continue;
    }
    writeTag(stream, (bytes) => writeImageBytesV3(bytes, image));
  }
  for (const composition of file.compositions) {
    writeTag(stream, (bytes) => writeVectorComposition(bytes, composition, ctx));
  }
  writeEndTag(stream);
}

/** Encode PagFile IR to .pag binary bytes. */
export function encodePagFile(file: PagFile): Uint8Array {
  const ctx: EncodeContext = { fontIdByKey: new Map() };
  const body = new EncodeStream();
  writeTagsOfFile(body, file, ctx);

  const fileBytes = new EncodeStream();
  fileBytes.writeInt8('P'.charCodeAt(0));
  fileBytes.writeInt8('A'.charCodeAt(0));
  fileBytes.writeInt8('G'.charCodeAt(0));
  fileBytes.writeUint8(PAG_VERSION);
  fileBytes.writeUint32(body.length());
  fileBytes.writeInt8('U'.charCodeAt(0)); // UNCOMPRESSED
  fileBytes.writeBytes(body);
  return fileBytes.release();
}

export function emptyComposition(
  id: number,
  width: number,
  height: number,
  frameRate = 60,
  duration = 1,
): PagVectorComposition {
  return {
    id,
    width,
    height,
    duration,
    frameRate,
    backgroundColor: ColorBlack,
    layers: [],
  };
}

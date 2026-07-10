/** TagCode values from libpag include/pag/file.h */

export enum TagCode {
  End = 0,
  FontTables = 1,
  VectorCompositionBlock = 2,
  CompositionAttributes = 3,
  ImageTables = 4,
  LayerBlock = 5,
  LayerAttributes = 6,
  SolidColor = 7,
  TextSource = 8,
  ImageReference = 11,
  CompositionReference = 12,
  Transform2D = 13,
  MaskBlock = 14,
  ShapeGroup = 15,
  Rectangle = 16,
  Ellipse = 17,
  PolyStar = 18,
  ShapePath = 19,
  Fill = 20,
  Stroke = 21,
  GradientFill = 22,
  GradientStroke = 23,
  MergePaths = 24,
  TrimPaths = 25,
  Repeater = 26,
  RoundCorners = 27,
  FileAttributes = 31,
  ImageBytes = 47,
  ImageBytesV2 = 48,
  ImageBytesV3 = 49,
  LayerAttributesV2 = 52,
  MarkerList = 53,
  LayerAttributesV3 = 62,
  TextSourceV2 = 64,
  TextSourceV3 = 68,
  MaskBlockV2 = 84,
}

export function writeTagHeader(stream: { writeUint16: (v: number) => void; writeUint32: (v: number) => void; writeBytes: (s: { data: () => Uint8Array } | Uint8Array) => void }, tagBytes: { length: () => number; data: () => Uint8Array }, code: TagCode): void {
  const length = tagBytes.length();
  let typeAndLength = (code << 6) & 0xffff;
  if (length < 63) {
    typeAndLength |= length;
    stream.writeUint16(typeAndLength);
  } else {
    typeAndLength |= 63;
    stream.writeUint16(typeAndLength);
    stream.writeUint32(length);
  }
  stream.writeBytes(tagBytes);
}

export function writeEndTag(stream: { writeUint16: (v: number) => void }): void {
  stream.writeUint16(0);
}

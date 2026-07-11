/** ImageBytes helpers aligned with AE footage model (hash dedupe + scaleMode → Transform). */

import type { Diagnostic } from '../types';
import { addDiagnostic } from '../figma-reader';
import type { PagImageBytes, PagPoint } from './types';

export type ImageBytesContext = {
  diagnostics: Diagnostic[];
  nextImageId: number;
  images: PagImageBytes[];
  imageIdByHash: Map<string, number>;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUint16Be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  );
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 24) {
    return false;
  }
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes)) {
    return null;
  }
  // IHDR: length(4) + 'IHDR'(4) + width(4) + height(4) starts at offset 8
  const width = readUint32Be(bytes, 16);
  const height = readUint32Be(bytes, 20);
  if (width < 1 || height < 1) {
    return null;
  }
  return { width, height };
}

function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = readUint16Be(bytes, offset + 5);
      const width = readUint16Be(bytes, offset + 7);
      if (width < 1 || height < 1) {
        return null;
      }
      return { width, height };
    }
    const segmentLength = readUint16Be(bytes, offset + 2);
    if (segmentLength < 2) {
      break;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

/** Parse intrinsic pixel size from PNG or JPEG bytes. */
export function readEncodedImageSize(bytes: Uint8Array): { width: number; height: number } {
  const png = readPngSize(bytes);
  if (png) {
    return png;
  }
  const jpeg = readJpegSize(bytes);
  if (jpeg) {
    return jpeg;
  }
  throw new Error('无法解析图片尺寸（仅支持 PNG / JPEG）');
}

function stretchScale(nodeW: number, nodeH: number, imgW: number, imgH: number): PagPoint {
  return {
    x: imgW > 0 ? nodeW / imgW : 1,
    y: imgH > 0 ? nodeH / imgH : 1,
  };
}

function uniformCoverScale(nodeW: number, nodeH: number, imgW: number, imgH: number): PagPoint {
  const scale = Math.max(nodeW / imgW, nodeH / imgH);
  return { x: scale, y: scale };
}

function uniformContainScale(nodeW: number, nodeH: number, imgW: number, imgH: number): PagPoint {
  const scale = Math.min(nodeW / imgW, nodeH / imgH);
  return { x: scale, y: scale };
}

function scaleFromCropTransform(
  transform: Transform,
  nodeW: number,
  nodeH: number,
  imgW: number,
  imgH: number,
): PagPoint | null {
  const scaleX = transform[0][0];
  const scaleY = transform[1][1];
  if (
    !Number.isFinite(scaleX)
    || !Number.isFinite(scaleY)
    || Math.abs(scaleX) < 1e-6
    || Math.abs(scaleY) < 1e-6
  ) {
    return null;
  }
  // Figma CROP imageTransform: |a|/|d| ≈ visible fraction of image mapped onto the node.
  return {
    x: nodeW / (imgW * Math.abs(scaleX)),
    y: nodeH / (imgH * Math.abs(scaleY)),
  };
}

/**
 * Map Figma ImagePaint scaleMode → PAG Transform2D scale (footage intrinsic → node box).
 */
export function scaleFromImagePaint(
  paint: ImagePaint,
  nodeW: number,
  nodeH: number,
  imgW: number,
  imgH: number,
  diagnostics: Diagnostic[],
  nodeId?: string,
): PagPoint {
  const safeNodeW = Math.max(1, nodeW);
  const safeNodeH = Math.max(1, nodeH);
  const safeImgW = Math.max(1, imgW);
  const safeImgH = Math.max(1, imgH);

  if (paint.scaleMode === 'FILL') {
    return uniformCoverScale(safeNodeW, safeNodeH, safeImgW, safeImgH);
  }
  if (paint.scaleMode === 'FIT') {
    return uniformContainScale(safeNodeW, safeNodeH, safeImgW, safeImgH);
  }
  if (paint.scaleMode === 'CROP') {
    if (paint.imageTransform) {
      const cropped = scaleFromCropTransform(
        paint.imageTransform,
        safeNodeW,
        safeNodeH,
        safeImgW,
        safeImgH,
      );
      if (cropped) {
        return cropped;
      }
    }
    addDiagnostic(
      diagnostics,
      'warning',
      'IMAGE_CROP_FALLBACK',
      'CROP imageTransform 无法解析，已回退为 FILL',
      nodeId,
    );
    return uniformCoverScale(safeNodeW, safeNodeH, safeImgW, safeImgH);
  }
  if (paint.scaleMode === 'TILE') {
    addDiagnostic(
      diagnostics,
      'warning',
      'IMAGE_TILE_UNSUPPORTED',
      'TILE 缩放模式暂不支持，已回退为 stretch',
      nodeId,
    );
  }
  return stretchScale(safeNodeW, safeNodeH, safeImgW, safeImgH);
}

/**
 * Load / dedupe ImageBytes by Figma imageHash (AE footage-id style).
 * Passes through original PNG/JPEG bytes without re-encoding.
 */
export async function ensureImageBytes(
  imageHash: string,
  ctx: ImageBytesContext,
  nodeId?: string,
): Promise<{ id: number; width: number; height: number }> {
  const existingId = ctx.imageIdByHash.get(imageHash);
  if (existingId !== undefined) {
    const existing = ctx.images.find((image) => image.id === existingId);
    if (existing) {
      return { id: existing.id, width: existing.width, height: existing.height };
    }
  }

  const image = figma.getImageByHash(imageHash);
  if (!image) {
    throw new Error(`找不到 imageHash=${imageHash}`);
  }
  const fileBytes = await image.getBytesAsync();
  let width: number;
  let height: number;
  try {
    const size = readEncodedImageSize(fileBytes);
    width = size.width;
    height = size.height;
  } catch (error) {
    addDiagnostic(
      ctx.diagnostics,
      'warning',
      'IMAGE_SIZE_PARSE_FAILED',
      `图片尺寸解析失败: ${error instanceof Error ? error.message : String(error)}`,
      nodeId,
    );
    throw error;
  }

  const id = ctx.nextImageId;
  ctx.nextImageId += 1;
  ctx.images.push({
    id,
    fileBytes,
    width,
    height,
    scaleFactor: 1,
    anchorX: 0,
    anchorY: 0,
  });
  ctx.imageIdByHash.set(imageHash, id);
  return { id, width, height };
}

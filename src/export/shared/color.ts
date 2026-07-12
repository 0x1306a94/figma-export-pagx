function clampByte(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function toHexByte(value: number): string {
  return clampByte(value).toString(16).padStart(2, '0');
}

export function rgbaToHex(color: RGB | RGBA, opacity = 1): string {
  const alpha = 'a' in color ? color.a * opacity : opacity;
  if (alpha >= 1) {
    return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
  }
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}${toHexByte(alpha)}`;
}

export function roundDimension(value: number): number {
  return Math.round(value * 100) / 100;
}

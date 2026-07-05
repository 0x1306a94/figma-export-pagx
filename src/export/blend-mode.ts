const FIGMA_TO_PAGX_BLEND: Record<BlendMode, string> = {
  PASS_THROUGH: 'normal',
  NORMAL: 'normal',
  MULTIPLY: 'multiply',
  SCREEN: 'screen',
  OVERLAY: 'overlay',
  DARKEN: 'darken',
  LIGHTEN: 'lighten',
  COLOR_DODGE: 'colorDodge',
  COLOR_BURN: 'colorBurn',
  HARD_LIGHT: 'hardLight',
  SOFT_LIGHT: 'softLight',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LINEAR_DODGE: 'colorDodge',
  LINEAR_BURN: 'colorBurn',
  LUMINOSITY: 'luminosity',
};

export function mapBlendMode(mode: BlendMode): string {
  return FIGMA_TO_PAGX_BLEND[mode] ?? 'normal';
}

/** PAG LayerStyle writers aligned with libpag LayerStyleTag.cpp. */

import { BlendMode, ColorBlack, PagLayerStyle } from '../types';
import {
  AttributeType,
  colorConfig,
  floatConfig,
  opacityConfig,
  uint8Config,
  writeTagBlock,
} from './attribute-helper';
import { EncodeStream } from './encode-stream';
import { TagCode } from './tag-code';

export function writeLayerStyles(stream: EncodeStream, styles: PagLayerStyle[]): void {
  for (const style of styles) {
    if (style.kind !== 'dropShadow') {
      continue;
    }
    writeTagBlock(stream, {
      tagCode: TagCode.DropShadowStyleV2,
      configs: [
        uint8Config(AttributeType.DiscreteProperty, BlendMode.Normal, () => style.blendMode),
        colorConfig(AttributeType.SimpleProperty, ColorBlack, () => style.color),
        opacityConfig(AttributeType.SimpleProperty, () => style.opacity, 191),
        floatConfig(AttributeType.SimpleProperty, 120, () => style.angle),
        floatConfig(AttributeType.SimpleProperty, 5, () => style.distance),
        floatConfig(AttributeType.SimpleProperty, 5, () => style.size),
        floatConfig(AttributeType.SimpleProperty, 0, () => style.spread),
      ],
    });
  }
}

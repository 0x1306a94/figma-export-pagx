/** PAG Effect writers aligned with libpag EffectTag.cpp. */

import { PagEffect, PagBlurDimensions } from '../types';
import {
  AttributeType,
  booleanConfig,
  floatConfig,
  opacityConfig,
  uint8Config,
  writeTagBlock,
} from './attribute-helper';
import { EncodeStream } from './encode-stream';
import { TagCode } from './tag-code';

export function writeEffects(stream: EncodeStream, effects: PagEffect[]): void {
  for (const effect of effects) {
    if (effect.kind !== 'fastBlur') {
      continue;
    }
    writeTagBlock(stream, {
      tagCode: TagCode.FastBlurEffect,
      configs: [
        floatConfig(AttributeType.SimpleProperty, 0, () => effect.blurriness),
        uint8Config(
          AttributeType.DiscreteProperty,
          PagBlurDimensions.All,
          () => effect.blurDimensions,
        ),
        booleanConfig(
          AttributeType.DiscreteProperty,
          false,
          () => effect.repeatEdgePixels,
        ),
        opacityConfig(AttributeType.SimpleProperty, () => effect.effectOpacity),
        {
          attributeType: AttributeType.Custom,
          defaultValue: null,
          get: () => null,
          writeValue: () => undefined,
          writeCustom: () => false,
        },
      ],
    });
  }
}

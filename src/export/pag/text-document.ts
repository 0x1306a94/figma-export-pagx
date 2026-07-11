/** Figma TextNode → PagTextDocument（对齐 AE TextDocument + PAG 官方点/框规则） */

import { roundDimension } from '../color';
import { addDiagnostic } from '../figma-reader';
import type { Diagnostic } from '../types';
import {
  ColorBlack,
  ParagraphJustification,
  type PagColor,
  type PagPoint,
  type PagTextDocument,
} from './types';

export type TextLayoutMode = 'point' | 'box';

const FIRST_BASELINE_FACTOR = 0.8;

export function textLayoutModeFromAutoResize(autoResize: string): TextLayoutMode {
  return autoResize === 'WIDTH_AND_HEIGHT' ? 'point' : 'box';
}

export function estimateFirstBaseLine(fontSize: number): number {
  return fontSize * FIRST_BASELINE_FACTOR;
}

export function justificationFromAlign(align: string): ParagraphJustification {
  switch (align) {
    case 'CENTER':
      return ParagraphJustification.CenterJustify;
    case 'RIGHT':
      return ParagraphJustification.RightJustify;
    case 'JUSTIFIED':
      return ParagraphJustification.FullJustifyLastLineLeft;
    default:
      return ParagraphJustification.LeftJustify;
  }
}

export function leadingFromLineHeight(
  lineHeight: { unit: string; value?: number } | null,
  fontSize: number,
): number {
  if (!lineHeight) {
    return 0;
  }
  if (lineHeight.unit === 'AUTO') {
    return 0;
  }
  if (lineHeight.unit === 'PIXELS' && typeof lineHeight.value === 'number') {
    return lineHeight.value;
  }
  if (lineHeight.unit === 'PERCENT' && typeof lineHeight.value === 'number') {
    return (fontSize * lineHeight.value) / 100;
  }
  return 0;
}

export function trackingFromLetterSpacing(
  letterSpacing: { unit: string; value?: number } | null,
  fontSize: number,
): number {
  if (!letterSpacing) {
    return 0;
  }
  if (letterSpacing.unit === 'PIXELS' && typeof letterSpacing.value === 'number') {
    if (fontSize <= 0) {
      return 0;
    }
    return Math.round((letterSpacing.value / fontSize) * 1000);
  }
  if (letterSpacing.unit === 'PERCENT' && typeof letterSpacing.value === 'number') {
    return letterSpacing.value * 10;
  }
  return 0;
}

export function pointTextAnchorPosition(input: {
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  align: string;
}): { anchor: PagPoint; position: PagPoint } {
  const baselineY = input.top + estimateFirstBaseLine(input.fontSize);
  let positionX = input.left;
  if (input.align === 'CENTER') {
    positionX = input.left + input.width / 2;
  } else if (input.align === 'RIGHT') {
    positionX = input.left + input.width;
  }
  return {
    anchor: { x: 0, y: 0 },
    position: { x: positionX, y: baselineY },
  };
}

export function buildTextDocumentFields(input: {
  mode: TextLayoutMode;
  size: { width: number; height: number };
  fontSize: number;
  fontFamily: string;
  fontStyle: string;
  text: string;
  align: string;
  lineHeight: { unit: string; value?: number } | null;
  letterSpacing: { unit: string; value?: number } | null;
  fillColor: PagColor;
}): PagTextDocument {
  const shared = {
    applyFill: true,
    applyStroke: false,
    fauxBold: false,
    fauxItalic: false,
    strokeOverFill: true,
    baselineShift: 0,
    fillColor: input.fillColor,
    fontSize: input.fontSize,
    strokeColor: ColorBlack,
    strokeWidth: 1,
    text: input.text,
    justification: justificationFromAlign(input.align),
    leading: leadingFromLineHeight(input.lineHeight, input.fontSize),
    tracking: trackingFromLetterSpacing(input.letterSpacing, input.fontSize),
    fontFamily: input.fontFamily,
    fontStyle: input.fontStyle,
  };

  if (input.mode === 'point') {
    return {
      ...shared,
      boxText: false,
      firstBaseLine: 0,
      boxTextPos: { x: 0, y: 0 },
      boxTextSize: { x: 0, y: 0 },
    };
  }

  return {
    ...shared,
    boxText: true,
    firstBaseLine: estimateFirstBaseLine(input.fontSize),
    boxTextPos: { x: 0, y: 0 },
    boxTextSize: { x: input.size.width, y: input.size.height },
  };
}

function resolveUnitValue(
  value: { unit: string; value?: number } | PluginAPI['mixed'],
): { unit: string; value?: number } | null {
  if (value === figma.mixed || !value || typeof value !== 'object') {
    return null;
  }
  return value as { unit: string; value?: number };
}

export function buildTextDocument(
  node: TextNode,
  size: { width: number; height: number },
  diagnostics: Diagnostic[],
  fillColor: PagColor = ColorBlack,
): PagTextDocument {
  const mixedFont = node.fontName === figma.mixed;
  const mixedSize = node.fontSize === figma.mixed;
  const fontFamily = mixedFont ? 'Inter' : (node.fontName as FontName).family;
  const fontStyle = mixedFont ? 'Regular' : ((node.fontName as FontName).style || 'Regular');
  const fontSize = mixedSize ? 12 : roundDimension(node.fontSize as number);
  const mode = textLayoutModeFromAutoResize(node.textAutoResize);
  // textAlignHorizontal 类型不含 mixed；运行时仍可能异常，兜底 LEFT
  const align = typeof node.textAlignHorizontal === 'string' ? node.textAlignHorizontal : 'LEFT';

  if (mixedFont || mixedSize) {
    addDiagnostic(
      diagnostics,
      'warning',
      'TEXT_MIXED_STYLE',
      '文本含混合样式，已取默认值',
      node.id,
    );
  }
  if (mode === 'box' && node.textAutoResize === 'NONE' && node.textAlignVertical === 'TOP') {
    addDiagnostic(
      diagnostics,
      'warning',
      'TEXT_BOX_VERTICAL_CENTER',
      '固定框顶对齐在 PAG 框文本中可能被强制垂直居中（见 pag.io 文本规则）',
      node.id,
    );
  }
  if (node.textAlignVertical === 'BOTTOM') {
    addDiagnostic(
      diagnostics,
      'warning',
      'TEXT_VERTICAL_ALIGN',
      'PAG 框文本无底对齐，已按框文本默认规则导出',
      node.id,
    );
  }
  if (node.textAutoResize === 'TRUNCATE') {
    addDiagnostic(
      diagnostics,
      'warning',
      'TEXT_TRUNCATE_AS_BOX',
      'TRUNCATE 按框文本导出（高度外裁切依赖 PAG 运行时）',
      node.id,
    );
  }

  return buildTextDocumentFields({
    mode,
    size,
    fontSize,
    fontFamily,
    fontStyle,
    text: node.characters,
    align,
    lineHeight: resolveUnitValue(node.lineHeight),
    letterSpacing: resolveUnitValue(node.letterSpacing),
    fillColor,
  });
}

import type { ColorSource, ColorStop, Diagnostic, PagxElement } from './types';
import { rgbaToHex, roundDimension } from './color';
import { mapBlendMode } from './blend-mode';

export function addDiagnostic(
  diagnostics: Diagnostic[],
  level: Diagnostic['level'],
  code: string,
  message: string,
  nodeId?: string,
): void {
  diagnostics.push({ level, code, message, nodeId });
}

function paintOpacity(paint: SolidPaint | GradientPaint | ImagePaint): number {
  return paint.opacity ?? 1;
}

function paintAttrs(paint: Paint): Record<string, string | number | boolean> {
  if ('blendMode' in paint && paint.blendMode && paint.blendMode !== 'NORMAL') {
    return { blendMode: mapBlendMode(paint.blendMode) };
  }
  return {};
}

function gradientStops(paint: GradientPaint): ColorStop[] {
  return paint.gradientStops.map((stop) => ({
    offset: roundDimension(stop.position),
    color: rgbaToHex(stop.color, paintOpacity(paint)),
  }));
}

export function paintToColorSource(
  paint: Paint,
  nodeId: string,
  diagnostics: Diagnostic[],
): ColorSource | undefined {
  if (paint.type === 'SOLID') {
    if (paint.visible === false) {
      return undefined;
    }
    return { kind: 'solid', color: rgbaToHex(paint.color, paintOpacity(paint)) };
  }

  if (paint.visible === false) {
    return undefined;
  }

  if (paint.type === 'GRADIENT_LINEAR') {
    return {
      kind: 'linearGradient',
      startPoint: '0,0.5',
      endPoint: '1,0.5',
      stops: gradientStops(paint),
    };
  }

  if (paint.type === 'GRADIENT_RADIAL') {
    return {
      kind: 'radialGradient',
      center: '0.5,0.5',
      radius: 0.5,
      stops: gradientStops(paint),
    };
  }

  if (paint.type === 'GRADIENT_ANGULAR') {
    return {
      kind: 'conicGradient',
      center: '0.5,0.5',
      startAngle: 0,
      endAngle: 360,
      stops: gradientStops(paint),
    };
  }

  if (paint.type === 'GRADIENT_DIAMOND') {
    return {
      kind: 'diamondGradient',
      center: '0.5,0.5',
      radius: 0.5,
      stops: gradientStops(paint),
    };
  }

  if (paint.type === 'IMAGE') {
    return undefined;
  }

  addDiagnostic(diagnostics, 'warning', 'UNSUPPORTED_PAINT', `不支持的填充类型 ${paint.type}`, nodeId);
  return undefined;
}

export function fillsToElements(
  fills: ReadonlyArray<Paint> | typeof figma.mixed,
  nodeId: string,
  diagnostics: Diagnostic[],
): PagxElement[] {
  if (fills === figma.mixed || !Array.isArray(fills)) {
    return [];
  }

  const elements: PagxElement[] = [];
  for (const paint of fills) {
    const colorSource = paintToColorSource(paint, nodeId, diagnostics);
    if (!colorSource) {
      continue;
    }
    if (colorSource.kind === 'solid') {
      elements.push({
        kind: 'fill',
        attrs: { ...paintAttrs(paint), color: colorSource.color },
      });
    } else {
      elements.push({
        kind: 'fill',
        attrs: paintAttrs(paint),
        colorSource,
      });
    }
  }
  return elements;
}

export function strokesToElements(
  strokes: ReadonlyArray<Paint> | typeof figma.mixed,
  node: GeometryMixin & MinimalStrokesMixin,
  nodeId: string,
  diagnostics: Diagnostic[],
): PagxElement[] {
  if (strokes === figma.mixed || !Array.isArray(strokes) || node.strokeWeight === figma.mixed) {
    return [];
  }

  const weight = typeof node.strokeWeight === 'number' ? node.strokeWeight : 0;
  if (weight <= 0 || strokes.length === 0) {
    return [];
  }

  const elements: PagxElement[] = [];
  for (const paint of strokes) {
    const colorSource = paintToColorSource(paint, nodeId, diagnostics);
    if (!colorSource) {
      continue;
    }
    const attrs: Record<string, string | number | boolean> = {
      ...paintAttrs(paint),
      width: roundDimension(weight),
    };
    if (node.strokeAlign === 'INSIDE') {
      attrs.align = 'inside';
    } else if (node.strokeAlign === 'OUTSIDE') {
      attrs.align = 'outside';
    }
    if (colorSource.kind === 'solid') {
      elements.push({
        kind: 'stroke',
        attrs: { ...attrs, color: colorSource.color },
      });
    } else {
      elements.push({
        kind: 'stroke',
        attrs,
        colorSource,
      });
    }
  }
  return elements;
}

export function effectsToElements(
  effects: ReadonlyArray<Effect>,
  nodeId: string,
  diagnostics: Diagnostic[],
): PagxElement[] {
  const elements: PagxElement[] = [];

  for (const effect of effects) {
    if (effect.visible === false) {
      continue;
    }

    if (effect.type === 'DROP_SHADOW') {
      elements.push({
        kind: 'dropShadowStyle',
        attrs: {
          offsetX: roundDimension(effect.offset.x),
          offsetY: roundDimension(effect.offset.y),
          blurX: roundDimension(effect.radius),
          blurY: roundDimension(effect.radius),
          color: rgbaToHex(effect.color),
          showBehindLayer: !effect.showShadowBehindNode,
        },
      });
      continue;
    }

    if (effect.type === 'INNER_SHADOW') {
      elements.push({
        kind: 'innerShadowStyle',
        attrs: {
          offsetX: roundDimension(effect.offset.x),
          offsetY: roundDimension(effect.offset.y),
          blurX: roundDimension(effect.radius),
          blurY: roundDimension(effect.radius),
          color: rgbaToHex(effect.color),
        },
      });
      continue;
    }

    if (effect.type === 'LAYER_BLUR') {
      elements.push({
        kind: 'blurFilter',
        attrs: {
          blurX: roundDimension(effect.radius),
          blurY: roundDimension(effect.radius),
        },
      });
      continue;
    }

    if (effect.type === 'BACKGROUND_BLUR') {
      elements.push({
        kind: 'backgroundBlurStyle',
        attrs: {
          blurX: roundDimension(effect.radius),
          blurY: roundDimension(effect.radius),
        },
      });
      continue;
    }

    if (effect.type === 'GLASS') {
      continue;
    }

    addDiagnostic(
      diagnostics,
      'warning',
      'UNSUPPORTED_EFFECT',
      `不支持的效果类型 ${effect.type}`,
      nodeId,
    );
  }

  return elements;
}

export function readCornerRadius(
  node: RectangleNode,
  nodeId: string,
  diagnostics: Diagnostic[],
): number {
  if (typeof node.cornerRadius === 'number') {
    return roundDimension(node.cornerRadius);
  }

  const radii = [
    node.topLeftRadius,
    node.topRightRadius,
    node.bottomRightRadius,
    node.bottomLeftRadius,
  ];
  const maxRadius = Math.max(...radii);
  addDiagnostic(
    diagnostics,
    'warning',
    'MIXED_CORNER_RADIUS',
    `混合圆角取最大值 ${maxRadius}`,
    nodeId,
  );
  return roundDimension(maxRadius);
}

export function readAutoLayoutAttrs(node: FrameNode): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {};

  if (node.layoutMode === 'GRID') {
    if ('clipsContent' in node && node.clipsContent) {
      attrs.clipToBounds = true;
    }
    return attrs;
  }

  if (node.layoutMode === 'HORIZONTAL') {
    attrs.layout = 'horizontal';
  } else if (node.layoutMode === 'VERTICAL') {
    attrs.layout = 'vertical';
  }

  if (node.layoutMode !== 'NONE') {
    attrs.gap = roundDimension(node.itemSpacing);

    const padding = [
      roundDimension(node.paddingTop),
      roundDimension(node.paddingRight),
      roundDimension(node.paddingBottom),
      roundDimension(node.paddingLeft),
    ];
    if (padding.some((value) => value > 0)) {
      attrs.padding = `${padding[0]},${padding[1]},${padding[2]},${padding[3]}`;
    }

    attrs.alignment = mapCrossAxisAlignment(node.counterAxisAlignItems);
    attrs.arrangement = mapPrimaryAxisAlignment(node.primaryAxisAlignItems);
  }

  if ('clipsContent' in node && node.clipsContent) {
    attrs.clipToBounds = true;
  }

  return attrs;
}

function mapCrossAxisAlignment(value: 'MIN' | 'MAX' | 'CENTER' | 'BASELINE'): string {
  if (value === 'MIN') return 'start';
  if (value === 'MAX') return 'end';
  if (value === 'CENTER') return 'center';
  return 'start';
}

function mapPrimaryAxisAlignment(value: 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN'): string {
  if (value === 'MIN') return 'start';
  if (value === 'MAX') return 'end';
  if (value === 'CENTER') return 'center';
  if (value === 'SPACE_BETWEEN') return 'spaceBetween';
  return 'start';
}

export function readFlexGrow(node: SceneNode, parent: SceneNode | null): number | undefined {
  if (!parentUsesAutoLayout(parent)) {
    return undefined;
  }

  if ('layoutGrow' in node && node.layoutGrow === 1) {
    return 1;
  }
  return undefined;
}

export function vectorPathsToSvgData(paths: VectorPaths): string {
  return paths.map((path) => path.data).join(' ');
}

type AffineTransform = [[number, number, number], [number, number, number]];

function invertTransform(matrix: AffineTransform): AffineTransform {
  const [a, b, tx] = matrix[0];
  const [c, d, ty] = matrix[1];
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) {
    return [[1, 0, 0], [0, 1, 0]];
  }

  const invA = d / det;
  const invB = -b / det;
  const invC = -c / det;
  const invD = a / det;
  return [
    [invA, invB, -(invA * tx + invC * ty)],
    [invC, invD, -(invB * tx + invD * ty)],
  ];
}

function multiplyTransform(left: AffineTransform, right: AffineTransform): AffineTransform {
  const [a0, b0, tx0] = left[0];
  const [c0, d0, ty0] = left[1];
  const [a1, b1, tx1] = right[0];
  const [c1, d1, ty1] = right[1];
  return [
    [a0 * a1 + b0 * c1, a0 * b1 + b0 * d1, a0 * tx1 + b0 * ty1 + tx0],
    [c0 * a1 + d0 * c1, c0 * b1 + d0 * d1, c0 * tx1 + d0 * ty1 + ty0],
  ];
}

function localTransformRelativeToParent(node: SceneNode, parent: SceneNode): AffineTransform | null {
  if (!('absoluteTransform' in node) || !('absoluteTransform' in parent)) {
    return null;
  }

  return multiplyTransform(
    invertTransform(parent.absoluteTransform as AffineTransform),
    node.absoluteTransform as AffineTransform,
  );
}

function isIdentityRotation(a: number, b: number, c: number, d: number): boolean {
  const epsilon = 1e-4;
  return Math.abs(a - 1) < epsilon
    && Math.abs(d - 1) < epsilon
    && Math.abs(b) < epsilon
    && Math.abs(c) < epsilon;
}

function isZeroTranslation(tx: number, ty: number): boolean {
  const epsilon = 1e-4;
  return Math.abs(tx) < epsilon && Math.abs(ty) < epsilon;
}

function parentHasPureAxisFlip(parent: SceneNode): boolean {
  if (!('absoluteTransform' in parent)) {
    return false;
  }

  const transform = parent.absoluteTransform;
  const a = transform[0][0];
  const b = transform[1][0];
  const c = transform[0][1];
  const d = transform[1][1];
  const epsilon = 1e-4;
  return Math.abs(Math.abs(a) - 1) < epsilon
    && Math.abs(Math.abs(d) - 1) < epsilon
    && Math.abs(b) < epsilon
    && Math.abs(c) < epsilon
    && (a < 0 || d < 0);
}

export function nodeBoundsInParent(
  node: SceneNode,
  parent: SceneNode,
): { left: number; top: number } | null {
  if (
    'absoluteBoundingBox' in node
    && node.absoluteBoundingBox
    && 'absoluteBoundingBox' in parent
    && parent.absoluteBoundingBox
  ) {
    return {
      left: node.absoluteBoundingBox.x - parent.absoluteBoundingBox.x,
      top: node.absoluteBoundingBox.y - parent.absoluteBoundingBox.y,
    };
  }

  return null;
}

function usesBboxForLayout(node: SceneNode, parent: SceneNode): boolean {
  // GROUP 子节点的 node.x/y 常为画布绝对坐标，必须用 AABB 差值得到父级局部位置。
  if (parent.type === 'GROUP') {
    return true;
  }

  if (parentHasPureAxisFlip(parent)) {
    return true;
  }

  const local = localTransformRelativeToParent(node, parent);
  if (!local) {
    return true;
  }

  const a = local[0][0];
  const b = local[1][0];
  const c = local[0][1];
  const d = local[1][1];
  const epsilon = 1e-4;

  if (Math.abs(b) >= epsilon || Math.abs(c) >= epsilon) {
    return true;
  }

  if (a < 0 || d < 0) {
    return true;
  }

  return false;
}

function resolvedLayoutPosition(
  node: SceneNode,
  parent: SceneNode,
): { left: number; top: number } | null {
  if (!usesBboxForLayout(node, parent) && 'x' in node && 'y' in node) {
    return {
      left: node.x,
      top: node.y,
    };
  }

  const bounds = nodeBoundsInParent(node, parent);
  if (bounds) {
    return bounds;
  }

  const local = localTransformRelativeToParent(node, parent);
  if (local) {
    return {
      left: local[0][2],
      top: local[1][2],
    };
  }

  if ('x' in node && 'y' in node) {
    return {
      left: node.x,
      top: node.y,
    };
  }

  return null;
}

export function nodeMatrixInParent(node: SceneNode, parent: SceneNode | null): string | undefined {
  if (!parent) {
    return undefined;
  }

  const local = localTransformRelativeToParent(node, parent);
  if (!local) {
    return undefined;
  }

  const a = local[0][0];
  const b = local[1][0];
  const c = local[0][1];
  const d = local[1][1];
  const transformX = local[0][2];
  const transformY = local[1][2];
  const layout = resolvedLayoutPosition(node, parent);
  const matrixX = layout ? transformX - layout.left : transformX;
  const matrixY = layout ? transformY - layout.top : transformY;

  if (isIdentityRotation(a, b, c, d) && isZeroTranslation(matrixX, matrixY)) {
    return undefined;
  }

  return `${roundDimension(a)},${roundDimension(b)},${roundDimension(c)},${roundDimension(d)},${roundDimension(matrixX)},${roundDimension(matrixY)}`;
}

export function pagxMatrixStringFromComponents(
  translationX: number,
  translationY: number,
  rotationDegrees: number,
  scaleX: number,
  scaleY: number,
  node: SceneNode,
  parent: SceneNode | null,
  options?: { motionOffset?: boolean },
): string | undefined {
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = scaleX * cos;
  const b = scaleX * sin;
  const c = -scaleY * sin;
  const d = scaleY * cos;
  const motionOffset = options?.motionOffset ?? false;
  const layout = parent ? resolvedLayoutPosition(node, parent) : null;
  const matrixX = motionOffset
    ? translationX
    : (layout ? translationX - layout.left : translationX);
  const matrixY = motionOffset
    ? translationY
    : (layout ? translationY - layout.top : translationY);

  if (isIdentityRotation(a, b, c, d) && isZeroTranslation(matrixX, matrixY)) {
    return undefined;
  }

  return `${roundDimension(a)},${roundDimension(b)},${roundDimension(c)},${roundDimension(d)},${roundDimension(matrixX)},${roundDimension(matrixY)}`;
}

export function pagxMotionMatrixStringFromComponents(
  translationX: number,
  translationY: number,
  rotationDegrees: number,
  scaleX: number,
  scaleY: number,
  pivotX: number,
  pivotY: number,
): string | undefined {
  const rad = (rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const a = scaleX * cos;
  const b = scaleX * sin;
  const c = -scaleY * sin;
  const d = scaleY * cos;

  let tx = translationX;
  let ty = translationY;
  if (Math.abs(rotationDegrees) > 1e-4) {
    tx += pivotX * (1 - a) - pivotY * c;
    ty += pivotY * (1 - d) - pivotX * b;
  }

  if (isIdentityRotation(a, b, c, d) && isZeroTranslation(tx, ty)) {
    return undefined;
  }

  return `${roundDimension(a)},${roundDimension(b)},${roundDimension(c)},${roundDimension(d)},${roundDimension(tx)},${roundDimension(ty)}`;
}

export function geometryPathData(node: GeometryMixin & { type?: string; width?: number; height?: number }): string {
  const fillData = vectorPathsToSvgData(node.fillGeometry).trim();
  if (fillData) {
    return fillData;
  }

  const strokeData = vectorPathsToSvgData(node.strokeGeometry).trim();
  if (strokeData) {
    return strokeData;
  }

  if (node.type === 'LINE' && node.width !== undefined && node.height !== undefined) {
    return `M 0 0 L ${roundDimension(node.width)} ${roundDimension(node.height)}`;
  }

  return '';
}

export function nodePositionInParent(
  node: SceneNode,
  parent: SceneNode | null,
): { left?: number; top?: number } {
  if (!parent) {
    return {};
  }

  const layout = resolvedLayoutPosition(node, parent);
  if (layout) {
    return {
      left: roundDimension(layout.left),
      top: roundDimension(layout.top),
    };
  }

  return {};
}

export function parentUsesAutoLayout(parent: SceneNode | null): boolean {
  return parent?.type === 'FRAME'
    && parent.layoutMode !== 'NONE'
    && parent.layoutMode !== 'GRID';
}

export function layoutPositionAttrs(
  node: SceneNode,
  parent: SceneNode | null,
): Record<string, string | number | boolean> {
  if (!parent) {
    return {};
  }

  const inAutoLayout = parentUsesAutoLayout(parent);
  const isAbsolute = 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE';

  if (inAutoLayout && !isAbsolute) {
    return {};
  }

  const position = nodePositionInParent(node, parent);
  if (inAutoLayout && isAbsolute) {
    return {
      ...position,
      includeInLayout: false,
    };
  }

  return position;
}

export function isContainerNode(node: SceneNode): node is FrameNode | GroupNode | ComponentNode | InstanceNode {
  return (
    node.type === 'FRAME'
    || node.type === 'GROUP'
    || node.type === 'COMPONENT'
    || node.type === 'INSTANCE'
  );
}

export function isGeometryNode(
  node: SceneNode,
): node is RectangleNode | EllipseNode | VectorNode | StarNode | PolygonNode | LineNode | TextNode | BooleanOperationNode {
  return (
    node.type === 'RECTANGLE'
    || node.type === 'ELLIPSE'
    || node.type === 'VECTOR'
    || node.type === 'STAR'
    || node.type === 'POLYGON'
    || node.type === 'LINE'
    || node.type === 'TEXT'
    || node.type === 'BOOLEAN_OPERATION'
  );
}

export function hasImageFill(fills: ReadonlyArray<Paint> | typeof figma.mixed): boolean {
  if (fills === figma.mixed || !Array.isArray(fills)) {
    return false;
  }
  return fills.some((paint) => paint.type === 'IMAGE' && paint.visible !== false);
}

import type {
  ColorSource,
  ExportContext,
  PagxDocument,
  PagxElement,
  PagxLayer,
} from './types';
import { mapBlendMode } from './blend-mode';
import { roundDimension } from './color';
import { figmaIdToPagxId, ensureUniqueId } from './id';
import {
  addDiagnostic,
  effectsToElements,
  fillsToElements,
  hasImageFill,
  isContainerNode,
  isGeometryNode,
  readAutoLayoutAttrs,
  readCornerRadius,
  readFlexGrow,
  geometryPathData,
  nodeMatrixInParent,
  parentUsesAutoLayout,
  strokesToElements,
} from './figma-reader';
import { shapeElementFromPathData } from './path-detect';
import {
  collectMotionAnimations,
  motionLayoutPositionForExport,
  motionLayoutSizeForExport,
  motionPivotForExport,
  needsMotionTransformGroup,
} from './figma-motion';

function omitLayoutSize(
  attrs: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const { width: _width, height: _height, ...rest } = attrs;
  return rest;
}

function isPureAxisFlipMatrix(matrix: string): boolean {
  const [a, b, c, d] = matrix.split(',').map(Number);
  const epsilon = 1e-4;
  return Math.abs(a + 1) < epsilon
    && Math.abs(d + 1) < epsilon
    && Math.abs(b) < epsilon
    && Math.abs(c) < epsilon;
}

function parentHasPureAxisFlip(parent: SceneNode | null): boolean {
  if (!parent || !('absoluteTransform' in parent)) {
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

function matrixFromAbsoluteBounds(node: SceneNode, parent: SceneNode): string | undefined {
  if (
    !('absoluteTransform' in node)
    || !('absoluteBoundingBox' in node)
    || !node.absoluteBoundingBox
    || !('absoluteBoundingBox' in parent)
    || !parent.absoluteBoundingBox
  ) {
    return undefined;
  }

  const transform = node.absoluteTransform;
  const left = node.absoluteBoundingBox.x - parent.absoluteBoundingBox.x;
  const top = node.absoluteBoundingBox.y - parent.absoluteBoundingBox.y;
  const tx = transform[0][2] - parent.absoluteBoundingBox.x - left;
  const ty = transform[1][2] - parent.absoluteBoundingBox.y - top;

  return [
    roundDimension(transform[0][0]),
    roundDimension(transform[1][0]),
    roundDimension(transform[0][1]),
    roundDimension(transform[1][1]),
    roundDimension(tx),
    roundDimension(ty),
  ].join(',');
}

function staticLayerMatrixInParent(node: SceneNode, parent: SceneNode | null): string | undefined {
  const matrix = nodeMatrixInParent(node, parent);
  if (!matrix || isPureAxisFlipMatrix(matrix)) {
    return undefined;
  }
  if (parentHasPureAxisFlip(parent)) {
    return parent ? matrixFromAbsoluteBounds(node, parent) : matrix;
  }
  return matrix;
}

type PagxMaskType = 'alpha' | 'luminance' | 'contour';

function isMaskNode(node: SceneNode): node is SceneNode & { isMask: boolean; maskType: MaskType } {
  return 'isMask' in node && node.isMask;
}

function mapMaskType(maskType: MaskType): PagxMaskType {
  if (maskType === 'LUMINANCE') {
    return 'luminance';
  }
  if (maskType === 'VECTOR') {
    return 'contour';
  }
  return 'alpha';
}

export function textUsesLayerTransform(node: TextNode, parent: SceneNode | null): boolean {
  if (staticLayerMatrixInParent(node, parent)) {
    return true;
  }

  if (node.opacity < 1) {
    return true;
  }

  if (node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    return true;
  }

  return false;
}

export function textNeedsTextBox(node: TextNode, parent: SceneNode | null): boolean {
  if (!parentUsesAutoLayout(parent)) {
    return false;
  }

  if ('layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE') {
    return false;
  }

  if (node.textAutoResize !== 'NONE') {
    return true;
  }

  if ('layoutGrow' in node && node.layoutGrow === 1) {
    return true;
  }

  return false;
}

function textBoxAttrs(node: TextNode): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    width: '100%',
    wordWrap: true,
  };

  if (node.textAutoResize === 'WIDTH_AND_HEIGHT' || node.textAutoResize === 'TRUNCATE') {
    attrs.height = '100%';
  }

  if (node.textAutoResize === 'TRUNCATE') {
    attrs.overflow = 'hidden';
  }

  return attrs;
}

function wrapTextContentsInTextBox(contents: PagxElement[], node: TextNode): PagxElement[] {
  const textElements = contents.filter((item): item is Extract<PagxElement, { kind: 'text' }> => item.kind === 'text');
  const otherElements = contents.filter((item) => item.kind !== 'text');

  return [{
    kind: 'textbox',
    attrs: textBoxAttrs(node),
    children: [...textElements, ...otherElements],
  }];
}

function wrapContentsInMotionGroup(
  contents: PagxElement[],
  node: SceneNode,
  groupId: string,
): PagxElement[] {
  const size = resolvedNodeSize(node);
  const width = size?.width ?? ('width' in node ? roundDimension(node.width) : 0);
  const height = size?.height ?? ('height' in node ? roundDimension(node.height) : 0);
  const pivot = motionPivotForExport(node, width, height);
  const pivotPosition = `${pivot.x},${pivot.y}`;

  return [{
    kind: 'group',
    attrs: {
      id: groupId,
      name: `${node.name} Motion`,
      anchor: pivotPosition,
      position: pivotPosition,
      width,
      height,
    },
    children: contents,
  }];
}

function minimalTextLayerAttrs(
  node: TextNode,
  parent: SceneNode | null,
): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {};

  const flex = readFlexGrow(node, parent);
  if (flex !== undefined) {
    attrs.flex = flex;
  }

  if (textNeedsTextBox(node, parent)) {
    attrs.width = roundDimension(node.width);
    if (node.textAutoResize === 'WIDTH_AND_HEIGHT' || node.textAutoResize === 'TRUNCATE') {
      attrs.height = roundDimension(node.height);
    }
  }

  if (node.visible === false) {
    attrs.visible = false;
  }

  return attrs;
}

export function textLayerAttrs(
  node: TextNode,
  parent: SceneNode | null,
): Record<string, string | number | boolean> {
  if (textUsesLayerTransform(node, parent)) {
    return omitLayoutSize(layerBaseAttrs(node, parent));
  }

  return minimalTextLayerAttrs(node, parent);
}

function applyTextPosition(
  contents: PagxElement[],
  node: TextNode,
  parent: SceneNode | null,
): void {
  const textElement = contents.find((item): item is Extract<PagxElement, { kind: 'text' }> => item.kind === 'text');
  if (!textElement) {
    return;
  }

  if (textUsesLayerTransform(node, parent)) {
    textElement.attrs.left = 0;
    textElement.attrs.top = 0;
    return;
  }

  Object.assign(textElement.attrs, motionLayoutPositionForExport(node, parent));
}

async function mapTextNode(
  node: TextNode,
  parent: SceneNode | null,
  ctx: ExportContext,
  layerId: string,
): Promise<PagxLayer> {
  const contents = shapeContents(node, ctx);

  const imageElements = await imageFillElements(node, ctx);
  for (const element of imageElements) {
    const fillIndex = contents.findIndex((item) => item.kind === 'fill');
    if (fillIndex >= 0 && contents[fillIndex].kind === 'fill') {
      contents[fillIndex] = element;
    } else {
      contents.unshift(...imageElements);
      break;
    }
  }

  const useTextBox = textNeedsTextBox(node, parent) && !textUsesLayerTransform(node, parent);
  if (useTextBox) {
    return {
      id: layerId,
      name: node.name,
      attrs: textLayerAttrs(node, parent),
      customData: { 'data-figma-id': node.id },
      contents: wrapTextContentsInTextBox(contents, node),
      children: [],
    };
  }

  applyTextPosition(contents, node, parent);

  return {
    id: layerId,
    name: node.name,
    attrs: textLayerAttrs(node, parent),
    customData: { 'data-figma-id': node.id },
    contents,
    children: [],
  };
}

function resolvedNodeSize(node: SceneNode): { width: number; height: number } | null {
  if (!('width' in node) || !('height' in node)) {
    return null;
  }

  const motionSize = motionLayoutSizeForExport(node);
  return {
    width: motionSize?.width ?? roundDimension(node.width),
    height: motionSize?.height ?? roundDimension(node.height),
  };
}

function layerBaseAttrs(node: SceneNode, parent: SceneNode | null): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    ...motionLayoutPositionForExport(node, parent),
  };

  const matrix = staticLayerMatrixInParent(node, parent);
  if (matrix) {
    attrs.matrix = matrix;
  }

  const size = resolvedNodeSize(node);
  if (size) {
    attrs.width = size.width;
    attrs.height = size.height;
  }

  const flex = readFlexGrow(node, parent);
  if (flex !== undefined) {
    attrs.flex = flex;
  }

  if ('opacity' in node && node.opacity < 1) {
    attrs.alpha = roundDimension(node.opacity);
  }

  if ('blendMode' in node && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    attrs.blendMode = mapBlendMode(node.blendMode);
  }

  if ('visible' in node && node.visible === false) {
    attrs.visible = false;
  }

  return attrs;
}

function shapeContents(
  node: RectangleNode | EllipseNode | VectorNode | StarNode | PolygonNode | LineNode | TextNode | BooleanOperationNode,
  ctx: ExportContext,
): PagxElement[] {
  const contents: PagxElement[] = [];
  const nodeId = node.id;
  const size = resolvedNodeSize(node);

  if (node.type === 'RECTANGLE') {
    const attrs: Record<string, string | number | boolean> = {
      left: 0,
      top: 0,
      width: size?.width ?? roundDimension(node.width),
      height: size?.height ?? roundDimension(node.height),
    };
    const roundness = readCornerRadius(node, nodeId, ctx.diagnostics);
    if (roundness > 0) {
      attrs.roundness = roundness;
    }
    contents.push({ kind: 'rectangle', attrs });
  } else if (node.type === 'ELLIPSE') {
    contents.push({
      kind: 'ellipse',
      attrs: {
        left: 0,
        top: 0,
        width: size?.width ?? roundDimension(node.width),
        height: size?.height ?? roundDimension(node.height),
      },
    });
  } else if (node.type === 'TEXT') {
    const attrs: Record<string, string | number | boolean> = {
      fontFamily: node.fontName === figma.mixed ? 'Inter' : node.fontName.family,
      fontSize: node.fontSize === figma.mixed ? 12 : roundDimension(node.fontSize as number),
    };
    if (node.fontName !== figma.mixed && node.fontName.style) {
      attrs.fontStyle = node.fontName.style;
    }
    contents.push({
      kind: 'text',
      attrs,
      text: node.characters,
    });
  } else if (node.type === 'STAR') {
    const outerRadius = roundDimension(Math.min(node.width, node.height) / 2);
    contents.push({
      kind: 'polystar',
      attrs: {
        left: 0,
        top: 0,
        type: 'star',
        pointCount: node.pointCount,
        outerRadius,
        innerRadius: roundDimension(outerRadius * node.innerRadius),
      },
    });
  } else if (node.type === 'POLYGON') {
    const outerRadius = roundDimension(Math.min(node.width, node.height) / 2);
    contents.push({
      kind: 'polystar',
      attrs: {
        left: 0,
        top: 0,
        type: 'polygon',
        pointCount: node.pointCount,
        outerRadius,
      },
    });
  } else if (node.type === 'LINE' || node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
    const pathData = geometryPathData(node);
    if (!pathData) {
      addDiagnostic(
        ctx.diagnostics,
        'warning',
        'EMPTY_PATH',
        '节点缺少可导出的路径数据',
        nodeId,
      );
    } else {
      const shape = shapeElementFromPathData(pathData);
      if (shape.kind === 'path' && !shape.attrs.data) {
        addDiagnostic(
          ctx.diagnostics,
          'warning',
          'EMPTY_PATH',
          '节点路径数据无效',
          nodeId,
        );
      } else {
        contents.push({
          kind: shape.kind,
          attrs: {
            left: 0,
            top: 0,
            ...shape.attrs,
          },
        });
      }
    }
  }

  if ('fills' in node) {
    contents.push(...fillsToElements(node.fills, nodeId, ctx.diagnostics));
  }

  if ('strokes' in node && 'strokeWeight' in node) {
    contents.push(...strokesToElements(node.strokes, node, nodeId, ctx.diagnostics));
  }

  if ('effects' in node) {
    contents.push(...effectsToElements(node.effects, nodeId, ctx.diagnostics));
  }

  return contents;
}

async function imageFillElements(
  node: SceneNode & MinimalFillsMixin & ExportMixin,
  ctx: ExportContext,
): Promise<PagxElement[]> {
  if (!('fills' in node) || !hasImageFill(node.fills)) {
    return [];
  }

  if (node.fills === figma.mixed || !Array.isArray(node.fills)) {
    return [];
  }

  const elements: PagxElement[] = [];
  for (const paint of node.fills) {
    if (paint.type !== 'IMAGE' || paint.visible === false) {
      continue;
    }

    try {
      const bytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 2 },
      });
      const base64 = figma.base64Encode(bytes);
      const resourceId = ensureUniqueId(figmaIdToPagxId(node.id, 'img'), ctx.usedIds);
      const source = `data:image/png;base64,${base64}`;
      ctx.resources.push({ kind: 'image', id: resourceId, source });

      const colorSource: ColorSource = {
        kind: 'imagePattern',
        imageRef: `@${resourceId}`,
        scaleMode: paint.scaleMode === 'FILL' ? 'stretch' : 'letterBox',
      };
      elements.push({ kind: 'fill', attrs: {}, colorSource });
    } catch (error) {
      addDiagnostic(
        ctx.diagnostics,
        'warning',
        'IMAGE_EXPORT_FAILED',
        `图片导出失败: ${error instanceof Error ? error.message : String(error)}`,
        node.id,
      );
    }
  }

  return elements;
}

async function mapNode(node: SceneNode, parent: SceneNode | null, ctx: ExportContext): Promise<PagxLayer | null> {
  if (node.type === 'SLICE') {
    return null;
  }

  ctx.nodeCount += 1;
  const layerId = ensureUniqueId(figmaIdToPagxId(node.id, 'layer'), ctx.usedIds);
  ctx.layerIdByFigmaId.set(node.id, layerId);

  if (isContainerNode(node)) {
    const attrs = layerBaseAttrs(node, parent);
    if (node.type === 'FRAME') {
      Object.assign(attrs, readAutoLayoutAttrs(node));
    } else if ('clipsContent' in node && node.clipsContent) {
      attrs.clipToBounds = true;
    }

    const contents: PagxElement[] = [];
    const fills = 'fills' in node ? node.fills : [];
    const strokes = 'strokes' in node ? node.strokes : [];
    const hasFillOrStroke = (Array.isArray(fills) && fills.length > 0)
      || (Array.isArray(strokes) && strokes.length > 0);
    if (hasFillOrStroke && 'width' in node && 'height' in node) {
      const frameSize = resolvedNodeSize(node);
      contents.push({
        kind: 'rectangle',
        attrs: {
          width: frameSize?.width ?? roundDimension(node.width),
          height: frameSize?.height ?? roundDimension(node.height),
        },
      });
    }
    if ('fills' in node) {
      contents.push(...fillsToElements(node.fills, node.id, ctx.diagnostics));
    }
    if ('strokes' in node && 'strokeWeight' in node) {
      contents.push(...strokesToElements(node.strokes, node, node.id, ctx.diagnostics));
    }
    if ('effects' in node) {
      contents.push(...effectsToElements(node.effects, node.id, ctx.diagnostics));
    }
    contents.push(...await imageFillElements(node as SceneNode & MinimalFillsMixin & ExportMixin, ctx));

    const children: PagxLayer[] = [];
    if ('children' in node) {
      let activeMask: { id: string; type: PagxMaskType } | null = null;
      for (const child of node.children) {
        const mapped = await mapNode(child, node, ctx);
        if (mapped) {
          if (isMaskNode(child)) {
            mapped.attrs.visible = false;
            activeMask = {
              id: mapped.id,
              type: mapMaskType(child.maskType),
            };
            children.push(mapped);
            continue;
          }

          if (activeMask) {
            mapped.attrs.mask = `@${activeMask.id}`;
            if (activeMask.type !== 'alpha') {
              mapped.attrs.maskType = activeMask.type;
            }
          }
          children.push(mapped);
        }
      }
    }

    return {
      id: layerId,
      name: node.name,
      attrs,
      customData: { 'data-figma-id': node.id },
      contents,
      children,
    };
  }

  if (node.type === 'TEXT') {
    return mapTextNode(node, parent, ctx, layerId);
  }

  if (isGeometryNode(node)) {
    let contents = shapeContents(node, ctx);
    const imageElements = await imageFillElements(node as SceneNode & MinimalFillsMixin & ExportMixin, ctx);
    for (const element of imageElements) {
      const fillIndex = contents.findIndex((item) => item.kind === 'fill');
      if (fillIndex >= 0 && contents[fillIndex].kind === 'fill') {
        contents[fillIndex] = element;
      } else {
        contents.unshift(...imageElements);
        break;
      }
    }

    if (needsMotionTransformGroup(node)) {
      const groupId = ensureUniqueId(figmaIdToPagxId(node.id, 'motion_group'), ctx.usedIds);
      ctx.motionTargetIdByFigmaId.set(node.id, groupId);
      contents = wrapContentsInMotionGroup(contents, node, groupId);
    }

    return {
      id: layerId,
      name: node.name,
      attrs: layerBaseAttrs(node, parent),
      customData: { 'data-figma-id': node.id },
      contents,
      children: [],
    };
  }

  addDiagnostic(
    ctx.diagnostics,
    'warning',
    'UNSUPPORTED_NODE',
    `跳过不支持的节点类型 ${node.type}`,
    node.id,
  );
  return null;
}

export function createExportContext(root: SceneNode): ExportContext {
  const bounds = 'absoluteBoundingBox' in root && root.absoluteBoundingBox
    ? root.absoluteBoundingBox
    : { x: 0, y: 0, width: 'width' in root ? (root as { width: number }).width : 100, height: 'height' in root ? (root as { height: number }).height : 100 };

  return {
    root,
    rootBounds: bounds,
    diagnostics: [],
    resources: [],
    usedIds: new Set<string>(),
    nodeCount: 0,
    layerIdByFigmaId: new Map<string, string>(),
    motionTargetIdByFigmaId: new Map<string, string>(),
  };
}

export async function mapFigmaToPagx(root: SceneNode, ctx: ExportContext): Promise<PagxDocument> {
  const width = roundDimension(
    'width' in root ? (root as { width: number }).width : ctx.rootBounds.width,
  );
  const height = roundDimension(
    'height' in root ? (root as { height: number }).height : ctx.rootBounds.height,
  );

  const layers: PagxLayer[] = [];

  if (isContainerNode(root)) {
    const rootLayer = await mapNode(root, null, ctx);
    if (rootLayer) {
      rootLayer.attrs.left = 0;
      rootLayer.attrs.top = 0;
      layers.push(rootLayer);
    }
  } else if (isGeometryNode(root)) {
    const rootLayer = await mapNode(root, null, ctx);
    if (rootLayer) {
      rootLayer.attrs.left = 0;
      rootLayer.attrs.top = 0;
      layers.push(rootLayer);
    }
  } else {
    addDiagnostic(ctx.diagnostics, 'error', 'UNSUPPORTED_ROOT', `不支持的 root 节点类型 ${root.type}`, root.id);
  }

  return {
    width,
    height,
    resources: ctx.resources,
    animations: collectMotionAnimations(root, ctx.layerIdByFigmaId, ctx.motionTargetIdByFigmaId, ctx.diagnostics),
    layers,
    customData: {
      'data-exported-by': 'figma-motion-export-pagx',
      'data-figma-root-id': root.id,
    },
  };
}

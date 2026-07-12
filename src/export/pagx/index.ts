import type { ExportResult } from './types';
import { createExportContext, mapFigmaToPagx } from './figma-to-pagx';
import { writePagxXml } from './writer';
import { MOTION_FRAME_RATE } from '../shared/figma-motion';
import type { ExportOptions } from './types';

export async function exportPagx(
  root: SceneNode,
  options?: ExportOptions,
): Promise<ExportResult & { xml: string }> {
  const frameRate = options?.frameRate ?? MOTION_FRAME_RATE;
  const ctx = createExportContext(root, frameRate, options?.encodeWebp);
  const document = await mapFigmaToPagx(root, ctx);
  const xml = writePagxXml(document);

  return {
    document,
    diagnostics: ctx.diagnostics,
    nodeCount: ctx.nodeCount,
    xml,
  };
}

export { writePagxXml } from './writer';
export type { PagxDocument, Diagnostic, ExportResult, ExportOptions } from './types';

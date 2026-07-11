import type { ExportResult } from './types';
import { createExportContext, mapFigmaToPagx } from './figma-to-pagx';
import { writePagxXml } from './pagx-writer';
import { exportPag } from './pag';
import { MOTION_FRAME_RATE } from './figma-motion';
import type { ExportOptions } from './types';

export async function exportPagx(
  root: SceneNode,
  options?: ExportOptions,
): Promise<ExportResult & { xml: string }> {
  const frameRate = options?.frameRate ?? MOTION_FRAME_RATE;
  const ctx = createExportContext(root, frameRate);
  const document = await mapFigmaToPagx(root, ctx);
  const xml = writePagxXml(document);

  return {
    document,
    diagnostics: ctx.diagnostics,
    nodeCount: ctx.nodeCount,
    xml,
  };
}

export { exportPag };
export { writePagxXml } from './pagx-writer';
export type { PagxDocument, Diagnostic, ExportResult, ExportOptions } from './types';

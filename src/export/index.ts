import type { ExportResult } from './types';
import { createExportContext, mapFigmaToPagx } from './figma-to-pagx';
import { writePagxXml } from './pagx-writer';

export async function exportPagx(root: SceneNode): Promise<ExportResult & { xml: string }> {
  const ctx = createExportContext(root);
  const document = await mapFigmaToPagx(root, ctx);
  const xml = writePagxXml(document);

  return {
    document,
    diagnostics: ctx.diagnostics,
    nodeCount: ctx.nodeCount,
    xml,
  };
}

export { writePagxXml } from './pagx-writer';
export type { PagxDocument, Diagnostic, ExportResult } from './types';

figma.showUI(__html__, { width: 360, height: 560 });

import { exportPagx } from './export';
import { collectMotionDebugData, refreshMotionPivotCache } from './export/figma-motion';

type PluginMessage =
  | { type: 'export-pagx' }
  | { type: 'refresh-motion-anchor' }
  | { type: 'cancel' };

function sendSelectionMotionData(): void {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    figma.ui.postMessage({
      type: 'selection-motion-data',
      data: null,
      hint: selection.length === 0 ? '未选中节点' : '请只选择一个节点',
    });
    return;
  }

  const root = selection[0];
  figma.ui.postMessage({
    type: 'selection-motion-data',
    data: collectMotionDebugData(root),
    nodeName: root.name,
  });
}

figma.on('selectionchange', sendSelectionMotionData);
sendSelectionMotionData();

figma.ui.onmessage = async (msg: PluginMessage) => {
  if (msg.type === 'cancel') {
    figma.closePlugin();
    return;
  }

  if (msg.type === 'refresh-motion-anchor') {
    const selection = figma.currentPage.selection;
    let refreshed = 0;
    let skipped = 0;

    for (const node of selection) {
      const pivot = refreshMotionPivotCache(node);
      if (pivot) {
        refreshed += 1;
      } else {
        skipped += 1;
      }
    }

    figma.ui.postMessage({
      type: 'refresh-motion-anchor-result',
      refreshed,
      skipped,
      message: refreshed > 0
        ? `已刷新 ${refreshed} 个节点，跳过 ${skipped} 个节点`
        : '未能刷新锚点。请将 Motion 时间线拖到动画起始点稍后，再选中目标节点重试。',
    });
    sendSelectionMotionData();
    return;
  }

  if (msg.type !== 'export-pagx') {
    return;
  }

  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    figma.ui.postMessage({
      type: 'export-error',
      error: '请选择一个节点作为导出 root',
    });
    return;
  }

  const root = selection[0];

  try {
    const result = await exportPagx(root);
    figma.ui.postMessage({
      type: 'export-result',
      xml: result.xml,
      diagnostics: result.diagnostics,
      fileName: `${sanitizeFileName(root.name)}.pagx`,
      width: result.document.width,
      height: result.document.height,
      nodeCount: result.nodeCount,
    });
  } catch (error) {
    figma.ui.postMessage({
      type: 'export-error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

function sanitizeFileName(name: string): string {
  const trimmed = name.trim() || 'export';
  return trimmed.replace(/[\\/:*?"<>|]/g, '_');
}

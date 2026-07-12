figma.showUI(__html__, { width: 360, height: 600 });

import { exportPagx, exportPag } from './export';
import { collectMotionDebugData, refreshMotionPivotCache } from './export/shared/figma-motion';

type PluginMessage =
  | { type: 'export-pagx'; frameRate?: number; useWebp?: boolean; webpQuality?: number }
  | { type: 'export-pag'; frameRate?: number; useWebp?: boolean; webpQuality?: number }
  | { type: 'encode-webp-result'; requestId: number; bytes?: number[]; error?: string }
  | { type: 'refresh-motion-anchor' };

let nextWebpRequestId = 1;
const pendingWebpRequests = new Map<number, {
  resolve: (bytes: Uint8Array) => void;
  reject: (error: Error) => void;
}>();

function encodeWebpInUi(bytes: Uint8Array, quality: number): Promise<Uint8Array> {
  const requestId = nextWebpRequestId;
  nextWebpRequestId += 1;
  return new Promise((resolve, reject) => {
    pendingWebpRequests.set(requestId, { resolve, reject });
    figma.ui.postMessage({
      type: 'encode-webp-request',
      requestId,
      bytes: Array.from(bytes),
      quality,
    });
  });
}

function resolveFrameRate(value: unknown): number {
  return value === 24 || value === 30 || value === 60 ? value : 30;
}

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
  if (msg.type === 'encode-webp-result') {
    const pending = pendingWebpRequests.get(msg.requestId);
    if (!pending) return;
    pendingWebpRequests.delete(msg.requestId);
    if (msg.error || !msg.bytes) {
      pending.reject(new Error(msg.error || 'WebP 编码失败'));
    } else {
      pending.resolve(new Uint8Array(msg.bytes));
    }
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

  if (msg.type !== 'export-pagx' && msg.type !== 'export-pag') {
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
  const frameRate = resolveFrameRate(msg.frameRate);

  try {
    if (msg.type === 'export-pag') {
      const webpQuality = typeof msg.webpQuality === 'number'
        ? Math.max(0, Math.min(1, msg.webpQuality))
        : 0.8;
      const result = await exportPag(root, {
        frameRate,
        encodeWebp: msg.useWebp === false
          ? undefined
          : (bytes) => encodeWebpInUi(bytes, webpQuality),
      });
      figma.ui.postMessage({
        type: 'export-pag-result',
        bytes: Array.from(result.bytes),
        diagnostics: result.diagnostics,
        fileName: `${sanitizeFileName(root.name)}.pag`,
        width: result.width,
        height: result.height,
        nodeCount: result.nodeCount,
      });
      return;
    }

    const webpQuality = typeof msg.webpQuality === 'number'
      ? Math.max(0, Math.min(1, msg.webpQuality))
      : 0.8;
    const result = await exportPagx(root, {
      frameRate,
      encodeWebp: msg.useWebp === false
        ? undefined
        : (bytes) => encodeWebpInUi(bytes, webpQuality),
    });
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

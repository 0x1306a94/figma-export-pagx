import { readSelectionIr } from './ir-builder';

figma.showUI(__html__, { width: 560, height: 680 });

type PluginMessage = { type: 'read-motion' } | { type: 'cancel' };

function sendMotionIr() {
  figma.ui.postMessage({ type: 'motion-ir', data: readSelectionIr(figma.currentPage.selection) });
}

sendMotionIr();

figma.on('selectionchange', () => {
  sendMotionIr();
});

figma.ui.onmessage = (msg: PluginMessage) => {
  if (msg.type === 'read-motion') {
    sendMotionIr();
    return;
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

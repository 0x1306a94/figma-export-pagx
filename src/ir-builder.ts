import { findStyleSource, findTimelineId, getTrackDuration, hasMotion, toIrTrack } from './figma-motion';
import type { ClipDraft, IrClip, IrDiagnostic, IrNode, MotionIr, TrackSource } from './ir-types';

export function readSelectionIr(selection: readonly SceneNode[]): MotionIr | { error: string } {
  if (selection.length !== 1) {
    return { error: '请选择一个父节点作为导出 root' };
  }

  const root = selection[0];
  const nodes = collectNodes(root);
  const diagnostics: IrDiagnostic[] = [];
  const clipsByTimelineId = new Map<string, ClipDraft[]>();
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const node of nodes) {
    if (!hasMotion(node)) {
      continue;
    }

    for (const property of Object.keys(node.animations) as KeyframePropertyFieldName[]) {
      const binding = node.animations[property];

      if (!binding || !('tracks' in binding)) {
        continue;
      }

      const timelineId = findTimelineId(node, binding);
      const clips = clipsByTimelineId.get(timelineId) ?? [];

      for (const track of binding.tracks) {
        const source = findStyleSource(track, node.animationStyles);
        const irTrack = toIrTrack(property, binding, track, diagnostics, node.id);

        if (!irTrack) {
          continue;
        }

        const duration = getTrackDuration(track, source);
        const clip = getOrCreateClip(clips, timelineId, node.id, source, duration);
        clip.tracks.push(irTrack);
      }

      if (clips.length > 0) {
        clipsByTimelineId.set(timelineId, clips);
      }
    }
  }

  const compositions = Array.from(clipsByTimelineId.entries()).map(([timelineId, clips]) => {
    const compositionStartTime = clips.length > 0 ? Math.min(...clips.map((clip) => clip.startTime)) : 0;
    const normalizedClips: IrClip[] = clips.map(({ clipKey: _clipKey, ...clip }) => ({
      ...clip,
      startTime: clip.startTime - compositionStartTime,
    }));
    const duration = normalizedClips.reduce(
      (maxDuration, clip) => Math.max(maxDuration, clip.startTime + clip.duration),
      0,
    );

    return {
      id: timelineId,
      sourceTimelineId: timelineId,
      duration,
      clips: normalizedClips,
    };
  });

  return {
    version: '1.0',
    source: {
      tool: 'figma',
      exportedAt: new Date().toISOString(),
    },
    scene: {
      rootNodeId: root.id,
      coordinateSpace: 'root-local',
      nodes: nodes.map((node) => toIrNode(node, root, root.absoluteBoundingBox, nodeIds)),
    },
    compositions,
    diagnostics,
  };
}

function collectNodes(root: SceneNode): SceneNode[] {
  const nodes = [root];

  if (!hasChildren(root)) {
    return nodes;
  }

  for (const child of root.children) {
    nodes.push(...collectNodes(child));
  }

  return nodes;
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node;
}

function getChildIds(node: SceneNode): string[] {
  if (!hasChildren(node)) {
    return [];
  }

  return node.children.map((child) => child.id);
}

function toIrNode(node: SceneNode, root: SceneNode, rootBounds: Rect | null, nodeIds: Set<string>): IrNode {
  const parent = node.parent;

  return {
    id: node.id,
    name: node.name,
    type: node.type,
    parentId: node.id !== root.id && parent && nodeIds.has(parent.id) ? parent.id : undefined,
    children: getChildIds(node),
    bounds: getRootRelativeBounds(node, rootBounds),
  };
}

function getRootRelativeBounds(node: SceneNode, rootBounds: Rect | null): IrNode['bounds'] {
  const bounds = node.absoluteBoundingBox;

  if (bounds !== null && rootBounds !== null) {
    return {
      x: bounds.x - rootBounds.x,
      y: bounds.y - rootBounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  }

  return {
    x: 'x' in node ? node.x : 0,
    y: 'y' in node ? node.y : 0,
    width: 'width' in node ? node.width : 0,
    height: 'height' in node ? node.height : 0,
  };
}

function getClipKey(timelineId: string, nodeId: string, source: TrackSource, duration: number): string {
  return [
    timelineId,
    nodeId,
    source.animationStyleId ?? 'manual',
    String(source.timelineOffset),
    String(duration),
  ].join('|');
}

function getOrCreateClip(clips: ClipDraft[], timelineId: string, nodeId: string, source: TrackSource, duration: number): ClipDraft {
  const clipKey = getClipKey(timelineId, nodeId, source, duration);
  const existingClip = clips.find((clip) => clip.clipKey === clipKey);

  if (existingClip) {
    return existingClip;
  }

  const clip: ClipDraft = {
    clipKey,
    id: source.animationStyleId ?? `${nodeId}:${timelineId}:${clips.length}`,
    targetNodeId: nodeId,
    startTime: source.timelineOffset,
    duration,
    tracks: [],
    source: {
      timelineOffset: source.timelineOffset,
      animationStyleId: source.animationStyleId,
      animationStyleName: source.animationStyleName,
    },
  };

  clips.push(clip);
  return clip;
}

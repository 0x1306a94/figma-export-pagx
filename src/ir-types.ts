export type IrProperty =
  | 'translation.x'
  | 'translation.y'
  | 'opacity'
  | 'rotation'
  | 'scale.x'
  | 'scale.y'
  | 'size.width'
  | 'size.height';

export type IrEasing =
  | { type: 'linear' }
  | { type: 'figma'; name: string }
  | { type: 'cubicBezier'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'spring'; bounce: number };

export type IrKeyframe = {
  time: number;
  value: number;
  easing?: IrEasing;
};

export type IrTrack = {
  property: IrProperty;
  operation: 'absolute' | 'relative' | 'scale';
  baseValue?: number;
  keyframes: IrKeyframe[];
  source: {
    property: KeyframePropertyFieldName;
    trackId: string;
  };
};

export type IrClip = {
  id: string;
  targetNodeId: string;
  startTime: number;
  duration: number;
  tracks: IrTrack[];
  source: {
    timelineOffset: number;
    animationStyleId?: string;
    animationStyleName?: string;
  };
};

export type IrComposition = {
  id: string;
  sourceTimelineId: string;
  duration: number;
  clips: IrClip[];
};

export type IrNode = {
  id: string;
  name: string;
  type: string;
  parentId?: string;
  children: string[];
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type IrDiagnostic = {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  nodeId?: string;
  property?: string;
  sourceTrackId?: string;
};

export type MotionIr = {
  version: '1.0';
  source: {
    tool: 'figma';
    exportedAt: string;
  };
  scene: {
    rootNodeId: string;
    coordinateSpace: 'root-local';
    nodes: IrNode[];
  };
  compositions: IrComposition[];
  diagnostics: IrDiagnostic[];
};

export type TrackSource = {
  timelineOffset: number;
  duration?: number;
  animationStyleId?: string;
  animationStyleName?: string;
};

export type ClipDraft = IrClip & {
  clipKey: string;
};

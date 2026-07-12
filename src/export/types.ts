export type DiagnosticLevel = 'info' | 'warning' | 'error';

export type Diagnostic = {
  level: DiagnosticLevel;
  code: string;
  message: string;
  nodeId?: string;
};

export type PagxAttrValue = string | number | boolean;

export type ColorStop = {
  offset: number;
  color: string;
};

export type ColorSource =
  | { kind: 'solid'; color: string }
  | {
      kind: 'linearGradient';
      startPoint?: string;
      endPoint?: string;
      stops: ColorStop[];
    }
  | {
      kind: 'radialGradient';
      center?: string;
      radius?: number;
      stops: ColorStop[];
    }
  | {
      kind: 'conicGradient';
      center?: string;
      startAngle?: number;
      endAngle?: number;
      stops: ColorStop[];
    }
  | {
      kind: 'diamondGradient';
      center?: string;
      radius?: number;
      stops: ColorStop[];
    }
  | {
      kind: 'imagePattern';
      imageRef: string;
      scaleMode?: string;
    };

export type PagxElement =
  | { kind: 'rectangle'; attrs: Record<string, PagxAttrValue> }
  | { kind: 'ellipse'; attrs: Record<string, PagxAttrValue> }
  | { kind: 'polystar'; attrs: Record<string, PagxAttrValue> }
  | { kind: 'path'; attrs: Record<string, PagxAttrValue> }
  | { kind: 'text'; attrs: Record<string, PagxAttrValue>; text: string }
  | { kind: 'group'; attrs: Record<string, PagxAttrValue>; children: PagxElement[] }
  | { kind: 'textbox'; attrs: Record<string, PagxAttrValue>; children: PagxElement[] }
  | { kind: 'fill'; attrs: Record<string, PagxAttrValue>; colorSource?: ColorSource }
  | { kind: 'stroke'; attrs: Record<string, PagxAttrValue>; colorSource?: ColorSource }
  | { kind: 'dropShadowStyle'; attrs: Record<string, PagxAttrValue> }
  | { kind: 'innerShadowStyle'; attrs: Record<string, PagxAttrValue> }
  | { kind: 'backgroundBlurStyle'; attrs: Record<string, PagxAttrValue> }
  | { kind: 'blurFilter'; attrs: Record<string, PagxAttrValue> };

export type PagxResource =
  | { kind: 'image'; id: string; source: string };

export type PagxKeyframeInterpolation = 'linear' | 'none' | 'bezier' | 'hold';

export type PagxKeyframe = {
  time: number;
  value: string;
  interpolation?: PagxKeyframeInterpolation;
  bezierOut?: string;
  bezierIn?: string;
};

export type PagxChannel = {
  name: string;
  type: 'float' | 'matrix';
  keyframes: PagxKeyframe[];
};

export type PagxAnimationObject = {
  target: string;
  channels: PagxChannel[];
};

export type PagxLoopMode = 'once' | 'loop' | 'pingPong';

export type PagxAnimation = {
  id: string;
  duration: number;
  frameRate: number;
  loop: PagxLoopMode;
  objects: PagxAnimationObject[];
};

export type PagxLayer = {
  id: string;
  name: string;
  attrs: Record<string, PagxAttrValue>;
  customData: Record<string, string>;
  contents: PagxElement[];
  children: PagxLayer[];
};

export type PagxDocument = {
  width: number;
  height: number;
  resources: PagxResource[];
  animations: PagxAnimation[];
  layers: PagxLayer[];
  customData: Record<string, string>;
};

export type ExportOptions = {
  frameRate?: number;
  encodeWebp?: (bytes: Uint8Array) => Promise<Uint8Array>;
};

export type ExportResult = {
  document: PagxDocument;
  diagnostics: Diagnostic[];
  nodeCount: number;
};

export type ExportContext = {
  root: SceneNode;
  rootBounds: Rect;
  diagnostics: Diagnostic[];
  resources: PagxResource[];
  usedIds: Set<string>;
  nodeCount: number;
  layerIdByFigmaId: Map<string, string>;
  motionTargetIdByFigmaId: Map<string, string>;
  frameRate: number;
  encodeWebp?: (bytes: Uint8Array) => Promise<Uint8Array>;
};

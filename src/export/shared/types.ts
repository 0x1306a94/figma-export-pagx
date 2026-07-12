export type DiagnosticLevel = 'info' | 'warning' | 'error';

export type Diagnostic = {
  level: DiagnosticLevel;
  code: string;
  message: string;
  nodeId?: string;
};

export type ExportOptions = {
  frameRate?: number;
  encodeWebp?: (bytes: Uint8Array) => Promise<Uint8Array>;
};

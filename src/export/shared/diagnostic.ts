import type { Diagnostic } from './types';

export function addDiagnostic(
  diagnostics: Diagnostic[],
  level: Diagnostic['level'],
  code: string,
  message: string,
  nodeId?: string,
): void {
  diagnostics.push({ level, code, message, nodeId });
}

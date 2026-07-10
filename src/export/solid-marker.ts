/** Parse `#solid` layer-name marker for PAG SolidLayer export. */

export type SolidMarkerResult = {
  isSolid: boolean;
  exportName: string;
};

const SOLID_PREFIX = /^#solid\b/i;

/**
 * `#solid` / `#Solid` prefix (case-insensitive).
 * Strips the prefix and any following spaces from the export name.
 */
export function parseSolidMarker(name: string): SolidMarkerResult {
  const match = SOLID_PREFIX.exec(name);
  if (!match) {
    return { isSolid: false, exportName: name };
  }
  return {
    isSolid: true,
    exportName: name.slice(match[0].length).replace(/^\s+/, ''),
  };
}

/** Layer display name for export (strips `#solid` even when not treating as Solid). */
export function exportLayerName(name: string): string {
  return parseSolidMarker(name).exportName;
}

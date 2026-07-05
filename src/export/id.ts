export function figmaIdToPagxId(figmaId: string, prefix: string): string {
  return `${prefix}_${figmaId.replace(/[:;]/g, '_')}`;
}

export function ensureUniqueId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }
  let index = 1;
  while (usedIds.has(`${baseId}_${index}`)) {
    index += 1;
  }
  const uniqueId = `${baseId}_${index}`;
  usedIds.add(uniqueId);
  return uniqueId;
}

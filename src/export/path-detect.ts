type Point = { x: number; y: number };

type ParsedPath = {
  verbs: Array<'move' | 'line' | 'cubic' | 'close'>;
  points: Point[];
};

const KAPPA = 0.5522847;
const AXIS_TOLERANCE = 0.01;
const ELLIPSE_POINT_TOLERANCE = 1.0;
const ELLIPSE_CP_TOLERANCE = 2.0;

export function parseSvgPath(data: string): ParsedPath {
  const verbs: ParsedPath['verbs'] = [];
  const points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };

  const tokens = data.match(/[a-zA-Z]|-?(?:\d+\.\d*|\.\d+|\d+)(?:e[-+]?\d+)?/g);
  if (!tokens) {
    return { verbs, points };
  }

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index++];
    if (!/[a-zA-Z]/.test(token)) {
      continue;
    }

    const command = token;
    const isRelative = command === command.toLowerCase() && command !== 'Z' && command !== 'z';
    const upper = command.toUpperCase();

    if (upper === 'Z') {
      verbs.push('close');
      current = { ...start };
      continue;
    }

    const numbers: number[] = [];
    while (index < tokens.length && !/[a-zA-Z]/.test(tokens[index])) {
      numbers.push(Number(tokens[index++]));
    }

    if (upper === 'M') {
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        current = {
          x: isRelative ? current.x + numbers[i] : numbers[i],
          y: isRelative ? current.y + numbers[i + 1] : numbers[i + 1],
        };
        if (i === 0) {
          start = { ...current };
          verbs.push('move');
          points.push({ ...current });
        } else {
          verbs.push('line');
          points.push({ ...current });
        }
      }
      continue;
    }

    if (upper === 'L') {
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        current = {
          x: isRelative ? current.x + numbers[i] : numbers[i],
          y: isRelative ? current.y + numbers[i + 1] : numbers[i + 1],
        };
        verbs.push('line');
        points.push({ ...current });
      }
      continue;
    }

    if (upper === 'C') {
      for (let i = 0; i + 5 < numbers.length; i += 6) {
        const cp1 = {
          x: isRelative ? current.x + numbers[i] : numbers[i],
          y: isRelative ? current.y + numbers[i + 1] : numbers[i + 1],
        };
        const cp2 = {
          x: isRelative ? current.x + numbers[i + 2] : numbers[i + 2],
          y: isRelative ? current.y + numbers[i + 3] : numbers[i + 3],
        };
        current = {
          x: isRelative ? current.x + numbers[i + 4] : numbers[i + 4],
          y: isRelative ? current.y + numbers[i + 5] : numbers[i + 5],
        };
        verbs.push('cubic');
        points.push(cp1, cp2, { ...current });
      }
    }
  }

  return { verbs, points };
}

function tryReadAxisAlignedRect(parsed: ParsedPath): { width: number; height: number } | null {
  const { verbs, points } = parsed;
  if (verbs.length !== 5 && verbs.length !== 6) {
    return null;
  }
  if (verbs[0] !== 'move') {
    return null;
  }
  for (let i = 1; i + 1 < verbs.length; i += 1) {
    if (verbs[i] !== 'line') {
      return null;
    }
  }
  if (verbs[verbs.length - 1] !== 'close' || points.length < 4) {
    return null;
  }

  for (let i = 0; i < points.length; i += 1) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    if (dx > AXIS_TOLERANCE && dy > AXIS_TOLERANCE) {
      return null;
    }
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i += 1) {
    minX = Math.min(minX, points[i].x);
    maxX = Math.max(maxX, points[i].x);
    minY = Math.min(minY, points[i].y);
    maxY = Math.max(maxY, points[i].y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (width < AXIS_TOLERANCE || height < AXIS_TOLERANCE) {
    return null;
  }

  return { width, height };
}

function tryReadEllipse(parsed: ParsedPath): { width: number; height: number } | null {
  const { verbs, points } = parsed;
  if (verbs.length !== 6 || verbs[0] !== 'move' || verbs[5] !== 'close' || points.length < 13) {
    return null;
  }
  for (let i = 1; i <= 4; i += 1) {
    if (verbs[i] !== 'cubic') {
      return null;
    }
  }

  const onCurve = [points[0], points[3], points[6], points[9]];
  let minX = onCurve[0].x;
  let maxX = onCurve[0].x;
  let minY = onCurve[0].y;
  let maxY = onCurve[0].y;
  for (let i = 1; i < 4; i += 1) {
    minX = Math.min(minX, onCurve[i].x);
    maxX = Math.max(maxX, onCurve[i].x);
    minY = Math.min(minY, onCurve[i].y);
    maxY = Math.max(maxY, onCurve[i].y);
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  if (rx < AXIS_TOLERANCE || ry < AXIS_TOLERANCE) {
    return null;
  }

  let foundTop = false;
  let foundBottom = false;
  let foundLeft = false;
  let foundRight = false;
  for (const point of onCurve) {
    const dx = Math.abs(point.x - cx);
    const dy = Math.abs(point.y - cy);
    if (dx < ELLIPSE_POINT_TOLERANCE && Math.abs(dy - ry) < ELLIPSE_POINT_TOLERANCE) {
      if (point.y < cy) foundTop = true;
      else foundBottom = true;
    } else if (dy < ELLIPSE_POINT_TOLERANCE && Math.abs(dx - rx) < ELLIPSE_POINT_TOLERANCE) {
      if (point.x < cx) foundLeft = true;
      else foundRight = true;
    }
  }
  if (!(foundTop && foundBottom && foundLeft && foundRight)) {
    return null;
  }

  const expectedCpOffsetX = rx * KAPPA;
  const expectedCpOffsetY = ry * KAPPA;
  for (let seg = 0; seg < 4; seg += 1) {
    const cp1 = points[1 + seg * 3];
    const cp2 = points[2 + seg * 3];
    const segStart = seg === 0 ? points[0] : points[seg * 3];
    const segEnd = points[3 + seg * 3];
    const cp1DistX = Math.abs(cp1.x - segStart.x);
    const cp1DistY = Math.abs(cp1.y - segStart.y);
    const cp2DistX = Math.abs(cp2.x - segEnd.x);
    const cp2DistY = Math.abs(cp2.y - segEnd.y);
    const cp1Valid =
      (cp1DistX < ELLIPSE_CP_TOLERANCE && Math.abs(cp1DistY - expectedCpOffsetY) < ELLIPSE_CP_TOLERANCE)
      || (cp1DistY < ELLIPSE_CP_TOLERANCE && Math.abs(cp1DistX - expectedCpOffsetX) < ELLIPSE_CP_TOLERANCE);
    const cp2Valid =
      (cp2DistX < ELLIPSE_CP_TOLERANCE && Math.abs(cp2DistY - expectedCpOffsetY) < ELLIPSE_CP_TOLERANCE)
      || (cp2DistY < ELLIPSE_CP_TOLERANCE && Math.abs(cp2DistX - expectedCpOffsetX) < ELLIPSE_CP_TOLERANCE);
    if (!cp1Valid || !cp2Valid) {
      return null;
    }
  }

  return { width: rx * 2, height: ry * 2 };
}

function tryReadRoundedRect(parsed: ParsedPath): { width: number; height: number; roundness: number } | null {
  const expected: ParsedPath['verbs'] = ['move', 'line', 'cubic', 'line', 'cubic', 'line', 'cubic', 'line', 'cubic', 'close'];
  if (parsed.verbs.length !== expected.length) {
    return null;
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (parsed.verbs[i] !== expected[i]) {
      return null;
    }
  }

  const { points } = parsed;
  if (points.length < 13) {
    return null;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < AXIS_TOLERANCE || height < AXIS_TOLERANCE) {
    return null;
  }

  const roundness = Math.min(
    points[4].y - minY,
    points[8].x - minX,
    maxX - points[9].x,
    maxY - points[12].y,
  );
  if (roundness <= AXIS_TOLERANCE) {
    return null;
  }

  return { width, height, roundness };
}

export type CanonicalShape =
  | { kind: 'rectangle'; width: number; height: number; roundness?: number }
  | { kind: 'ellipse'; width: number; height: number }
  | { kind: 'path'; data: string };

export function canonicalizePathData(data: string): CanonicalShape {
  const parsed = parseSvgPath(data);

  const rect = tryReadAxisAlignedRect(parsed);
  if (rect) {
    return { kind: 'rectangle', width: rect.width, height: rect.height };
  }

  const rounded = tryReadRoundedRect(parsed);
  if (rounded) {
    return {
      kind: 'rectangle',
      width: rounded.width,
      height: rounded.height,
      roundness: rounded.roundness,
    };
  }

  const ellipse = tryReadEllipse(parsed);
  if (ellipse) {
    return { kind: 'ellipse', width: ellipse.width, height: ellipse.height };
  }

  return { kind: 'path', data };
}

export function shapeElementFromPathData(data: string): PagxShapeElement {
  const shape = canonicalizePathData(data);
  if (shape.kind === 'rectangle') {
    const attrs: Record<string, number> = {
      width: shape.width,
      height: shape.height,
    };
    if (shape.roundness !== undefined && shape.roundness > 0) {
      attrs.roundness = shape.roundness;
    }
    return { kind: 'rectangle', attrs };
  }
  if (shape.kind === 'ellipse') {
    return {
      kind: 'ellipse',
      attrs: { width: shape.width, height: shape.height },
    };
  }
  return {
    kind: 'path',
    attrs: { data: shape.data },
  };
}

export type PagxShapeElement =
  | { kind: 'rectangle'; attrs: Record<string, string | number | boolean> }
  | { kind: 'ellipse'; attrs: Record<string, string | number | boolean> }
  | { kind: 'path'; attrs: Record<string, string | number | boolean> };

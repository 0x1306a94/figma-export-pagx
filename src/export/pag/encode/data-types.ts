/** Data type writers aligned with libpag DataTypes.cpp */

import { PathVerb, PagColor, PagPathData, PagPoint, SPATIAL_PRECISION } from '../types';
import { EncodeStream } from './encode-stream';

enum PathRecord {
  Close = 0,
  Move = 1,
  Line = 2,
  HLine = 3,
  VLine = 4,
  Curve01 = 5,
  Curve10 = 6,
  Curve11 = 7,
}

export function writeTime(stream: EncodeStream, time: number): void {
  stream.writeEncodedUint64(time >>> 0);
}

export function writeColor(stream: EncodeStream, color: PagColor): void {
  stream.writeUint8(color.red);
  stream.writeUint8(color.green);
  stream.writeUint8(color.blue);
}

export function writePoint(stream: EncodeStream, point: PagPoint): void {
  stream.writeFloat(point.x);
  stream.writeFloat(point.y);
}

export function writePath(stream: EncodeStream, path: PagPathData): void {
  stream.writeEncodedUint32(path.verbs.length);
  if (path.verbs.length === 0) {
    return;
  }

  const pointList: number[] = [];
  let index = 0;
  let lastPoint: PagPoint = { x: 0, y: 0 };

  for (const verb of path.verbs) {
    switch (verb) {
      case PathVerb.Close:
        stream.writeUBits(PathRecord.Close, 3);
        break;
      case PathVerb.MoveTo: {
        lastPoint = path.points[index++];
        stream.writeUBits(PathRecord.Move, 3);
        pointList.push(lastPoint.x, lastPoint.y);
        break;
      }
      case PathVerb.LineTo: {
        const point = path.points[index++];
        if (point.x === lastPoint.x) {
          stream.writeUBits(PathRecord.VLine, 3);
          pointList.push(point.y);
        } else if (point.y === lastPoint.y) {
          stream.writeUBits(PathRecord.HLine, 3);
          pointList.push(point.x);
        } else {
          stream.writeUBits(PathRecord.Line, 3);
          pointList.push(point.x, point.y);
        }
        lastPoint = point;
        break;
      }
      case PathVerb.CurveTo: {
        const control1 = path.points[index++];
        const control2 = path.points[index++];
        const point = path.points[index++];
        if (control1.x === lastPoint.x && control1.y === lastPoint.y) {
          stream.writeUBits(PathRecord.Curve01, 3);
          pointList.push(control2.x, control2.y, point.x, point.y);
        } else if (control2.x === point.x && control2.y === point.y) {
          stream.writeUBits(PathRecord.Curve10, 3);
          pointList.push(control1.x, control1.y, point.x, point.y);
        } else {
          stream.writeUBits(PathRecord.Curve11, 3);
          pointList.push(control1.x, control1.y, control2.x, control2.y, point.x, point.y);
        }
        lastPoint = point;
        break;
      }
      default:
        break;
    }
  }

  stream.writeFloatList(pointList, SPATIAL_PRECISION);
}

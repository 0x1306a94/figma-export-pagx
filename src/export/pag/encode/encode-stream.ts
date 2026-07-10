/** Little-endian EncodeStream aligned with libpag EncodeStream. */

import { LENGTH_FOR_STORE_NUM_BITS } from '../types';

function bitsToBytes(bitCapacity: number): number {
  return (bitCapacity + 7) >> 3;
}

function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

export class EncodeStream {
  private bytes: Uint8Array;
  private capacity: number;
  private _length = 0;
  private _position = 0;
  private _bitPosition = 0;
  private view: DataView;

  constructor(initialCapacity = 128) {
    this.capacity = Math.max(128, initialCapacity);
    this.bytes = new Uint8Array(this.capacity);
    this.view = new DataView(this.bytes.buffer);
  }

  length(): number {
    return this._length;
  }

  position(): number {
    return this._position;
  }

  data(): Uint8Array {
    return this.bytes.subarray(0, this._length);
  }

  release(): Uint8Array {
    return this.bytes.slice(0, this._length);
  }

  alignWithBytes(): void {
    this._bitPosition = this._position * 8;
  }

  private ensure(bytesToWrite: number): void {
    if (this._position + bytesToWrite <= this.capacity) {
      return;
    }
    let newCapacity = this.capacity === 0 ? 128 : this.capacity;
    const needed = this._position + bytesToWrite;
    while (newCapacity < needed) {
      newCapacity = Math.floor((newCapacity * 3) / 2);
    }
    const next = new Uint8Array(newCapacity);
    next.set(this.bytes.subarray(0, this._length));
    this.bytes = next;
    this.capacity = newCapacity;
    this.view = new DataView(this.bytes.buffer);
  }

  private positionChanged(offset: number): void {
    this._position += offset;
    this._bitPosition = this._position * 8;
    if (this._position > this._length) {
      this._length = this._position;
    }
  }

  private bitPositionChanged(_offset: number): void {
    this._position = bitsToBytes(this._bitPosition);
    if (this._position > this._length) {
      this._length = this._position;
    }
  }

  writeBoolean(value: boolean): void {
    this.ensure(1);
    this.bytes[this._position] = value ? 1 : 0;
    this.positionChanged(1);
  }

  writeInt8(value: number): void {
    this.ensure(1);
    this.view.setInt8(this._position, value);
    this.positionChanged(1);
  }

  writeUint8(value: number): void {
    this.ensure(1);
    this.bytes[this._position] = value & 0xff;
    this.positionChanged(1);
  }

  writeUint16(value: number): void {
    this.ensure(2);
    this.view.setUint16(this._position, value, true);
    this.positionChanged(2);
  }

  writeUint32(value: number): void {
    this.ensure(4);
    this.view.setUint32(this._position, value >>> 0, true);
    this.positionChanged(4);
  }

  writeFloat(value: number): void {
    this.ensure(4);
    this.view.setFloat32(this._position, value, true);
    this.positionChanged(4);
  }

  writeBytes(source: Uint8Array | EncodeStream, length = 0, offset = 0): void {
    const src = source instanceof EncodeStream ? source.data() : source;
    const available = src.length - offset;
    if (available <= 0) {
      return;
    }
    const writeLength = length === 0 ? available : Math.min(length, available);
    this.ensure(writeLength);
    this.bytes.set(src.subarray(offset, offset + writeLength), this._position);
    this.positionChanged(writeLength);
  }

  writeByteData(data: Uint8Array): void {
    this.writeEncodedUint32(data.length);
    this.writeBytes(data);
  }

  writeUTF8String(text: string): void {
    const encoded = utf8Encode(text);
    this.ensure(encoded.length + 1);
    this.bytes.set(encoded, this._position);
    this._position += encoded.length;
    this.bytes[this._position] = 0;
    this.positionChanged(1);
  }

  writeEncodedUint32(value: number): void {
    this.writeEncodedUint64(value >>> 0);
  }

  writeEncodedInt32(value: number): void {
    const flag = value < 0 ? 1 : 0;
    const data = (Math.abs(value) << 1) | flag;
    this.writeEncodedUint64(data >>> 0);
  }

  writeEncodedUint64(value: number): void {
    let remaining = value;
    for (let i = 0; i < 64; i += 7) {
      let byte = remaining & 127;
      remaining = Math.floor(remaining / 128);
      if (remaining > 0) {
        byte |= 128;
      }
      this.ensure(1);
      this.bytes[this._position++] = byte;
      this.positionChanged(0);
      if (remaining === 0) {
        break;
      }
    }
  }

  writeBitBoolean(value: boolean): void {
    this.writeUBits(value ? 1 : 0, 1);
  }

  writeUBits(value: number, numBits: number): void {
    const bitMasks = [0, 1, 3, 7, 15, 31, 63, 127, 255];
    let bitsLeft = numBits;
    let data = value >>> 0;
    const bytesToWrite = bitsToBytes(this._bitPosition + bitsLeft) - this._position;
    this.ensure(Math.max(0, bytesToWrite));
    while (bitsLeft > 0) {
      const bytePosition = Math.floor(this._bitPosition / 8);
      const bitPosition = this._bitPosition % 8;
      let byte = this.bytes[bytePosition] ?? 0;
      byte &= bitMasks[bitPosition];
      const bitLength = Math.min(8 - bitPosition, bitsLeft);
      const bits = data & bitMasks[bitLength];
      byte |= bits << bitPosition;
      this.bytes[bytePosition] = byte;
      data >>>= bitLength;
      bitsLeft -= bitLength;
      this._bitPosition += bitLength;
    }
    this.bitPositionChanged(0);
  }

  writeBits(value: number, numBits: number): void {
    let data = (value >>> 0) << (33 - numBits);
    data >>>= 33 - numBits;
    if (value < 0) {
      data |= 1 << (numBits - 1);
    }
    this.writeUBits(data, numBits);
  }

  private static bitLengthUint(data: number): number {
    let length = 32;
    let value = data >>> 0;
    const mask = 1 << 31;
    while (length > 1) {
      if ((value & mask) !== 0) {
        break;
      }
      value <<= 1;
      length -= 1;
    }
    return length;
  }

  private static bitLengthInt(value: number): number {
    const data = Math.abs(value) >>> 0;
    let length = EncodeStream.bitLengthUint(data);
    if (length >= 32) {
      length = 31;
    }
    return length + 1;
  }

  writeInt32List(values: number[]): void {
    const count = values.length;
    if (count === 0) {
      this.writeUBits(0, LENGTH_FOR_STORE_NUM_BITS);
      return;
    }
    let bitLength = 1;
    for (const value of values) {
      bitLength = Math.max(bitLength, EncodeStream.bitLengthInt(value));
    }
    this.writeUBits(bitLength - 1, LENGTH_FOR_STORE_NUM_BITS);
    for (const value of values) {
      this.writeBits(value, bitLength);
    }
  }

  writeUint32List(values: number[]): void {
    const count = values.length;
    if (count === 0) {
      this.writeUBits(0, LENGTH_FOR_STORE_NUM_BITS);
      return;
    }
    let bitLength = 1;
    for (const value of values) {
      bitLength = Math.max(bitLength, EncodeStream.bitLengthUint(value >>> 0));
    }
    this.writeUBits(bitLength - 1, LENGTH_FOR_STORE_NUM_BITS);
    for (const value of values) {
      this.writeUBits(value >>> 0, bitLength);
    }
  }

  writeFloatList(values: number[], precision: number): void {
    if (values.length === 0) {
      this.writeUBits(0, LENGTH_FOR_STORE_NUM_BITS);
      return;
    }
    const scale = 1 / precision;
    const list = values.map((value) => Math.round(value * scale));
    this.writeInt32List(list);
  }
}

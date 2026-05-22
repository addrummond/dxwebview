export class BinaryReaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BinaryReaderError";
  }
}

export class BinaryReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  seek(offset: number): void {
    if (offset < 0 || offset > this.length) {
      throw new BinaryReaderError(`Seek offset ${offset} is outside the file.`);
    }

    this.offset = offset;
  }

  readUint8(): number {
    this.ensure(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readInt32(): number {
    this.ensure(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readUint32(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readBytes(length: number): Uint8Array {
    this.ensure(length);
    const bytes = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readCompactIndex(): number {
    const first = this.readUint8();
    let value = first & 0x3f;

    if ((first & 0x40) !== 0) {
      let shift = 6;

      for (let byteIndex = 0; byteIndex < 4; byteIndex += 1) {
        const next = this.readUint8();
        const mask = byteIndex === 3 ? 0x1f : 0x7f;
        value |= (next & mask) << shift;

        if ((next & 0x80) === 0) {
          break;
        }

        shift += 7;
      }
    }

    return (first & 0x80) !== 0 ? -value : value;
  }

  readSerializedString(): string {
    const length = this.readCompactIndex();

    if (length === 0) {
      return "";
    }

    if (length > 0) {
      const bytes = this.readBytes(length);
      const end = bytes.at(-1) === 0 ? bytes.length - 1 : bytes.length;
      return new TextDecoder("windows-1252").decode(bytes.subarray(0, end));
    }

    const codeUnitCount = Math.abs(length);
    const chars: number[] = [];

    for (let index = 0; index < codeUnitCount; index += 1) {
      chars.push(this.readUint16());
    }

    if (chars.at(-1) === 0) {
      chars.pop();
    }

    return String.fromCharCode(...chars);
  }

  private ensure(length: number): void {
    if (length < 0 || this.offset + length > this.length) {
      throw new BinaryReaderError(
        `Read of ${length} bytes at ${this.offset} exceeds file length ${this.length}.`
      );
    }
  }
}

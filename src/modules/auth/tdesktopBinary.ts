import { IGE as AESIGE } from '@cryptography/aes';

/** Matches gramJS `Helpers.convertToLittle` used after `@cryptography/aes` IGE decrypt. */
function convertToLittle(buf: Uint32Array): Buffer {
  const correct = Buffer.alloc(buf.length * 4);
  for (let i = 0; i < buf.length; i += 1) {
    correct.writeUInt32BE(buf[i] >>> 0, i * 4);
  }
  return correct;
}

export function igeDecrypt(cipherText: Buffer, aesKey: Buffer, aesIv: Buffer): Buffer {
  const ige = new AESIGE(aesKey, aesIv);
  const dec = ige.decrypt(cipherText);
  return convertToLittle(dec);
}

export class TdesktopBinaryReader {
  private offset = 0;

  constructor(private readonly stream: Buffer) {}

  read(length = -1, checkLength = true): Buffer {
    let len = length;
    if (len === -1) {
      len = this.stream.length - this.offset;
    }
    const result = this.stream.subarray(this.offset, this.offset + len);
    this.offset += len;
    if (checkLength && result.length !== len) {
      throw new Error(`No more data left to read (need ${len}, got ${result.length})`);
    }
    return Buffer.from(result);
  }

  /** gramJS `readInt(false)` — unsigned int32 LE. */
  readUInt32LE(): number {
    return this.read(4).readUInt32LE(0);
  }

  getBuffer(): Buffer {
    return this.stream;
  }
}

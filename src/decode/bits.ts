// ビット単位の抽出ユーティリティ (固定フォーマットフレーム信号のデコードで使用)。
//
// モデル: byteOffsetから始まる ceil((bitOffset+lengthBits)/8) バイトを
// アドレス昇順に読み、little-endianなスクラッチ整数として組み立てたうえで
// bitOffsetだけ右シフトしてlengthBitsビットを取り出す。
// byteOrder='big' はバイトアラインされた8bit超のフィールド (Motorola的な
// MSBファーストのワード) にのみ適用し、抽出後の値をバイト単位で反転する。
// ビット非アラインなフィールドでのbig対応は簡略化している (既知の制約)。
import { Endian } from '../models/types';

export function extractBits(
  data: Uint8Array,
  byteOffset: number,
  bitOffset: number,
  lengthBits: number,
  byteOrder: Endian
): number {
  if (lengthBits <= 0 || lengthBits > 32) {
    throw new Error(`lengthBits must be 1-32, got ${lengthBits}`);
  }
  const nBytes = Math.ceil((bitOffset + lengthBits) / 8);
  let scratch = 0n;
  for (let i = nBytes - 1; i >= 0; i--) {
    const byte = data[byteOffset + i] ?? 0;
    scratch = (scratch << 8n) | BigInt(byte);
  }
  const mask = (1n << BigInt(lengthBits)) - 1n;
  let extracted = (scratch >> BigInt(bitOffset)) & mask;

  const byteAligned = bitOffset === 0 && lengthBits % 8 === 0 && lengthBits > 8;
  if (byteOrder === 'big' && byteAligned) {
    const byteCount = lengthBits / 8;
    let swapped = 0n;
    for (let i = 0; i < byteCount; i++) {
      const b = (extracted >> BigInt(i * 8)) & 0xffn;
      swapped = (swapped << 8n) | b;
    }
    extracted = swapped;
  }

  return Number(extracted);
}

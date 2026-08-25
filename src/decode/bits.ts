// ビット単位の抽出ユーティリティ (固定フォーマットフレーム信号のデコードで使用)。
//
// byteOrder='little' (Intel方式): bitOffsetはbyteOffsetバイトのLSB(bit0)を
// 起点に数える。バイト境界をまたぐ場合、次のバイトの「LSB側」へ継続する
// (byteOffsetから昇順のバイト列をリトルエンディアンなスクラッチ整数として
// 組み立て、bitOffsetぶん右シフトしてlengthBitsぶんマスクする)。
//
// byteOrder='big' (Motorola方式): bitOffsetはbyteOffsetバイトのMSB(bit7)を
// 起点に数える (bitOffset=0が最上位ビット、7が最下位ビット)。バイト境界を
// またぐ場合、次のバイトの「MSB側」へ継続する。1バイトに収まらない・
// バイト境界の途中から始まるフィールドでも、この向きで隙間なく連続した
// ビット列として扱う。
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
  return byteOrder === 'big'
    ? extractBitsMotorola(data, byteOffset, bitOffset, lengthBits)
    : extractBitsIntel(data, byteOffset, bitOffset, lengthBits);
}

function extractBitsIntel(data: Uint8Array, byteOffset: number, bitOffset: number, lengthBits: number): number {
  const nBytes = Math.ceil((bitOffset + lengthBits) / 8);
  let scratch = 0n;
  for (let i = nBytes - 1; i >= 0; i--) {
    const byte = data[byteOffset + i] ?? 0;
    scratch = (scratch << 8n) | BigInt(byte);
  }
  const mask = (1n << BigInt(lengthBits)) - 1n;
  const extracted = (scratch >> BigInt(bitOffset)) & mask;
  return Number(extracted);
}

/**
 * (byteOffset, bitOffset)がMotorola方式で指す、フレーム先頭からのビット
 * 位置 (0=byte0のbit7(MSB))。extractBitsMotorolaとbuildBitGrid(表示側)の
 * 両方で同じ位置計算を使うための共有ヘルパー。
 */
export function motorolaBitPosition(byteOffset: number, bitOffset: number, indexInField: number): {
  byteIdx: number;
  bitIdx: number;
} {
  const pos = bitOffset + indexInField;
  const byteIdx = byteOffset + Math.floor(pos / 8);
  const bitIdx = 7 - (pos % 8); // 0=MSB起点の数え方 -> 実際のビット位置(0=LSB..7=MSB)に変換
  return { byteIdx, bitIdx };
}

function extractBitsMotorola(data: Uint8Array, byteOffset: number, bitOffset: number, lengthBits: number): number {
  let value = 0n;
  for (let i = 0; i < lengthBits; i++) {
    const { byteIdx, bitIdx } = motorolaBitPosition(byteOffset, bitOffset, i);
    const byte = data[byteIdx] ?? 0;
    const bit = (byte >> bitIdx) & 1;
    value = (value << 1n) | BigInt(bit);
  }
  return Number(value);
}

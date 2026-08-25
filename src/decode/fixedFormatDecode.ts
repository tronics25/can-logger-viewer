// 固定フォーマットフレーム信号のデコード: バイト位置+ビット位置+データ長(bit)で
// 値を抽出し、raw * Lsb + offset を適用する（オフセットはLsb換算後の値に対して
// 加算する。Lsb換算前のrawに対してではない点に注意）。Max/Min・N.C.の概念はない
// (Loggerとは独立した、常時固定のフォーマット)。
import { DecodedValue, FixedFormatSignal } from '../models/types';
import { extractBits } from './bits';

export function decodeFixedFormatSignal(signal: FixedFormatSignal, data: Uint8Array): DecodedValue {
  const raw = extractBits(data, signal.byteOffset, signal.bitOffset, signal.lengthBits, signal.byteOrder);
  const value = raw * signal.lsb + signal.offset;
  return { raw, value, unit: signal.unit, clamp: null };
}

/** その信号が要求するバイト範囲が、実際に受信したデータ長に収まっているか。 */
function fitsInData(signal: FixedFormatSignal, dataLength: number): boolean {
  const requiredBytes = signal.byteOffset + Math.ceil((signal.bitOffset + signal.lengthBits) / 8);
  return requiredBytes <= dataLength;
}

/**
 * そのCAN IDに登録済みの全信号をデコードする。
 * 信号のバイト範囲が実際の受信データ長を超える場合はスキップする
 * (例: CAN FD用に64バイトで定義した信号を、同じCAN IDのClassic CAN 8バイト
 * フレームに適用しようとした場合。extractBitsは範囲外バイトを0として読むため、
 * ここでチェックしないと存在しないデータから偽の値が生成されてしまう)。
 * スキップされた信号はskippedにまとめて返す。
 */
export function decodeFixedFormatFrame(
  signals: FixedFormatSignal[],
  data: Uint8Array
): { decoded: { signal: FixedFormatSignal; decoded: DecodedValue }[]; skipped: FixedFormatSignal[] } {
  const decoded: { signal: FixedFormatSignal; decoded: DecodedValue }[] = [];
  const skipped: FixedFormatSignal[] = [];
  for (const signal of signals) {
    if (fitsInData(signal, data.length)) {
      decoded.push({ signal, decoded: decodeFixedFormatSignal(signal, data) });
    } else {
      skipped.push(signal);
    }
  }
  return { decoded, skipped };
}

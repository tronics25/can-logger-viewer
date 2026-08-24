// 固定フォーマットフレーム信号のデコード: バイト位置+ビット位置+データ長(bit)で
// 値を抽出し、(raw + offset) * Lsb を適用する。Max/Min・N.C.の概念はない
// (Loggerとは独立した、常時固定のフォーマット)。
import { DecodedValue, FixedFormatSignal } from '../models/types';
import { extractBits } from './bits';

export function decodeFixedFormatSignal(signal: FixedFormatSignal, data: Uint8Array): DecodedValue {
  const raw = extractBits(data, signal.byteOffset, signal.bitOffset, signal.lengthBits, signal.byteOrder);
  const value = (raw + signal.offset) * signal.lsb;
  return { raw, value, unit: signal.unit, clamp: null };
}

/** そのCAN IDに登録済みの全信号をデコードする。 */
export function decodeFixedFormatFrame(
  signals: FixedFormatSignal[],
  data: Uint8Array
): { signal: FixedFormatSignal; decoded: DecodedValue }[] {
  return signals.map((signal) => ({ signal, decoded: decodeFixedFormatSignal(signal, data) }));
}

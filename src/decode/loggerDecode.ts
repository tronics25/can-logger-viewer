// Logger項目のデコード: raw * Lsb + offset。
// オフセットはLsb換算後の値に対して加算する (Lsb換算前のrawに対してではない)。
// クランプ済み前提 (MAX/MIN一致を検出するのみ、丸めはしない)。
// 未設定スロット (0xFFFF / 0xFFFFFFFF) は N.C. として扱う。
import { ClampState, DecodedValue, Endian, LoggerItemSpec, slotCountFor } from '../models/types';

const NC_UINT16 = 0xffff;
const NC_UINT32 = 0xffffffff;
const EPS = 1e-9;

export function readUint(bytes: Uint8Array, endian: Endian): number {
  if (bytes.length === 2) {
    return endian === 'little' ? bytes[0] | (bytes[1] << 8) : (bytes[0] << 8) | bytes[1];
  }
  if (bytes.length === 4) {
    if (endian === 'little') {
      return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
    }
    return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  }
  throw new Error(`unsupported byte length ${bytes.length}`);
}

function nearlyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

export function decodeLoggerValue(item: LoggerItemSpec, bytes: Uint8Array): DecodedValue {
  const raw = readUint(bytes, item.endian);
  const isUint32 = slotCountFor(item.dataLength) === 2;
  const ncSentinel = isUint32 ? NC_UINT32 : NC_UINT16;

  if (raw === ncSentinel) {
    return { raw, value: NaN, unit: item.unit, clamp: 'nc' };
  }

  const value = raw * item.lsb + item.offset;
  let clamp: ClampState = null;
  if (nearlyEquals(value, item.max)) clamp = 'max';
  else if (nearlyEquals(value, item.min)) clamp = 'min';

  return { raw, value, unit: item.unit, clamp };
}

/** マッピングのスロット番号からLogger CAN IDフレーム内のバイト範囲を返す。 */
export function slotByteRange(slot: number, slotCount: 1 | 2): { start: number; end: number } {
  const start = slot * 2;
  return { start, end: start + slotCount * 2 };
}

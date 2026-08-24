// CAN ID表示フォーマット: Vector ASCログの表記に合わせる。
// 標準ID(11bit)は16進数のみ (例 "181")、拡張ID(29bit)は末尾に "x" を付与
// (例 "3B012400x")。"0x" プレフィックスは付けない。
import { CanIdRef } from '../models/types';

export function formatCanId(ref: CanIdRef): string {
  const hex = ref.id.toString(16).toUpperCase();
  return ref.extended ? `${hex}x` : hex;
}

/** "181" / "3B012400x" のような表記を CanIdRef にパースする。不正な場合は null。 */
export function parseCanId(text: string): CanIdRef | null {
  const trimmed = text.trim();
  const extended = trimmed.toLowerCase().endsWith('x');
  const hexPart = extended ? trimmed.slice(0, -1) : trimmed;
  if (!/^[0-9a-fA-F]+$/.test(hexPart)) {
    return null;
  }
  const id = parseInt(hexPart, 16);
  if (Number.isNaN(id)) {
    return null;
  }
  return { id, extended };
}

export function canIdEquals(a: CanIdRef, b: CanIdRef): boolean {
  return a.id === b.id && a.extended === b.extended;
}

/** 正規表現によるCAN IDフィルタ。表示形式の文字列に対してマッチさせる。 */
export function matchesCanIdFilter(ref: CanIdRef, pattern: string): boolean {
  if (!pattern) {
    return true;
  }
  try {
    const re = new RegExp(pattern, 'i');
    return re.test(formatCanId(ref));
  } catch {
    // 不正な正規表現は「フィルタなし」として扱う (呼び出し側でエラー表示する)
    return true;
  }
}

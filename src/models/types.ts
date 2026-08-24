// Shared data model for CAN Logger Viewer.
// These types mirror docs/requirements.md 1:1 — keep them in sync when the
// requirements change.

export type Endian = 'little' | 'big';

// ---------------------------------------------------------------------------
// Logger項目仕様 (.canlogger/logger-specs.json)
// ---------------------------------------------------------------------------

export interface LoggerCategory {
  /** 分類番号 */
  number: number;
  /** 分類名 */
  name: string;
}

export type LoggerDataLength = 'UINT16' | 'UINT32';

export interface LoggerItemSpec {
  id: string;
  /** データ名称 */
  name: string;
  /** 分類番号 */
  categoryNumber: number;
  /**
   * データ番号 (開始番号のみを指定する、単一の整数)。
   * dataLength='UINT32' の場合、この番号と次番号 (dataNumber+1) の
   * 2データ番号ぶん = 4バイトを自動的に占有する。範囲を文字列で直接
   * 指定させると "1-5" のような不正な範囲を登録できてしまうため、
   * 開始番号＋データ長の組み合わせでのみ表現する。
   */
  dataNumber: number;
  dataLength: LoggerDataLength;
  /** 単位 */
  unit: string;
  /** オフセット値 */
  offset: number;
  /** Lsb (Resolution) */
  lsb: number;
  max: number;
  min: number;
  endian: Endian;
}

export interface LoggerSpecsFile {
  categories: LoggerCategory[];
  items: LoggerItemSpec[];
}

/** データ長からスロット占有数 (1 = UINT16, 2 = UINT32) を返す。 */
export function slotCountFor(dataLength: LoggerDataLength): 1 | 2 {
  return dataLength === 'UINT32' ? 2 : 1;
}

/** この項目が占有するデータ番号一覧 (例: UINT32でdataNumber=4なら [4, 5])。 */
export function occupiedDataNumbers(item: Pick<LoggerItemSpec, 'dataNumber' | 'dataLength'>): number[] {
  return item.dataLength === 'UINT32' ? [item.dataNumber, item.dataNumber + 1] : [item.dataNumber];
}

/** 表示用のデータ番号ラベル (例: "4" / UINT32なら "4~5")。 */
export function dataNumberRangeLabel(item: Pick<LoggerItemSpec, 'dataNumber' | 'dataLength'>): string {
  return item.dataLength === 'UINT32' ? `${item.dataNumber}~${item.dataNumber + 1}` : `${item.dataNumber}`;
}

/** 分類番号+データ番号(範囲込み)の表示用キー文字列。 */
export function loggerItemKeyLabel(item: Pick<LoggerItemSpec, 'categoryNumber' | 'dataNumber' | 'dataLength'>): string {
  return `${item.categoryNumber}-${dataNumberRangeLabel(item)}`;
}

/**
 * 2つの項目が同じ分類内でデータ番号を共有(重複/オーバーラップ)しているか判定する。
 * UINT32項目が2データ番号を占有するため、単純な完全一致ではなく範囲の重なりで
 * 判定する (例: UINT16の"5"とUINT32の"4~5"は重複とみなす)。
 */
export function loggerItemsOverlap(
  a: Pick<LoggerItemSpec, 'categoryNumber' | 'dataNumber' | 'dataLength'>,
  b: Pick<LoggerItemSpec, 'categoryNumber' | 'dataNumber' | 'dataLength'>
): boolean {
  if (a.categoryNumber !== b.categoryNumber) return false;
  const bNums = new Set(occupiedDataNumbers(b));
  return occupiedDataNumbers(a).some((n) => bNums.has(n));
}

// ---------------------------------------------------------------------------
// Logger 1〜5 ⇔ 実CAN ID (.canlogger/logger-can-ids.json)
// ---------------------------------------------------------------------------

export type LoggerNumber = 1 | 2 | 3 | 4 | 5;

export interface CanIdRef {
  /** 数値のCAN ID (標準11bit または 拡張29bit) */
  id: number;
  extended: boolean;
}

export interface LoggerCanIdAssignment {
  loggerNumber: LoggerNumber;
  canId: CanIdRef;
}

export interface LoggerCanIdsFile {
  assignments: LoggerCanIdAssignment[];
}

export const DEFAULT_LOGGER_CAN_IDS: LoggerCanIdsFile = {
  assignments: [1, 2, 3, 4, 5].map((n) => ({
    loggerNumber: n as LoggerNumber,
    canId: { id: 0x181 + (n - 1), extended: false },
  })),
};

// ---------------------------------------------------------------------------
// Loggerマッピングプロファイル (.canlogger/logger-mappings.json)
// ---------------------------------------------------------------------------

export interface LoggerMappingSlot {
  /** スロット番号 (0始まり、そのLogger番号内での並び順) */
  slot: number;
  /** 割り当てる LoggerItemSpec.id。未割当は null (応答は0xFFFFになる)。 */
  itemId: string | null;
}

export interface LoggerMappingProfile {
  id: string;
  name: string;
  /** Logger番号(1〜5) -> スロット配列 */
  slots: Record<LoggerNumber, LoggerMappingSlot[]>;
}

export interface LoggerMappingsFile {
  profiles: LoggerMappingProfile[];
}

export function emptyMappingSlots(count = 8): LoggerMappingSlot[] {
  return Array.from({ length: count }, (_, i) => ({ slot: i, itemId: null }));
}

export function newMappingProfile(id: string, name: string): LoggerMappingProfile {
  return {
    id,
    name,
    slots: { 1: emptyMappingSlots(), 2: emptyMappingSlots(), 3: emptyMappingSlots(), 4: emptyMappingSlots(), 5: emptyMappingSlots() },
  };
}

// ---------------------------------------------------------------------------
// 固定フォーマットフレーム定義 (.canlogger/fixed-format.json)
// ---------------------------------------------------------------------------

export interface FixedFormatSignal {
  id: string;
  /** データ名称 */
  name: string;
  unit: string;
  /** 開始バイト位置 (0始まり) */
  byteOffset: number;
  /** バイト内の開始ビット位置 (0-7、0 = LSB) */
  bitOffset: number;
  /** データ長 (ビット単位) */
  lengthBits: number;
  lsb: number;
  offset: number;
  byteOrder: Endian;
}

export interface FixedFormatCanIdEntry {
  id: string;
  canId: CanIdRef;
  /** CANフレーム名 (信号名とは別、このCAN ID自体の名称) */
  name: string;
  /** フレーム長 (バイト)。Classic CAN: 最大8、CAN FD: 最大64 */
  frameLength: number;
  signals: FixedFormatSignal[];
}

export interface FixedFormatFile {
  entries: FixedFormatCanIdEntry[];
}

// ---------------------------------------------------------------------------
// パース済みCANフレーム (parsers/ の共通出力形式)
// ---------------------------------------------------------------------------

export type FrameDirection = 'Rx' | 'Tx';

export interface CanFrame {
  /** ログ先頭からの経過秒数 */
  timestamp: number;
  canId: number;
  extended: boolean;
  dir: FrameDirection;
  channel: number;
  /** 実データ長 (バイト)。CAN FDは最大64。 */
  dlc: number;
  data: Uint8Array;
}

export interface ParseResult {
  frames: CanFrame[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// デコード結果
// ---------------------------------------------------------------------------

export type ClampState = 'max' | 'min' | 'nc' | null;

export interface DecodedValue {
  raw: number;
  value: number;
  unit: string;
  clamp: ClampState;
}

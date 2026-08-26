// Loggerタブ共通: 受信フレームからLogger項目単位の行データを組み立てる。
// Loggerの6つのLogger番号は別々の物理CANフレームで届くため、単純に1フレーム=1行
// にすると同時刻に複数項目 (例: 3D軌跡のX/Y/Z) が揃わない。ここでは時系列順に
// フレームを処理しながら各項目の直近既知値を前方補完(forward-fill)し、フレーム
// 到着のたびにその時点のスナップショットを1行として記録する。
import { decodeFixedFormatFrame } from '../decode/fixedFormatDecode';
import { decodeLoggerValue, slotByteRange } from '../decode/loggerDecode';
import {
  DecodedValue,
  FixedFormatCanIdEntry,
  LoggerCanIdsFile,
  LoggerItemSpec,
  LoggerMappingProfile,
  LoggerNumber,
  LoggerSpecsFile,
  slotCountFor,
} from '../models/types';

export interface WireFrame {
  t: number;
  canId: number;
  extended: boolean;
  dir: 'Rx' | 'Tx';
  channel: number;
  dlc: number;
  dlcCode: number;
  data: number[];
}

export interface LoggerColumn {
  item: LoggerItemSpec;
  loggerNumber: LoggerNumber;
}

export interface LoggerRow {
  t: number;
  /** この行のスナップショットを更新した直接のLogger番号 (テーブル表示用) */
  loggerNumber: LoggerNumber;
  /** itemId -> その時点までの最新デコード値 (前方補完済み) */
  values: Map<string, DecodedValue>;
}

export function loggerColumnsFor(profile: LoggerMappingProfile, loggerSpecs: LoggerSpecsFile): LoggerColumn[] {
  const cols: LoggerColumn[] = [];
  for (let n = 1; n <= 6; n++) {
    const loggerNumber = n as LoggerNumber;
    for (const slot of profile.slots[loggerNumber]) {
      if (!slot.itemId) continue;
      const item = loggerSpecs.items.find((i) => i.id === slot.itemId);
      if (item) cols.push({ item, loggerNumber });
    }
  }
  return cols;
}

function loggerNumberForFrame(f: WireFrame, loggerCanIds: LoggerCanIdsFile): LoggerNumber | null {
  const a = loggerCanIds.assignments.find((x) => x.canId.id === f.canId && x.canId.extended === f.extended);
  return a ? a.loggerNumber : null;
}

export function buildLoggerRows(
  profile: LoggerMappingProfile,
  frames: WireFrame[],
  loggerSpecs: LoggerSpecsFile,
  loggerCanIds: LoggerCanIdsFile
): LoggerRow[] {
  const rows: LoggerRow[] = [];
  const latest = new Map<string, DecodedValue>();

  for (const f of frames) {
    const loggerNumber = loggerNumberForFrame(f, loggerCanIds);
    if (!loggerNumber) continue;
    const slots = profile.slots[loggerNumber];
    const data = new Uint8Array(f.data);
    let updated = false;
    for (const slot of slots) {
      if (!slot.itemId) continue;
      const item = loggerSpecs.items.find((i) => i.id === slot.itemId);
      if (!item) continue;
      const { start, end } = slotByteRange(slot.slot, slotCountFor(item.dataLength));
      if (end > data.length) continue;
      latest.set(item.id, decodeLoggerValue(item, data.subarray(start, end)));
      updated = true;
    }
    if (updated) rows.push({ t: f.t, loggerNumber, values: new Map(latest) });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// グラフ(時系列・3D)用: Logger項目に加え、固定フォーマットフレームの信号も
// 同じ時系列に混ぜて選択・表示できるようにする。
// ---------------------------------------------------------------------------

export interface ChartColumn {
  /** row.valuesのキー。Logger項目とfixed-format信号でIDが衝突しないようprefixする */
  id: string;
  name: string;
  unit: string;
  /** ピッカーでのグループ見出し (Logger=分類名、固定フォーマット=CANフレーム名) */
  groupLabel: string;
}

export interface ChartRow {
  t: number;
  values: Map<string, DecodedValue>;
}

function loggerColumnId(itemId: string): string {
  return `logger:${itemId}`;
}

function fixedColumnId(entryId: string, signalId: string): string {
  return `fixed:${entryId}:${signalId}`;
}

/**
 * Loggerマッピングプロファイルの項目と、固定フォーマットフレームの信号を
 * 1つの時系列としてまとめる。両方とも同じ前方補完(forward-fill)ロジックで
 * 扱うことで、Logger項目と固定フォーマット信号を同じグラフ上に混在させて
 * 表示できるようにする。
 */
export function buildChartData(
  profile: LoggerMappingProfile | null,
  frames: WireFrame[],
  loggerSpecs: LoggerSpecsFile,
  loggerCanIds: LoggerCanIdsFile,
  fixedFormat: FixedFormatCanIdEntry[]
): { columns: ChartColumn[]; rows: ChartRow[] } {
  const columns: ChartColumn[] = [];
  if (profile) {
    for (const col of loggerColumnsFor(profile, loggerSpecs)) {
      const cat = loggerSpecs.categories.find((c) => c.number === col.item.categoryNumber);
      columns.push({
        id: loggerColumnId(col.item.id),
        name: col.item.name,
        unit: col.item.unit,
        groupLabel: cat ? `${cat.number}: ${cat.name}` : `分類${col.item.categoryNumber}`,
      });
    }
  }
  // 固定フォーマットフレームは、登録済み全件ではなく実際に生ログで受信されて
  // いるCAN IDのものだけをグラフの選択対象にする (登録だけして実際には
  // 流れていないフレームまで選べてしまうと紛らわしいため)。
  const receivedCanIds = new Set(frames.map((f) => `${f.canId}:${f.extended}`));
  for (const entry of fixedFormat) {
    if (!receivedCanIds.has(`${entry.canId.id}:${entry.canId.extended}`)) continue;
    for (const signal of entry.signals) {
      columns.push({ id: fixedColumnId(entry.id, signal.id), name: signal.name, unit: signal.unit, groupLabel: entry.name });
    }
  }

  const rows: ChartRow[] = [];
  const latest = new Map<string, DecodedValue>();

  for (const f of frames) {
    let updated = false;

    if (profile) {
      const loggerNumber = loggerNumberForFrame(f, loggerCanIds);
      if (loggerNumber) {
        const slots = profile.slots[loggerNumber];
        const data = new Uint8Array(f.data);
        for (const slot of slots) {
          if (!slot.itemId) continue;
          const item = loggerSpecs.items.find((i) => i.id === slot.itemId);
          if (!item) continue;
          const { start, end } = slotByteRange(slot.slot, slotCountFor(item.dataLength));
          if (end > data.length) continue;
          latest.set(loggerColumnId(item.id), decodeLoggerValue(item, data.subarray(start, end)));
          updated = true;
        }
      }
    }

    const entry = fixedFormat.find((e) => e.canId.id === f.canId && e.canId.extended === f.extended);
    if (entry) {
      const { decoded } = decodeFixedFormatFrame(entry.signals, new Uint8Array(f.data));
      for (const { signal, decoded: d } of decoded) {
        latest.set(fixedColumnId(entry.id, signal.id), d);
        updated = true;
      }
    }

    if (updated) rows.push({ t: f.t, values: new Map(latest) });
  }

  return { columns, rows };
}

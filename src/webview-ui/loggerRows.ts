// Loggerタブ共通: 受信フレームからLogger項目単位の行データを組み立てる。
// Loggerの5つのLogger番号は別々の物理CANフレームで届くため、単純に1フレーム=1行
// にすると同時刻に複数項目 (例: 3D軌跡のX/Y/Z) が揃わない。ここでは時系列順に
// フレームを処理しながら各項目の直近既知値を前方補完(forward-fill)し、フレーム
// 到着のたびにその時点のスナップショットを1行として記録する。
import { decodeLoggerValue, slotByteRange } from '../decode/loggerDecode';
import {
  DecodedValue,
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
  for (let n = 1; n <= 5; n++) {
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

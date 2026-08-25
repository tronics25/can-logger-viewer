// Vector BLF (バイナリ) ログのパーサー。
//
// ⚠️ 実装メモ: BLFはVectorの非公開バイナリ形式で、公式の一次仕様書は配布され
// ていない。本実装は公開されている複数のOSS実装 (python-can の blf.py 等) で
// 広く採用されているレイアウトに基づく best-effort 実装であり、実際の
// .blf ファイルでの検証が未実施。ズレが見つかった場合はオブジェクトヘッダの
// オフセット (headerSize / headerVersion 依存部分) を優先的に疑うこと。
//
// ファイル構造:
//   [FileHeader]
//   [LogContainer]* (objectType=10, zlib圧縮 or 非圧縮のペイロードを持つ)
//     -> 展開すると [ObjectHeaderBase+Header][payload] の列 (4バイト境界)
//        CAN_MESSAGE(1) / CAN_MESSAGE2(86) / CAN_FD_MESSAGE(100) を
//        CanFrame に変換する
//
// CAN_FD_MESSAGE(100)のペイロード構造 ("<HBBLLBBB5x64s" 相当、84バイト固定)
// は公開実装 (python-can の blf.py) を参考にしたbest-effort実装。
// CAN_FD_MESSAGE_64(101) はビットタイミング情報を伴う可変長構造で、参照実装
// 間でも構造の記述に食い違いがあり誤読のリスクが高いため今回は未対応とし、
// 遭遇した場合はwarningsで件数のみ報告する。
import * as zlib from 'zlib';
import { CanFrame, ParseResult } from '../models/types';

const OBJ_TYPE_CAN_MESSAGE = 1;
const OBJ_TYPE_CAN_MESSAGE2 = 86;
const OBJ_TYPE_LOG_CONTAINER = 10;
const OBJ_TYPE_CAN_FD_MESSAGE = 100;
const OBJ_TYPE_CAN_FD_MESSAGE_64 = 101;

const FLAG_TEN_MICROSECONDS = 0x1;
const FLAG_NANOSECONDS = 0x2;
const TX_FLAG = 0x1;
const EXTENDED_ID_BIT = 0x80000000;

interface ObjectHeader {
  headerSize: number;
  headerVersion: number;
  objectSize: number;
  objectType: number;
  objectFlags: number;
  objectTimeStamp: bigint;
}

function readObjectHeader(buf: Buffer, offset: number): ObjectHeader | null {
  if (offset + 16 > buf.length) return null;
  const signature = buf.toString('ascii', offset, offset + 4);
  if (signature !== 'LOBJ') return null;

  const headerSize = buf.readUInt16LE(offset + 4);
  const headerVersion = buf.readUInt16LE(offset + 6);
  const objectSize = buf.readUInt32LE(offset + 8);
  const objectType = buf.readUInt32LE(offset + 12);

  let objectFlags = 0;
  let objectTimeStamp = 0n;
  if (headerVersion === 1 && offset + 32 <= buf.length) {
    objectFlags = buf.readUInt32LE(offset + 16);
    objectTimeStamp = buf.readBigUInt64LE(offset + 24);
  } else if (headerVersion === 2 && offset + 40 <= buf.length) {
    objectFlags = buf.readUInt32LE(offset + 16);
    objectTimeStamp = buf.readBigUInt64LE(offset + 24);
  }

  return { headerSize, headerVersion, objectSize, objectType, objectFlags, objectTimeStamp };
}

function tickToSeconds(tick: bigint, flags: number): number {
  if (flags & FLAG_TEN_MICROSECONDS) {
    return Number(tick) * 1e-5;
  }
  // FLAG_NANOSECONDS またはフラグ不明時は ns 分解能として扱う
  return Number(tick) * 1e-9;
}

function parseCanMessageObject(
  buf: Buffer,
  objStart: number,
  header: ObjectHeader,
  firstTick: { value: bigint | null },
  frames: CanFrame[]
): void {
  const payloadOffset = objStart + header.headerSize;
  if (payloadOffset + 14 > buf.length) return;

  const channel = buf.readUInt16LE(payloadOffset);
  const flags = buf.readUInt8(payloadOffset + 2);
  const dlcRaw = buf.readUInt8(payloadOffset + 3);
  const idRaw = buf.readUInt32LE(payloadOffset + 4);
  const dataOffset = payloadOffset + 8;

  const extended = (idRaw & EXTENDED_ID_BIT) !== 0;
  const canId = idRaw & 0x1fffffff;
  const dlc = Math.min(dlcRaw, 8);
  const data = new Uint8Array(dlc);
  for (let i = 0; i < dlc && dataOffset + i < buf.length; i++) {
    data[i] = buf.readUInt8(dataOffset + i);
  }

  if (firstTick.value === null) firstTick.value = header.objectTimeStamp;
  const elapsedTick = header.objectTimeStamp - firstTick.value;
  const timestamp = tickToSeconds(elapsedTick, header.objectFlags);

  frames.push({
    timestamp,
    canId,
    extended,
    dir: flags & TX_FLAG ? 'Tx' : 'Rx',
    channel,
    dlc,
    dlcCode: dlcRaw, // Classic CANのDLC生値 (通常0-8)
    data,
  });
}

// CAN_FD_MESSAGE(100) ペイロードレイアウト ("<HBBLLBBB5x64s", 84バイト固定):
//   channel(u16) flags(u8) dlc(u8,DLCコード0-15) canId(u32) frameLength(u32,未使用)
//   bitCount(u8,未使用) fdFlags(u8,未使用) validDataBytes(u8) pad(5) data(64)
function parseCanFdMessageObject(
  buf: Buffer,
  objStart: number,
  header: ObjectHeader,
  firstTick: { value: bigint | null },
  frames: CanFrame[]
): void {
  const payloadOffset = objStart + header.headerSize;
  if (payloadOffset + 84 > buf.length) return;

  const channel = buf.readUInt16LE(payloadOffset);
  const flags = buf.readUInt8(payloadOffset + 2);
  const dlcCode = buf.readUInt8(payloadOffset + 3);
  const idRaw = buf.readUInt32LE(payloadOffset + 4);
  const validDataBytes = buf.readUInt8(payloadOffset + 14);
  const dataOffset = payloadOffset + 20;

  const extended = (idRaw & EXTENDED_ID_BIT) !== 0;
  const canId = idRaw & 0x1fffffff;
  const dlc = Math.min(validDataBytes, 64);
  const data = new Uint8Array(dlc);
  for (let i = 0; i < dlc && dataOffset + i < buf.length; i++) {
    data[i] = buf.readUInt8(dataOffset + i);
  }

  if (firstTick.value === null) firstTick.value = header.objectTimeStamp;
  const elapsedTick = header.objectTimeStamp - firstTick.value;
  const timestamp = tickToSeconds(elapsedTick, header.objectFlags);

  frames.push({
    timestamp,
    canId,
    extended,
    dir: flags & TX_FLAG ? 'Tx' : 'Rx',
    channel,
    dlc,
    dlcCode,
    data,
  });
}

function parseContainedObjects(
  buf: Buffer,
  firstTick: { value: bigint | null },
  frames: CanFrame[],
  warnings: string[]
): void {
  let offset = 0;
  let unsupportedFdMessages = 0;
  while (offset + 16 <= buf.length) {
    const header = readObjectHeader(buf, offset);
    if (!header || header.objectSize < 16) {
      break; // 不正なオブジェクトに突入したら以降は信用できないため打ち切る
    }
    try {
      if (header.objectType === OBJ_TYPE_CAN_MESSAGE || header.objectType === OBJ_TYPE_CAN_MESSAGE2) {
        parseCanMessageObject(buf, offset, header, firstTick, frames);
      } else if (header.objectType === OBJ_TYPE_CAN_FD_MESSAGE) {
        parseCanFdMessageObject(buf, offset, header, firstTick, frames);
      } else if (header.objectType === OBJ_TYPE_CAN_FD_MESSAGE_64) {
        unsupportedFdMessages++;
      }
    } catch {
      warnings.push('一部のCANメッセージオブジェクトの解析に失敗しました（スキップ）');
    }
    // オブジェクトは4バイト境界にパディングされる
    const advance = Math.ceil(header.objectSize / 4) * 4;
    if (advance <= 0) break;
    offset += advance;
  }
  if (unsupportedFdMessages > 0) {
    warnings.push(
      `${unsupportedFdMessages}件のCAN_FD_MESSAGE_64形式のメッセージは未対応のためスキップしました。`
    );
  }
}

export function parseBlf(buffer: Buffer): ParseResult {
  const frames: CanFrame[] = [];
  const warnings: string[] = [
    'BLFパーサーは公開情報に基づくbest-effort実装です。実ファイルでの検証が未完了のため、値がおかしい場合は報告してください。',
  ];
  const firstTick: { value: bigint | null } = { value: null };

  const signature = buffer.toString('ascii', 0, 4);
  if (signature !== 'LOGG') {
    warnings.push('BLFファイルの署名 (LOGG) が見つかりませんでした。ファイルが破損しているか未対応の形式です。');
    return { frames, warnings };
  }
  const fileHeaderSize = buffer.readUInt32LE(4);

  let offset = fileHeaderSize;
  while (offset + 16 <= buffer.length) {
    const header = readObjectHeader(buffer, offset);
    if (!header || header.objectSize < 16) break;

    if (header.objectType === OBJ_TYPE_LOG_CONTAINER) {
      try {
        const containerFieldsOffset = offset + header.headerSize;
        const compressionMethod = buffer.readUInt16LE(containerFieldsOffset);
        const uncompressedSize = buffer.readUInt32LE(containerFieldsOffset + 8);
        const payloadOffset = containerFieldsOffset + 16;
        const payloadEnd = offset + header.objectSize;
        const rawPayload = buffer.subarray(payloadOffset, Math.min(payloadEnd, buffer.length));

        const inflated =
          compressionMethod === 2
            ? zlib.inflateSync(rawPayload)
            : rawPayload;

        if (compressionMethod === 2 && uncompressedSize > 0 && inflated.length !== uncompressedSize) {
          warnings.push('LogContainerの展開サイズが期待値と一致しませんでした（フォーマット解釈がずれている可能性）');
        }

        parseContainedObjects(inflated, firstTick, frames, warnings);
      } catch {
        warnings.push('LogContainerの展開に失敗しました（スキップ）');
      }
    }

    const advance = Math.ceil(header.objectSize / 4) * 4;
    if (advance <= 0) break;
    offset += advance;
  }

  return { frames, warnings };
}

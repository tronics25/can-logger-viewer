// Vector ASC (テキスト) ログのパーサー。
//
// 典型的な1行 (Classic CAN, データフレーム):
//   1.234500 1  181             Rx   d 8 01 02 03 04 05 06 07 08
//   1.235100 1  3B012400x       Tx   d 8 04 15 00 01 02 03 FF FF
//
// フィールド: timestamp(float) channel(int) id(hex, 拡張IDは末尾"x") dir(Rx/Tx)
//            frameType(d=データ/r=リモート) dlc(int) data bytes...
//
// CAN FD行 ("CANFD "で始まる) の実フォーマット:
//   1.234500 CANFD   1 Rx 400  1 0 f 64 01 02 03 ... (64バイト) ... 130000 2000000 ...
//   (シンボル名列が入る場合もある: ... CANFD 1 Rx 400 MsgName 1 0 f 64 ...)
// フィールド: timestamp CANFD channel(int) dir(Rx/Tx) id(hex, 拡張IDは末尾"x")
//            [シンボル名 (数字以外の場合のみ)] brs(0/1) esi(0/1) dlc(hex/dec)
//            dataLength(dec, 実データバイト数) data bytes... (以降のビットレート/
//            タイミング情報等の列は無視する)
// このCAN FDフォーマットは公開実装 (python-can の can/io/asc.py) の
// パースロジックを参考にしたbest-effort実装で、実際のCANoeバージョンによる
// 列構成の差異までは検証していません。値がおかしい場合は報告してください。
//
// エラーフレーム・統計行など、上記いずれにも合致しない行はスキップし、
// 件数をwarningsに集約する。base dec/hex はヘッダの "base hex"/"base dec"
// 行から判定する (デフォルトはhex)。
import { CanFrame, ParseResult } from '../models/types';

const DATA_LINE_RE =
  /^\s*([\d.]+)\s+(\d+)\s+([0-9A-Fa-f]+x?)\s+(Rx|Tx)\s+([dr])\s+(\d+)\s+([0-9A-Fa-f ]*)/;
const CANFD_LINE_RE = /^\s*([\d.]+)\s+CANFD\s+(.+)$/i;

/** トークンが純粋な数字のみで構成されているか (BRS/ESIフラグの判定に使う)。 */
function isDigits(token: string | undefined): boolean {
  return token !== undefined && /^\d+$/.test(token);
}

/**
 * CAN FD行 (timestamp + "CANFD" 部分を除いた残り) をパースする。
 * シンボル名列の有無で列がずれるため、BRS位置に来るはずのトークンが数字か
 * どうかで判定する (python-can 同様の手法)。
 */
function parseCanFdRest(tsStr: string, rest: string, base: 'hex' | 'dec'): CanFrame | null {
  const tokens = rest.trim().split(/\s+/);
  let idx = 0;
  const channelStr = tokens[idx++];
  const dirStr = tokens[idx++];
  if (dirStr !== 'Rx' && dirStr !== 'Tx') return null;
  const idStr = tokens[idx++];
  if (!idStr || /^errorframe/i.test(idStr)) return null; // CAN FDエラーフレーム等は未対応

  if (!isDigits(tokens[idx])) idx++; // シンボル名列をスキップ
  idx++; // brs (未使用)
  idx++; // esi (未使用)
  const dlcCodeStr = tokens[idx++]; // DLCコード (0-15)。実バイト数はdataLength側を正とする
  const dataLengthStr = tokens[idx++];
  const dataLength = parseInt(dataLengthStr, 10);
  if (Number.isNaN(dataLength) || dataLength < 0) return null;

  const dataTokens = tokens.slice(idx, idx + dataLength);
  const data = new Uint8Array(dataLength);
  for (let i = 0; i < dataLength && i < dataTokens.length; i++) {
    data[i] = parseInt(dataTokens[i], 16) || 0;
  }

  const extended = idStr.toLowerCase().endsWith('x');
  const idHexOrDec = extended ? idStr.slice(0, -1) : idStr;
  const canId = base === 'hex' ? parseInt(idHexOrDec, 16) : parseInt(idHexOrDec, 10);
  if (Number.isNaN(canId)) return null;

  const channel = parseInt(channelStr, 10);
  const dlcCode = base === 'hex' ? parseInt(dlcCodeStr, 16) : parseInt(dlcCodeStr, 10);

  return {
    timestamp: parseFloat(tsStr),
    canId,
    extended,
    dir: dirStr,
    channel: Number.isNaN(channel) ? 0 : channel,
    dlc: dataLength,
    dlcCode: Number.isNaN(dlcCode) ? dataLength : dlcCode,
    data,
  };
}

export function parseAsc(text: string): ParseResult {
  const frames: CanFrame[] = [];
  let base: 'hex' | 'dec' = 'hex';
  let skipped = 0;
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith('base ')) {
      base = trimmed.includes('dec') ? 'dec' : 'hex';
      continue;
    }
    if (
      trimmed.startsWith('date ') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('internal events') ||
      trimmed.startsWith('timestamps')
    ) {
      continue;
    }

    const fdMatch = CANFD_LINE_RE.exec(line);
    if (fdMatch) {
      const [, tsStr, rest] = fdMatch;
      const frame = parseCanFdRest(tsStr, rest, base);
      if (frame) frames.push(frame);
      else skipped++; // CAN FDエラーフレーム等、未対応の列構成
      continue;
    }

    const m = DATA_LINE_RE.exec(line);
    if (!m) {
      // ErrorFrame / Statistic等、未対応行
      skipped++;
      continue;
    }

    const [, tsStr, channelStr, idStr, dirStr, frameType, dlcStr, dataStr] = m;
    if (frameType === 'r') {
      // リモートフレームはデータ部を持たないため、フレームとしては記録するがdataは空
    }
    const extended = idStr.toLowerCase().endsWith('x');
    const idHexOrDec = extended ? idStr.slice(0, -1) : idStr;
    const canId = base === 'hex' ? parseInt(idHexOrDec, 16) : parseInt(idHexOrDec, 10);
    if (Number.isNaN(canId)) {
      skipped++;
      continue;
    }

    const dlc = parseInt(dlcStr, 10);
    const byteTokens = dataStr.trim().length > 0 ? dataStr.trim().split(/\s+/) : [];
    const data = new Uint8Array(dlc);
    for (let i = 0; i < dlc && i < byteTokens.length; i++) {
      data[i] = parseInt(byteTokens[i], 16) || 0;
    }

    frames.push({
      timestamp: parseFloat(tsStr),
      canId,
      extended,
      dir: dirStr as 'Rx' | 'Tx',
      channel: parseInt(channelStr, 10),
      dlc,
      dlcCode: dlc, // Classic CANのDLCは常に実バイト数と同じ(0-8)
      data,
    });
  }

  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(`${skipped}行はサポート外のフォーマットのためスキップしました（エラーフレーム・統計行など）`);
  }

  return { frames, warnings };
}

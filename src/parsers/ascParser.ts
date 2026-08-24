// Vector ASC (テキスト) ログのパーサー。
//
// 典型的な1行 (Classic CAN, データフレーム):
//   1.234500 1  181             Rx   d 8 01 02 03 04 05 06 07 08
//   1.235100 1  3B012400x       Tx   d 8 04 15 00 01 02 03 FF FF
//
// フィールド: timestamp(float) channel(int) id(hex, 拡張IDは末尾"x") dir(Rx/Tx)
//            frameType(d=データ/r=リモート) dlc(int) data bytes...
//
// CAN FD行 ("CANFD ..." で始まる) やエラーフレーム、統計行など未対応の行は
// スキップし、件数をwarningsに集約する。base dec/hex はヘッダの
// "base hex"/"base dec" 行から判定する (デフォルトはhex)。
import { CanFrame, ParseResult } from '../models/types';

const DATA_LINE_RE =
  /^\s*([\d.]+)\s+(\d+|CANFD)\s+([0-9A-Fa-f]+x?)\s+(Rx|Tx)\s+([dr])\s+(\d+)\s+([0-9A-Fa-f ]*)/;

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

    const m = DATA_LINE_RE.exec(line);
    if (!m) {
      // ErrorFrame / Statistic / CANFD専用フォーマット等、未対応行
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
      channel: channelStr === 'CANFD' ? 0 : parseInt(channelStr, 10),
      dlc,
      data,
    });
  }

  const warnings: string[] = [];
  if (skipped > 0) {
    warnings.push(`${skipped}行はサポート外のフォーマットのためスキップしました（CAN FD詳細・エラーフレーム・統計行など）`);
  }

  return { frames, warnings };
}

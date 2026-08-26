// ワークスペース内 .canlogger/*.json の読み書き。
// 各ファイルは「なければデフォルト値で作成」して常に読み込めるようにする。
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  DEFAULT_LOGGER_CAN_IDS,
  FixedFormatFile,
  LoggerCanIdsFile,
  LoggerMappingsFile,
  LoggerNumber,
  LoggerSpecsFile,
} from '../models/types';

const CANLOGGER_DIR = '.canlogger';

const FILES = {
  loggerSpecs: 'logger-specs.json',
  loggerCanIds: 'logger-can-ids.json',
  loggerMappings: 'logger-mappings.json',
  fixedFormat: 'fixed-format.json',
} as const;

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function canloggerDir(): string | undefined {
  const root = workspaceRoot();
  return root ? path.join(root, CANLOGGER_DIR) : undefined;
}

const NO_WORKSPACE_MESSAGE =
  'ワークスペースフォルダを開いてから実行してください（Logger項目仕様・マッピング等はワークスペース内の .canlogger/ に保存されます）。';

/**
 * ワークスペースが開かれているかを確認する。開かれていなければエラーを表示して
 * false を返す。入力ボックスを出す前など、無駄な入力をさせないよう各コマンドの
 * 冒頭で呼び出すこと。
 */
export function ensureWorkspaceOpen(): boolean {
  if (workspaceRoot()) return true;
  vscode.window.showErrorMessage(NO_WORKSPACE_MESSAGE);
  return false;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function loadJson<T>(filename: string, defaultValue: T): T {
  const dir = canloggerDir();
  if (!dir) return defaultValue;
  const filePath = path.join(dir, filename);
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(text) as T;
  } catch {
    ensureDir(dir);
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
    return defaultValue;
  }
}

function saveJson<T>(filename: string, data: T): void {
  const dir = canloggerDir();
  if (!dir) {
    vscode.window.showErrorMessage(NO_WORKSPACE_MESSAGE);
    return;
  }
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2), 'utf-8');
  changeEmitter.fire(filename);
}

// 保存時に発火し、サイドバーのTreeDataProviderを更新するためのイベント。
export const changeEmitter = new vscode.EventEmitter<string>();
export const onDidChangeStore = changeEmitter.event;

export function loadLoggerSpecs(): LoggerSpecsFile {
  return loadJson(FILES.loggerSpecs, { categories: [], items: [] });
}
export function saveLoggerSpecs(data: LoggerSpecsFile): void {
  saveJson(FILES.loggerSpecs, data);
}

export function loadLoggerCanIds(): LoggerCanIdsFile {
  return loadJson(FILES.loggerCanIds, DEFAULT_LOGGER_CAN_IDS);
}
export function saveLoggerCanIds(data: LoggerCanIdsFile): void {
  saveJson(FILES.loggerCanIds, data);
}

export function loadLoggerMappings(): LoggerMappingsFile {
  const data = loadJson<LoggerMappingsFile>(FILES.loggerMappings, { profiles: [] });
  // Logger 1〜5だった頃に作られたファイルには"6"キーが存在しないため、
  // 読み込み時に空スロットで補う (以後保存すれば6も永続化される)。
  for (const profile of data.profiles) {
    for (let n = 1; n <= 6; n++) {
      if (!profile.slots[n as LoggerNumber]) profile.slots[n as LoggerNumber] = [];
    }
  }
  return data;
}
export function saveLoggerMappings(data: LoggerMappingsFile): void {
  saveJson(FILES.loggerMappings, data);
}

export function loadFixedFormat(): FixedFormatFile {
  return loadJson(FILES.fixedFormat, { entries: [] });
}
export function saveFixedFormat(data: FixedFormatFile): void {
  saveJson(FILES.fixedFormat, data);
}

export function exportToFile(data: unknown, targetPath: string): void {
  fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf-8');
}

export function importFromFile<T>(sourcePath: string): T {
  return JSON.parse(fs.readFileSync(sourcePath, 'utf-8')) as T;
}

/** 最近開いたログファイル (globalState管理、ワークスペース非依存)。 */
const RECENT_LOGS_KEY = 'canLogger.recentLogs';
const MAX_RECENT = 20;

export function getRecentLogs(memento: vscode.Memento): string[] {
  return memento.get<string[]>(RECENT_LOGS_KEY, []);
}

export async function addRecentLog(memento: vscode.Memento, filePath: string): Promise<void> {
  const current = getRecentLogs(memento).filter((p) => p !== filePath);
  current.unshift(filePath);
  await memento.update(RECENT_LOGS_KEY, current.slice(0, MAX_RECENT));
}

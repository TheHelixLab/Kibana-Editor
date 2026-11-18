/**
 * 多请求解析器：把编辑器全文解析为请求块数组
 *
 * 规则（与 Kibana Dev Tools Console 一致）：
 * - 以 HTTP 方法开头的行视为一个请求的头行（起始定界）
 * - 请求体为头行之后到下一个头行之间的内容（尾部空行/注释行不计入）
 * - # 或 // 开头的行视为注释行，跳过
 * - 纯函数 O(n)，每次内容变化全量重算（控制台规模文本量级下开销可忽略）
 */
import type { ConsoleMethod, ParseResult, ParsedConsoleRequest } from "../types";

/** 头行判定：行首（允许缩进）为 HTTP 方法且后跟空白 */
const METHOD_RE = /^\s*(GET|POST|PUT|DELETE|HEAD|PATCH)\s+/i;
/** 注释行判定 */
const COMMENT_RE = /^\s*(#|\/\/)/;
/** 支持的方法集合（用于归一化校验） */
const METHODS = new Set<string>([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "HEAD",
  "PATCH",
]);

/** 归一化方法（大小写），非法值按 GET 兜底 */
function normalizeMethod(raw: string): ConsoleMethod {
  const upper = raw.toUpperCase();
  return (METHODS.has(upper) ? upper : "GET") as ConsoleMethod;
}

/** 解析头行：按首个空白切分 method 与 path；path 剥除行内注释 */
function parseHeadLine(line: string): {
  method: ConsoleMethod;
  path: string;
  pathStartColumn: number;
} {
  const match = line.match(/^\s*(\S+)(\s+([\s\S]*))?$/);
  // METHOD_RE 已保证 match 非空
  const method = normalizeMethod(match![1]);
  const rawPath = (match![3] ?? "").trim();
  // 剥除 path 后的行内注释（// 与 #，要求前面有空白，避免误伤路径本身）
  const path = rawPath.split(/\s+(?:\/\/|#)/)[0].trim();
  // path 起始列 = 方法后第一个空白结束位置（1-based）
  const pathStartColumn = line.length - rawPath.length + 1;
  return { method, path, pathStartColumn: Math.max(pathStartColumn, 1) };
}

/** 判断一行是否为"空行或注释行"（请求块尾部回溯时跳过） */
function isBlankOrComment(line: string): boolean {
  return line.trim() === "" || COMMENT_RE.test(line);
}

/**
 * 全文解析入口
 * @param text 编辑器全文
 */
export function parseRequests(text: string): ParseResult {
  const lines = text.split("\n");

  // 第一遍：收集所有头行索引
  const headLineIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 注释行不作为请求起始（如 "# GET xxx"）
    if (!COMMENT_RE.test(line) && METHOD_RE.test(line)) {
      headLineIndexes.push(i);
    }
  }

  // 第二遍：按头行切分请求块
  const requests: ParsedConsoleRequest[] = [];
  const methodLines: ParseResult["methodLines"] = [];
  for (let k = 0; k < headLineIndexes.length; k++) {
    const start = headLineIndexes[k];
    const { method, path, pathStartColumn } = parseHeadLine(lines[start]);
    methodLines.push({ line: start + 1, method, pathStartColumn });

    // 请求块结束行 = 下一头行（或文末）向前回溯，跳过尾部空行/注释行
    const nextStart = headLineIndexes[k + 1] ?? lines.length;
    let end = nextStart - 1;
    while (end > start && isBlankOrComment(lines[end])) {
      end--;
    }

    const body = lines.slice(start + 1, end + 1).join("\n").trim();
    requests.push({
      method,
      path,
      body,
      startLine: start + 1,
      endLine: end + 1,
    });
  }

  return { requests, methodLines };
}

/**
 * 定位行号所在的请求块（Ctrl+Enter 用）
 * - 光标落在请求内（含头行）→ 该请求
 * - 光标落在两请求之间的空隙 → 上方最近的一个请求
 * - 光标在所有请求之前 → null
 */
export function findRequestAt(
  requests: ParsedConsoleRequest[],
  lineNumber: number,
): ParsedConsoleRequest | null {
  let candidate: ParsedConsoleRequest | null = null;
  for (const request of requests) {
    if (lineNumber >= request.startLine && lineNumber <= request.endLine) {
      return request;
    }
    if (lineNumber > request.endLine) {
      candidate = request;
    }
  }
  return candidate;
}

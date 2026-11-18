/**
 * 请求头行补全（`METHOD path` 格式）
 *
 * 分三种场景：
 * - 方法段（光标前无空格）：6 个 HTTP 方法建议
 * - 路径段以 `_` 开头：常用 ES 端点静态表
 * - 路径段其余情况：索引 / 别名 / 模板建议（来自轮询快照）
 *
 * 同时服务于两种调用时机：请求头行内补全、无请求的空隙处输入新请求
 */
import * as monaco from "monaco-editor";
import type { AutocompleteSnapshot } from "../types";

/** 支持的 HTTP 方法（与 parser 保持一致） */
export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "HEAD",
  "PATCH",
] as const;

/** 常用 ES 端点（`_` 开头的路径段静态表） */
const ES_ENDPOINTS = [
  "_search",
  "_count",
  "_bulk",
  "_mget",
  "_msearch",
  "_doc",
  "_create",
  "_update",
  "_analyze",
  "_scroll",
  "_mapping",
  "_aliases",
  "_settings",
  "_template",
  "_source",
  "_cat",
] as const;

/** 实体建议单类上限（真实集群索引可能数千，防建议列表爆炸） */
const MAX_ENTITY_SUGGESTIONS = 100;

/** 方法段建议：替换已输入的方法前缀，insertText 自带尾随空格 */
function buildMethodSuggestions(
  range: monaco.IRange,
  typedPrefix: string,
): monaco.languages.CompletionItem[] {
  const typed = typedPrefix.trim().toUpperCase();
  return HTTP_METHODS.filter((method) => method.startsWith(typed)).map(
    (method) => ({
      label: method,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: `${method} `,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.None,
      detail: "方法",
      sortText: `0${method}`,
      range,
    }),
  );
}

/** 路径段建议（索引/别名/模板 或 ES 端点），range 覆盖当前段 */
function buildPathSuggestions(
  snapshot: AutocompleteSnapshot,
  range: monaco.IRange,
  typed: string,
): monaco.languages.CompletionItem[] {
  // `_` 开头的段 → ES 端点静态表
  if (typed.startsWith("_")) {
    const lower = typed.toLowerCase();
    return ES_ENDPOINTS.filter((endpoint) => endpoint.startsWith(lower)).map(
      (endpoint) => ({
        label: endpoint,
        kind: monaco.languages.CompletionItemKind.Function,
        insertText: endpoint,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.None,
        detail: "ES 端点",
        range,
      }),
    );
  }

  // 其余 → 实体建议（索引 ∪ 别名 ∪ 模板），按已输入内容过滤
  const lower = typed.toLowerCase();
  const contains = (name: string) => name.toLowerCase().includes(lower);

  const indexItems: monaco.languages.CompletionItem[] = snapshot.indices
    .filter(contains)
    .slice(0, MAX_ENTITY_SUGGESTIONS)
    .map((name) => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Value,
      insertText: name,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.None,
      detail: "索引",
      sortText: `1${name}`,
      range,
    }));

  const aliasItems: monaco.languages.CompletionItem[] = snapshot.aliases
    .filter(contains)
    .slice(0, MAX_ENTITY_SUGGESTIONS)
    .map((name) => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Value,
      insertText: name,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.None,
      detail: "别名",
      sortText: `2${name}`,
      range,
    }));

  const templateItems: monaco.languages.CompletionItem[] = snapshot.templates
    .filter(contains)
    .slice(0, MAX_ENTITY_SUGGESTIONS)
    .map((name) => ({
      label: name,
      kind: monaco.languages.CompletionItemKind.Value,
      insertText: name,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.None,
      detail: "模板",
      sortText: `3${name}`,
      range,
    }));

  return [...indexItems, ...aliasItems, ...templateItems];
}

/**
 * 请求头行补全入口
 *
 * 依据「光标前是否存在空白」区分方法段与路径段：
 * - 方法段：替换范围为行首到首个空白（或行尾），建议 6 个方法
 * - 路径段：替换范围为当前段（`/` 分隔），`_` 开头给端点表，其余给实体建议
 */
export function provideRequestLineSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  snapshot: AutocompleteSnapshot,
): monaco.languages.CompletionItem[] {
  const line = model.getLineContent(position.lineNumber);
  const beforeCursor = line.substring(0, position.column - 1);
  const firstSpaceInLine = line.search(/\s/);

  // ---- 方法段：光标前无空白，正在输入方法名 ----
  if (!/\s/.test(beforeCursor)) {
    const methodEndCol =
      firstSpaceInLine === -1 ? line.length + 1 : firstSpaceInLine + 1;
    const range: monaco.IRange = {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: 1,
      endColumn: methodEndCol,
    };
    return buildMethodSuggestions(range, beforeCursor);
  }

  // ---- 路径段：定位当前段（`/` 分隔）的替换范围 ----
  const pathStartIdx = firstSpaceInLine + 1;
  const beforeInPath = beforeCursor.substring(pathStartIdx);
  const segStartIdx = beforeInPath.lastIndexOf("/") + 1;
  // 段起始列（1-based）
  const segStartCol = pathStartIdx + segStartIdx + 1;
  // 段结束列：从段首向后找下一个分隔符（空白 / `?`）；到行尾则取行长 + 1
  const rest = line.substring(pathStartIdx + segStartIdx);
  const segEndOffset = rest.search(/[\s?]/);
  const segEndCol =
    segEndOffset === -1 ? line.length + 1 : pathStartIdx + segStartIdx + segEndOffset + 1;

  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: segStartCol,
    endColumn: segEndCol,
  };
  // 已输入内容剥掉 `?` 及之后的 query 部分（如 `_aliases?pretty=false` 只按 `_aliases` 过滤）
  const typed = beforeInPath.substring(segStartIdx).split("?")[0];

  return buildPathSuggestions(snapshot, range, typed);
}

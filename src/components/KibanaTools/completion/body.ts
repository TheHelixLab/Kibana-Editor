/**
 * 请求 body 区域补全
 *
 * - API 结构补全：来自本地打包的 api_server.json（ES API schema），与 demo 同源
 * - 字段补全：来自轮询快照 snapshot.getFields（随 _mapping/_aliases/_template 动态刷新）
 * - 引号内键值对替换逻辑（空引号/有值引号/冒号三分支）与 demo 行为一致
 */
import * as monaco from "monaco-editor";
import apiServerJson from "./assets/api_server.json";
import type { AutocompleteSnapshot, FieldInfo } from "../types";

/** ES API schema 结构巨大，与 demo 一致按 any 使用 */
const apiJson: any = apiServerJson;

/** 补全项中间结构（kind 存 monaco 枚举值，最终统一转为 CompletionItem） */
interface RawSuggestion {
  label: string;
  insertText: string;
  kind: monaco.languages.CompletionItemKind;
  insertTextRules: monaco.languages.CompletionItemInsertTextRule;
  detail: string;
}

/** 字段建议：插入 `"path": {...}` 键值对片段 */
function buildFieldSuggestions(fields: FieldInfo[]): RawSuggestion[] {
  return fields.map((field) => ({
    label: field.path,
    insertText: `"${field.path}": {$1}`,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail: field.type,
    kind: monaco.languages.CompletionItemKind.Field,
  }));
}

/** API 一级建议（globals 顶层键，跳过 __ 前缀的元数据键） */
function buildGlobalFirstLevelSuggestions(): RawSuggestion[] {
  const suggestions: RawSuggestion[] = [];
  const globals = apiJson.es.globals;
  for (const key of Object.keys(globals)) {
    if (key.startsWith("__")) continue;
    suggestions.push({
      label: key,
      kind: monaco.languages.CompletionItemKind.Module,
      insertText: `"${key}": {\n  $1\n}`,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "API",
    });
  }
  return suggestions;
}

/**
 * API 嵌套建议：按路径栈逐层下钻
 * - 支持同级 `*` 通配层（任意键均可命中）
 * - 支持 `{placeholder}` 占位层（如索引名占位）
 * - `__template` 元数据转为整段 JSON 模板插入
 */
function buildNestedSuggestions(keys: string[]): RawSuggestion[] {
  const suggestions: RawSuggestion[] = [];
  const globals = apiJson.es.globals;
  let currentObj: any = globals;

  for (const key of keys) {
    if (currentObj[key]) {
      currentObj = currentObj[key];
    } else if (currentObj["*"] && currentObj["*"][key]) {
      currentObj = currentObj["*"][key];
    } else {
      const placeholderKey = Object.keys(currentObj).find(
        (k) => k.startsWith("{") && k.endsWith("}"),
      );
      if (placeholderKey) {
        currentObj = currentObj[placeholderKey];
      } else {
        return suggestions;
      }
    }
  }

  if (currentObj["*"]) currentObj = currentObj["*"];

  for (const key of Object.keys(currentObj)) {
    if (key.startsWith("__")) continue;
    const value = currentObj[key];
    const template = value?.["__template"];

    let insertText: string;
    if (template) {
      insertText = `"${key}": ${JSON.stringify(template, null, 2)}`;
    } else if (
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 0
    ) {
      insertText = `"${key}": {}`;
    } else if (
      typeof value === "number" ||
      typeof value === "string" ||
      typeof value === "boolean"
    ) {
      insertText = `"${key}": ${JSON.stringify(value)}`;
    } else if (typeof value === "object" && value !== null) {
      insertText = `"${key}": {\n  $1\n}`;
    } else {
      insertText = `"${key}": $1`;
    }

    suggestions.push({
      label: key,
      kind: monaco.languages.CompletionItemKind.Property,
      insertText,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: template ? "API (模板)" : "API",
    });
  }
  return suggestions;
}

/** 向前找下一个非空白字符的下标（找不到返回入参 start） */
function findNextNonWhitespace(text: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    if (/\S/.test(text[i])) return i;
  }
  return start;
}

/**
 * 扫描光标处的 JSON 路径栈
 *
 * 与 demo 版本的差异：扫描起点 startLine 参数化（从当前请求 body 首行开始，
 * 而非 demo 硬编码的第 2 行），保证多请求场景下路径栈互不串扰。
 * 支持同级任意多个属性都能拿到正确的父路径（demo 核心逻辑原样保留）。
 */
function getCurrentPathAtPosition(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  startLine: number,
): string[] {
  const text = model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  const path: string[] = [];
  let braceCount = 0;
  let lastKey = "";
  let inString = false;
  let isKey = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // 处理引号（支持 key 识别，跳过转义引号）
    if (char === '"' && (i === 0 || text[i - 1] !== "\\")) {
      inString = !inString;
      if (inString) {
        lastKey = "";
        isKey = true;
      } else if (isKey) {
        // 字符串结束 → 检查后面是否紧跟冒号（即是否为 key）
        const nextNonSpace = findNextNonWhitespace(text, i + 1);
        if (text[nextNonSpace] === ":") {
          // 是 key：深一层则入栈，同级则替换栈顶
          if (braceCount > path.length) {
            path.push(lastKey);
          } else if (path.length > 0) {
            path[path.length - 1] = lastKey;
          }
        }
        isKey = false;
      }
      continue;
    }

    if (inString) {
      lastKey += char;
      continue;
    }

    // 对象边界与同级逗号处理
    if (char === "{") {
      braceCount++;
    } else if (char === "}") {
      braceCount--;
      if (path.length > braceCount) path.pop();
    } else if (char === ",") {
      // 遇到逗号表示要输入新的同级属性 → 弹出上一个 key
      if (path.length > 0 && path.length === braceCount) {
        path.pop();
      }
    }
  }

  return path;
}

/** body 补全入参 */
export interface BodyCompletionInput {
  model: monaco.editor.ITextModel;
  position: monaco.Position;
  /** 轮询快照（动态字段来源） */
  snapshot: AutocompleteSnapshot;
  /** 请求 path 的索引段（首段，支持通配/别名/逗号）；无索引端点传空串 */
  indexToken: string;
  /** 当前请求 body 起始行号（头行 + 1），路径栈从这里开始扫描 */
  startLine: number;
}

/**
 * body 区域补全入口：API 结构建议 + 动态字段建议 + 引号内键值替换
 * 返回可直接交给 monaco 的 CompletionItem 列表
 */
export function provideBodySuggestions(
  input: BodyCompletionInput,
): monaco.languages.CompletionItem[] {
  const { model, position, snapshot, indexToken, startLine } = input;

  // ---- 1. 按路径栈收集 API 结构建议 ----
  const pathStack = getCurrentPathAtPosition(model, position, startLine);
  const rawList: RawSuggestion[] = [];
  if (pathStack.length === 0) {
    rawList.push(...buildGlobalFirstLevelSuggestions());
  } else {
    rawList.push(...buildNestedSuggestions(pathStack));
  }

  // ---- 2. 字段上下文：行内含 "field" 或路径栈尾是字段参数容器 ----
  const lineContent = model.getLineContent(position.lineNumber);
  const isFieldContext =
    lineContent.includes('"field"') ||
    (pathStack.length > 0 &&
      ["terms", "range", "exists", "missing", "term"].includes(
        pathStack[pathStack.length - 1],
      ));
  if (isFieldContext) {
    rawList.push(...buildFieldSuggestions(snapshot.getFields(indexToken)));
  }

  // ---- 3. 引号 / 替换范围处理，输出最终建议 ----
  return finalizeSuggestions(model, position, rawList);
}

/**
 * 引号内键值对替换处理（demo index.tsx provider 的核心逻辑原样迁移）
 *
 * 三种场景：
 * - 光标在空引号内：替换为完整键值对（去掉建议自带的左引号，吃到右引号）
 * - 光标在含值引号内：只替换键名
 * - 引号后有冒号（已有值）：只替换键名；否则替换整个引号内容为键值对
 */
function finalizeSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  list: RawSuggestion[],
): monaco.languages.CompletionItem[] {
  const lineContent = model.getLineContent(position.lineNumber);
  const textBeforeCursor = lineContent.substring(0, position.column - 1);
  // 光标前引号数为奇数 → 光标在双引号内
  const inQuotes = (textBeforeCursor.match(/"/g) || []).length % 2 === 1;
  // 空引号：左引号紧贴光标
  const isEmptyQuotes = inQuotes && textBeforeCursor.endsWith('"');

  // 当前引号内光标之后是否还有非空内容
  let hasValueInQuotes = false;
  if (inQuotes) {
    const textAfterCursor = lineContent.substring(position.column - 1);
    const nextQuoteIndex = textAfterCursor.indexOf('"');
    if (nextQuoteIndex > 0) {
      hasValueInQuotes =
        textAfterCursor.substring(0, nextQuoteIndex).trim().length > 0;
    }
  }

  // 默认替换范围为光标处单词
  const word = model.getWordUntilPosition(position);
  let range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
  // 引号内且非空引号：替换范围扩展到右引号之前
  if (inQuotes && !isEmptyQuotes) {
    const textAfterCursor = lineContent.substring(position.column - 1);
    const nextQuoteIndex = textAfterCursor.indexOf('"');
    if (nextQuoteIndex !== -1) {
      range = {
        ...range,
        endColumn: position.column + nextQuoteIndex,
      };
    }
  }

  // 按已输入关键词过滤
  const keyword = word.word || "";
  const filteredList = keyword
    ? list.filter((item) =>
        item.label.toLowerCase().includes(keyword.toLowerCase()),
      )
    : list;

  // 当前行是否已含冒号 / 花括号（裸光标场景决定是否补全键值对）
  const hasColon = lineContent.includes(":");
  const hasBraces = lineContent.includes("{") || lineContent.includes("}");

  return filteredList.map((item) => {
    let insertText = item.insertText;
    const rangeForItem = { ...range };
    const isFieldSuggestion = item.kind === monaco.languages.CompletionItemKind.Field;
    const isPropertySuggestion =
      item.kind === monaco.languages.CompletionItemKind.Property;
    const isModuleSuggestion =
      item.kind === monaco.languages.CompletionItemKind.Module;

    if (inQuotes && (isFieldSuggestion || isPropertySuggestion || isModuleSuggestion)) {
      const textAfterCursor = lineContent.substring(position.column - 1);

      if (isEmptyQuotes) {
        // 空引号内：去左引号，替换范围吃到右引号
        insertText = item.insertText.substring(1);
        rangeForItem.startColumn = position.column;
        const nextQuoteIndex = textAfterCursor.indexOf('"');
        if (nextQuoteIndex !== -1) {
          rangeForItem.endColumn = position.column + nextQuoteIndex + 1;
        }
      } else if (hasValueInQuotes) {
        // 引号内已有值：只替换键名
        insertText = item.label;
      } else {
        // 默认：引号后已有冒号则只换键名，否则替换引号内容为键值对
        const nextQuoteIndex = textAfterCursor.indexOf('"');
        const hasColonAfterQuote =
          nextQuoteIndex !== -1 &&
          textAfterCursor.indexOf(":", nextQuoteIndex) !== -1;
        if (hasColonAfterQuote) {
          insertText = item.label;
        } else {
          insertText = item.insertText.substring(1);
          rangeForItem.startColumn = position.column;
          if (nextQuoteIndex !== -1) {
            rangeForItem.endColumn = position.column + nextQuoteIndex + 1;
          }
        }
      }
    } else if (
      !inQuotes &&
      isFieldSuggestion &&
      (!hasColon || !hasBraces)
    ) {
      // 裸光标处的字段建议：补全完整键值对
      insertText = `"${item.label}": {$1}`;
    }

    return {
      label: item.label,
      kind: item.kind,
      insertText,
      insertTextRules: item.insertTextRules,
      detail: item.detail,
      range: rangeForItem,
    };
  });
}

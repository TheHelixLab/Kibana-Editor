import * as monaco from "monaco-editor";

export function getIndexFromFirstLine(firstLine: string) {
  let match = firstLine.match(/alias_[^/\s]+/);
  if (match) {
    return match[0].replace("alias_", "index_");
  }
  match = firstLine.match(/index_[^/\s]+/);
  if (match) {
    return match[0];
  }
  match = firstLine.match(/\s+(\w+)/);
  if (match) {
    return `index_${match[1]}`;
  }
  return null;
}

export interface FieldInfo {
  path: string;
  type: string;
}

export function flattenFields(properties: any, parent = ""): FieldInfo[] {
  const fields: FieldInfo[] = [];
  Object.entries(properties || {}).forEach(([key, value]: any) => {
    const path = parent ? `${parent}.${key}` : key;
    if (value.properties) {
      fields.push(...flattenFields(value.properties, path));
    } else {
      fields.push({ path, type: value.type || "unknown" });
    }
  });
  return fields;
}

export function buildFieldSuggestions(fields: FieldInfo[]) {
  return fields.map((field) => ({
    label: field.path,
    insertText: `"${field.path}": {$1}`,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    detail: field.type,
    kind: monaco.languages.CompletionItemKind.Field,
  }));
}

export function buildGlobalFirstLevelSuggestions(apiJson: any) {
  const suggestions: any[] = [];
  const globals = apiJson.es.globals;
  Object.keys(globals).forEach((key) => {
    if (key.startsWith("__")) return;
    suggestions.push({
      label: key,
      kind: monaco.languages.CompletionItemKind.Module,
      insertText: `"${key}": {\n  $1\n}`,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: "API",
    });
  });
  return suggestions;
}

export function buildGlobalSecondLevelSuggestions(
  apiJson: any,
  parentKey: string,
) {
  const suggestions: any[] = [];
  const globals = apiJson.es.globals;
  const parentObj = globals[parentKey];
  if (!parentObj) return suggestions;
  const starObj = parentObj["*"];
  if (!starObj) return suggestions;

  Object.keys(starObj).forEach((key) => {
    if (key.startsWith("__")) return;
    const item = starObj[key];
    const template = item?.["__template"];
    const insertText = template
      ? `"${key}": ${JSON.stringify(template, null, 2)}`
      : `"${key}": {\n  $1\n}`;
    suggestions.push({
      label: key,
      kind: monaco.languages.CompletionItemKind.Property,
      insertText,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      detail: template ? "API (with template)" : "API",
    });
  });
  return suggestions;
}

/**
 * 【核心修复】获取光标当前位置的真实路径栈
 * 支持同级任意多个属性都能拿到正确的父路径
 */
export function getCurrentPathAtPosition(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): string[] {
  const text = model.getValueInRange({
    startLineNumber: 2,
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

    // 处理引号（支持 key 识别）
    if (char === '"' && (i === 0 || text[i - 1] !== "\\")) {
      inString = !inString;
      if (inString) {
        lastKey = "";
        isKey = true;
      } else if (isKey) {
        // 字符串结束 → 检查后面是否紧跟冒号（即是否为 key）
        const nextNonSpace = findNextNonWhitespace(text, i + 1);
        if (text[nextNonSpace] === ":") {
          // 是 key
          if (braceCount > path.length) {
            path.push(lastKey);
          } else {
            // 同级 key：替换最后一个（关键！）
            if (path.length > 0) path[path.length - 1] = lastKey;
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

    // 对象边界 & 同级逗号处理
    if (char === "{") {
      braceCount++;
    } else if (char === "}") {
      braceCount--;
      if (path.length > braceCount) path.pop();
    } else if (char === ",") {
      // 关键修复：遇到逗号表示要输入新的同级属性 → 弹出上一个 key
      if (path.length > 0 && path.length === braceCount) {
        path.pop();
      }
    }
  }

  return path;
}

function findNextNonWhitespace(text: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    if (/\S/.test(text[i])) return i;
  }
  return start;
}

export function buildNestedSuggestions(apiJson: any, keys: string[]): any[] {
  const suggestions: any[] = [];
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

  Object.keys(currentObj).forEach((key) => {
    if (key.startsWith("__")) return;
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
      detail: "API",
    });
  });
  return suggestions;
}

export function createSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  apiJson: any,
  mappingJson: any,
  firstLine: string,
) {
  const pathToUse = getCurrentPathAtPosition(model, position);
  const suggestions: any[] = [];

  // 第一层全局建议
  if (pathToUse.length === 0) {
    suggestions.push(...buildGlobalFirstLevelSuggestions(apiJson));
  }

  // 嵌套建议（同级任意属性均可触发）
  if (pathToUse.length > 0) {
    const nestedSuggestions = buildNestedSuggestions(apiJson, pathToUse);
    suggestions.push(...nestedSuggestions);
  }

  // Field 字段提示（保持原有逻辑）
  const lineContent = model.getLineContent(position.lineNumber);
  const isFieldContext =
    lineContent.includes('"field"') ||
    (pathToUse.length > 0 &&
      ["terms", "range", "exists", "missing", "term"].includes(
        pathToUse[pathToUse.length - 1],
      ));

  if (isFieldContext) {
    const index = getIndexFromFirstLine(firstLine);
    if (index && mappingJson[index]) {
      const properties = mappingJson[index].mappings?.properties;
      if (properties) {
        const fields = flattenFields(properties);
        suggestions.push(...buildFieldSuggestions(fields));
      }
    }
  }

  return suggestions;
}

// 兼容旧接口
const fieldCache = new Map();
export function createESSuggestions(firstLine: string, mappingJson: any) {
  const index = getIndexFromFirstLine(firstLine);
  if (!index) return [];
  if (fieldCache.has(index)) return fieldCache.get(index);
  const mapping = mappingJson[index];
  if (!mapping) return [];
  const properties = mapping.mappings?.properties;
  if (!properties) return [];
  const fields = flattenFields(properties);
  const suggestions = buildFieldSuggestions(fields);
  fieldCache.set(index, suggestions);
  return suggestions;
}

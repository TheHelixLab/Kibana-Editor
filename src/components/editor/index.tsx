import React, { useEffect, useRef } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import "./index.css";
// 主题配置
import themeConfig from "./theme";
// 属性索引
import mappingJson from "./mapping.json";
// API 索引
import apiJson from "./api_server.json";
// 建议项
import { createSuggestions } from "./esSuggestion";

self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") return new jsonWorker();
    if (["css", "scss", "less"].includes(label)) return new cssWorker();
    if (["html", "handlebars", "razor"].includes(label))
      return new htmlWorker();
    if (["typescript", "javascript"].includes(label)) return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

/* ---------------- mock suggestions ---------------- */

type SuggestionItem = {
  label: string;
  insertText: string;
  kind: keyof typeof monaco.languages.CompletionItemKind;
  detail: string;
};

type CustomMonacoEditorProps = {
  initialFirstLine?: string;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  value?: string;
  SUGGESTIONS?: SuggestionItem[];
  onEmitRef?: (ref: monaco.editor.IStandaloneCodeEditor) => void;
  height?: string | number;
  language?: string;
  handleChange?: (
    value: string | undefined,
    ev: monaco.editor.IModelContentChangedEvent,
  ) => void;
  defaultQuery?: string;
};

const defaultOptions = {
  renderLineHighlight: "none" as const,
  scrollBeyondLastLine: false,
  wordBasedSuggestions: false,
  wordWrap: "on" as const,
  wrappingIndent: "indent" as const,
  matchBrackets: "never" as const,
  contextmenu: false,
  minimap: { enabled: false },
  fontFamily: "Roboto Mono",
  fontSize: 16,
  lineHeight: 24,
  fixedOverflowWidgets: true,
  theme: "sql-theme",
  renderValidationDecorations: "off" as const,
  quickSuggestions: {
    other: true,
    comments: false,
    strings: true,
  },
  suggestOnTriggerCharacters: true,
};

let decorations: string[] = [];

const methodClassMap: Record<string, string> = {
  GET: "http-get",
  POST: "http-post",
  PUT: "http-put",
  DELETE: "http-delete",
  PATCH: "http-patch",
  HEAD: "http-head",
  OPTIONS: "http-options",
};

/* ---------------- component ---------------- */

const CustomMonacoEditor = ({
  initialFirstLine = "// 固定不可修改的第一行",
  options = {},
  value = "",
  onEmitRef,
  height = "84vh",
  language = "json",
  defaultQuery = "",
  handleChange = () => {},
}: CustomMonacoEditorProps) => {
  // 处理内容变化，只返回从第二行开始的内容
  const handleEditorChange = (
    value: string | undefined,
    ev: monaco.editor.IModelContentChangedEvent,
  ) => {
    if (value) {
      // 分割内容，从第二行开始获取
      const lines = value.split("\n");
      const contentFromSecondLine = lines.slice(1).join("\n");
      handleChange(contentFromSecondLine, ev);
    } else {
      handleChange(value, ev);
    }
  };
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const handleEditorDidMount = (
    editor: monaco.editor.IStandaloneCodeEditor,
    monacoInstance: typeof monaco,
  ) => {
    editorRef.current = editor;
    const model = editor.getModel();

    // 外部 ref 赋值
    onEmitRef?.(editor);

    // 在编辑器挂载后再次设置主题
    monacoInstance.editor.setTheme("sql-theme");

    /* ---------------- completion provider ---------------- */

    const createProvider = (
      monacoInstance: typeof monaco,
    ): monaco.languages.CompletionItemProvider => ({
      triggerCharacters: ['"', " ", ".", ":", "{", ","],
      // 启用自动触发补全
      // autoFocus: true,

      async provideCompletionItems(model, position) {
        if (position.lineNumber === 1) {
          return { suggestions: [] };
        }

        const firstLine = model?.getLineContent(1) || "";

        // 使用新的 createSuggestions 函数，根据上下文提供建议
        const list = createSuggestions(
          model,
          position,
          apiJson,
          mappingJson,
          firstLine,
        );

        // 获取当前行的内容
        const lineContent = model.getLineContent(position.lineNumber);
        // 判断光标是否在双引号内
        const textBeforeCursor = lineContent.substring(0, position.column - 1);
        const inQuotes = (textBeforeCursor.match(/"/g) || []).length % 2 === 1;

        // 检查光标是否紧跟在左引号后面（即空引号内）
        const isEmptyQuotes = inQuotes && textBeforeCursor.endsWith('"');

        // 检查当前引号内是否有值（即是否有非空格字符）
        let hasValueInQuotes = false;
        if (inQuotes) {
          const textAfterCursor = lineContent.substring(position.column - 1);
          const nextQuoteIndex = textAfterCursor.indexOf('"');
          if (nextQuoteIndex > 0) {
            // 引号内的内容（不包括引号本身）
            const quoteContent = textAfterCursor.substring(0, nextQuoteIndex);
            hasValueInQuotes = quoteContent.trim().length > 0;
          }
        }

        // 获取当前单词的范围
        const word = model.getWordUntilPosition(position);
        let range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // 如果光标在引号内，扩展替换范围到结尾的引号
        if (inQuotes && !isEmptyQuotes) {
          const textAfterCursor = lineContent.substring(position.column - 1);
          const nextQuoteIndex = textAfterCursor.indexOf('"');
          if (nextQuoteIndex !== -1) {
            range.endColumn = position.column + nextQuoteIndex;
          }
        }

        // 根据输入关键词过滤
        const keyword = word.word || "";
        const filteredList = keyword
          ? list.filter((item) =>
              item.label.toLowerCase().includes(keyword.toLowerCase()),
            )
          : list;

        // 判断当前行是否已经包含了冒号和值
        const hasColon = lineContent.includes(":");
        const hasBraces =
          lineContent.includes("{") || lineContent.includes("}");

        const suggestions = filteredList.map((item) => {
          // 默认使用原始的 insertText
          let insertText = item.insertText;
          const insertTextRules = item.insertTextRules;

          // 判断建议类型
          const isFieldSuggestion =
            item.kind === monacoInstance.languages.CompletionItemKind.Field;
          const isPropertySuggestion =
            item.kind === monacoInstance.languages.CompletionItemKind.Property;
          const isModuleSuggestion =
            item.kind === monacoInstance.languages.CompletionItemKind.Module;

          // 如果光标在引号内，说明用户在输入键名
          if (inQuotes) {
            // 对于字段类型、属性类型或模块类型
            if (
              isFieldSuggestion ||
              isPropertySuggestion ||
              isModuleSuggestion
            ) {
              // 获取光标后的文本
              const textAfterCursor = lineContent.substring(
                position.column - 1,
              );

              // 情况1: 空引号内补全 - 直接替换为空键值对
              if (isEmptyQuotes) {
                // 直接在当前光标位置插入键值对，不包含多余的引号
                insertText = item.insertText.substring(
                  1,
                  item.insertText.length,
                );
                // 从当前光标位置开始替换（不包括左引号）
                range.startColumn = position.column;
                // 替换到右引号位置（如果有右引号）
                const nextQuoteIndex = textAfterCursor.indexOf('"');
                if (nextQuoteIndex !== -1) {
                  range.endColumn = position.column + nextQuoteIndex + 1; // +1 包含右引号
                }
              }
              // 情况2: 有值的引号内补全 - 只替换键名
              else if (hasValueInQuotes) {
                insertText = item.label;
              }
              // 情况3: 默认情况，替换整个引号内容为键值对
              else {
                // 查找下一个双引号的位置
                const nextQuoteIndex = textAfterCursor.indexOf('"');
                // 检查双引号后是否有冒号（即是否已有值）
                const hasColonAfterQuote =
                  nextQuoteIndex !== -1 &&
                  textAfterCursor.indexOf(":", nextQuoteIndex) !== -1;

                if (hasColonAfterQuote) {
                  // 已有值，只替换键名
                  insertText = item.label;
                } else {
                  // 没有值，替换整个引号内容为键值对
                  insertText = item.insertText.substring(
                    1,
                    item.insertText.length,
                  );
                  // 从当前光标位置开始替换
                  range.startColumn = position.column;
                  // 替换到右引号位置
                  if (nextQuoteIndex !== -1) {
                    range.endColumn = position.column + nextQuoteIndex + 1; // +1 包含右引号
                  }
                }
              }
            }
          } else {
            // 光标不在双引号内，可能是在输入键值
            // 对于字段类型，如果没有冒号和花括号，补全完整的键值对
            if (isFieldSuggestion && (!hasColon || !hasBraces)) {
              insertText = `"${item.label}": {$1}`;
            }
            // 对于属性类型或模块类型，保留原有的 insertText
            else if (isPropertySuggestion || isModuleSuggestion) {
              // 保留原有的 insertText（已经包含了正确的格式）
              // 不需要额外处理
            }
          }

          return {
            label: item.label,
            kind:
              typeof item.kind === "string"
                ? (monacoInstance.languages.CompletionItemKind[item.kind] ??
                  monaco.languages.CompletionItemKind.Text)
                : item.kind,
            insertText,
            insertTextRules,
            detail: item.detail,
            range,
          };
        });

        return { suggestions };
      },
    });

    /* 限制全选范围（不包含第一行）和阻止复制 */
    editor.onKeyDown((e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.keyCode === monacoInstance.KeyCode.KeyA) {
          e.preventDefault();
          e.stopPropagation();
          const lineCount = model.getLineCount();
          editor.setSelection({
            startLineNumber: options.readOnly ? 1 : 2,
            startColumn: 1,
            endLineNumber: lineCount,
            endColumn: model.getLineMaxColumn(lineCount),
          });
        } else if (e.keyCode === monacoInstance.KeyCode.KeyC) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });

    if (options.readOnly) {
      return;
    }

    editor.setValue(`${initialFirstLine}\n${defaultQuery || value}`);
    editor.setPosition({ lineNumber: 2, column: 1 });

    /* 禁止修改第一行 */
    editor.onDidChangeModelContent((event) => {
      for (const change of event.changes) {
        if (change.range.startLineNumber === 1) {
          model.applyEdits([
            {
              range: change.range,
              text: "",
            },
          ]);

          editor.setPosition({
            lineNumber: 2,
            column: 1,
          });
        }
      }
    });

    /* 禁止光标进入第一行 */
    editor.onDidChangeCursorPosition((e) => {
      if (e.position.lineNumber === 1) {
        editor.setPosition({
          lineNumber: 2,
          column: 1,
        });
      }
    });

    /* Backspace 控制 */
    editor.onKeyDown((e) => {
      if (e.keyCode === monacoInstance.KeyCode.Backspace) {
        const selection = editor.getSelection();
        // 只有当没有选中内容且光标在第2行第1列时才阻止删除
        if (
          !selection?.isEmpty() ||
          !(selection?.startLineNumber === 2 && selection?.startColumn === 1)
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      }
    });

    /* Delete 控制 */
    editor.onKeyDown((e) => {
      if (e.keyCode === monacoInstance.KeyCode.Delete) {
        const position = editor.getPosition();
        if (position?.lineNumber === 1) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    });

    /* 注册自动提示 */
    monacoInstance.languages.registerCompletionItemProvider(
      language,
      createProvider(monacoInstance),
    );

    const updateFirstLineHighlight = () => {
      const model = editor.getModel();
      if (!model) return;

      const firstLine = model.getLineContent(1);
      const methodMatch = firstLine.match(
        /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/,
      );

      if (!methodMatch) return;
      const method = methodMatch[0].toUpperCase();
      const methodClassName = methodClassMap[method];
      const methodEndColumn = methodMatch[0].length + 1;

      const decorationsToApply = [
        {
          range: new monacoInstance.Range(1, 1, 1, methodEndColumn),
          options: {
            inlineClassName: methodClassName,
          },
        },
      ];

      // 匹配表名（HTTP 方法后的第一个单词）
      const tableMatch = firstLine.match(/\s+(\w+)/);

      if (tableMatch) {
        // 计算表名的起始列（跳过前面的空格）
        const tableNameStartColumn =
          (tableMatch.index || 0) +
          (tableMatch[0].length - tableMatch[1].length) +
          1;
        // 计算表名的结束列（包含最后一个字符）
        const tableNameEndColumn = firstLine.length + 1;
        decorationsToApply.push({
          range: new monacoInstance.Range(
            1,
            tableNameStartColumn,
            1,
            tableNameEndColumn,
          ),
          options: {
            inlineClassName: "table-name",
          },
        });
      }

      decorations = editor.deltaDecorations(decorations, decorationsToApply);
    };

    updateFirstLineHighlight();
  };

  const handleEditorWillMount = (monacoInstance: typeof monaco) => {
    monacoInstance.editor.defineTheme("sql-theme", themeConfig);
  };

  useEffect(() => {
    return () => {
      editorRef.current?.dispose();
    };
  }, []);

  return (
    <Editor
      height={height}
      language={language}
      beforeMount={handleEditorWillMount}
      onMount={handleEditorDidMount}
      onChange={handleEditorChange}
      value={value ?? undefined}
      options={{ ...defaultOptions, ...options }}
    />
  );
};

export default CustomMonacoEditor;

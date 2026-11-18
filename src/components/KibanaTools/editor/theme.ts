/**
 * KibanaTools 深色主题（仿 Kibana Dev Tools Console 观感）
 * 显式标注 IStandaloneThemeData，避免 demo theme.ts 的 BuiltinTheme 类型错误
 */
import * as monaco from "monaco-editor";

/** 主题名（编辑器与响应面板共用） */
export const KT_THEME_NAME = "kt-dark";

const ktDarkTheme: monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    // JSON 键与值在深色下区分开（仿 VSCode 深色 JSON 配色）
    { token: "string.key.json", foreground: "9CDCFE" },
    { token: "string.value.json", foreground: "CE9178" },
    { token: "number", foreground: "B5CEA8" },
    { token: "keyword", foreground: "C586C0" },
    { token: "comment", foreground: "6A9955", fontStyle: "italic" },
  ],
  colors: {
    // 编辑器底色（比纯黑略带蓝灰，贴近 Kibana console）
    "editor.background": "#1c1e24",
    "editor.foreground": "#d4d7dd",
    "editorLineNumber.foreground": "#5a5f6a",
    "editorLineNumber.activeForeground": "#a8adb8",
    "editorCursor.foreground": "#d7dae0",
    "editor.selectionBackground": "#2c4f79",
    "editor.lineHighlightBackground": "#232630",
    "editorIndentGuide.background": "#33373f",
    "editorBracketMatch.background": "#2c4f7955",
    "editorBracketMatch.border": "#388bff88",
    // 补全弹窗深色
    "editorSuggestWidget.background": "#252830",
    "editorSuggestWidget.border": "#34383f",
    "editorSuggestWidget.selectedBackground": "#2c4f79",
    "editorSuggestWidget.foreground": "#d4d7dd",
    "editorHoverWidget.background": "#252830",
    "editorHoverWidget.border": "#34383f",
    "editorWidget.background": "#252830",
    "scrollbarSlider.background": "#43465088",
    "scrollbarSlider.hoverBackground": "#4e535f88",
  },
};

export default ktDarkTheme;

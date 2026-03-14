// d:\fep\kibana-editor\src\components\editor\theme.ts
export default {
  base: "vs",
  inherit: true,

  rules: [
    { token: "keyword", foreground: "0066CC", fontStyle: "bold" }, // 关键词
    { token: "string", foreground: "C41A16" }, // 普通字符串
    { token: "number", foreground: "1C00CF" }, // 数字
    { token: "comment", foreground: "6A9955", fontStyle: "italic" }, // 注释
    { token: "identifier", foreground: "333333" }, // 标识符
  ],

  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#333333",

    "editor.lineHighlightBackground": "#f7f7f7",

    "editorCursor.foreground": "#333333",

    "editorLineNumber.foreground": "#999999",
    "editorLineNumber.activeForeground": "#333333",

    "editor.selectionBackground": "#cce8ff",

    "editorIndentGuide.background": "#e5e5e5",

    "editorBracketMatch.background": "#e6f2ff",
    "editorBracketMatch.border": "#66aaff",

    "editorSuggestWidget.background": "#ffffff",
    "editorSuggestWidget.border": "#dddddd",
    "editorSuggestWidget.selectedBackground": "#e6f2ff", // 自定义为绿色
    "editorSuggestWidget.selectedForeground": "#0f0f0fff", // 可选：自定义选中时的文字颜色
  },
};

/**
 * ConsoleEditor：@monaco-editor/react 薄封装
 * - 幂等初始化 MonacoEnvironment / worker / loader / 主题 / JSON 诊断
 * - 请求编辑器与响应面板共用
 */
import Editor, { loader } from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import ktDarkTheme, { KT_THEME_NAME } from "./theme";
// 图标资产经 vite 处理成正确 URL（dev：/src 源路径；build：哈希资产路径），
// 不能在 console.css 里直接写相对 url()——vite dev 对 CSS 内联注入不做 url 重写，
// 浏览器按 document 解析会得到 /Icons/*.svg（404 兜底页），图标全部不可见
import playIcon from "../Icons/play.svg";
import playHoverIcon from "../Icons/play-hover.svg";
import indentIcon from "../Icons/indent.svg";
import indentHoverIcon from "../Icons/indent-hover.svg";
import "./console.css";

/* ---- monaco 环境幂等初始化（多实例/重复渲染只执行一次） ---- */
let monacoReady = false;

/**
 * 初始化 monaco 运行环境
 * ★ 迁移主应用（webpack）时唯一需要适配的函数：?worker 是 Vite 专有导入 ★
 */
function setupMonaco() {
  if (monacoReady) return;
  monacoReady = true;

  self.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === "json") return new jsonWorker();
      return new editorWorker();
    },
  };
  loader.config({ monaco });

  // 请求文档含 HTTP 方法头行，不是纯 JSON：关闭 JSON 校验诊断
  // （比仅 renderValidationDecorations: "off" 更彻底，波浪线与标记计数都会消失）
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: false,
    allowComments: true,
  });
}

/** 编辑器默认选项（深色 console 观感） */
export const CONSOLE_EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions =
  {
    renderLineHighlight: "none",
    scrollBeyondLastLine: false,
    wordBasedSuggestions: false,
    // 容器尺寸变化（含初始测量竞态）时自动重算布局，避免响应面板高度塌陷
    automaticLayout: true,
    wordWrap: "on",
    wrappingIndent: "indent",
    matchBrackets: "never",
    contextmenu: false,
    minimap: { enabled: false },
    // 右侧概览标尺（光标/选区标记的窄条）一并关闭，编辑器右侧仅保留滚动条
    overviewRulerLanes: 0,
    fontFamily: '"Roboto Mono", Consolas, monospace',
    fontSize: 14,
    lineHeight: 21,
    fixedOverflowWidgets: true,
    theme: KT_THEME_NAME,
    renderValidationDecorations: "off",
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    lineNumbersMinChars: 3,
    padding: { top: 8, bottom: 8 },
  };

export interface ConsoleEditorProps {
  height?: string | number;
  language?: string;
  value?: string;
  defaultValue?: string;
  readOnly?: boolean;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  /** 编辑器实例就绪后回调（含卸载清理由内部 dispose 处理） */
  onEmitRef?: (editor: monaco.editor.IStandaloneCodeEditor) => void;
  /** 编辑器挂载完成回调（在主题兜底与 onEmitRef 之后执行） */
  onMount?: OnMount;
  handleChange?: (
    value: string | undefined,
    ev: monaco.editor.IModelContentChangedEvent,
  ) => void;
}

/** 内部组件：外壳负责初始化，Editor 按受控/非受控两种模式挂载 */
const ConsoleEditor = ({
  height = "100%",
  language = "json",
  value,
  defaultValue,
  readOnly = false,
  options = {},
  onEmitRef,
  onMount,
  handleChange,
}: ConsoleEditorProps) => {
  setupMonaco();

  const handleWillMount = (monacoInstance: typeof monaco) => {
    monacoInstance.editor.defineTheme(KT_THEME_NAME, ktDarkTheme);
  };

  const handleDidMount: OnMount = (editor, monacoInstance) => {
    // 挂载后再次确保主题生效（loader 异步时序兜底）
    monacoInstance.editor.setTheme(KT_THEME_NAME);
    onEmitRef?.(editor);
    onMount?.(editor, monacoInstance);
  };

  // CSS 自定义属性下发图标 URL：monaco 的 gutter decoration 与 content widget
  // 都渲染在本容器子树内，var() 沿 DOM 继承可达（含 fixedOverflowWidgets 容器）。
  // 命令式 setProperty 写入（style prop 对纯自定义属性对象在本环境渲染为空）
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const s = el.style;
    // url() 必须加引号：vite 生成的 data URI 含单引号（xmlns='…'），
    // 无引号 url() 是非法 CSS token，setProperty 会静默丢弃整个值
    s.setProperty("--kt-icon-play", `url("${playIcon}")`);
    s.setProperty("--kt-icon-play-hover", `url("${playHoverIcon}")`);
    s.setProperty("--kt-icon-indent", `url("${indentIcon}")`);
    s.setProperty("--kt-icon-indent-hover", `url("${indentHoverIcon}")`);
  }, []);

  return (
    <div ref={hostRef} className="kt-editor-host">
      <Editor
        height={height}
        language={language}
        beforeMount={handleWillMount}
        onMount={handleDidMount}
        onChange={handleChange}
        value={readOnly ? value : undefined}
        defaultValue={readOnly ? undefined : (value ?? defaultValue)}
        options={{ ...CONSOLE_EDITOR_OPTIONS, ...options, readOnly }}
      />
    </div>
  );
};

export default ConsoleEditor;

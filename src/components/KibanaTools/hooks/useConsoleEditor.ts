/**
 * KibanaTools 请求编辑器的命令式逻辑接线
 *
 * - 方法色 / 当前请求块 decoration：每实例独立 collection，随内容与光标刷新
 * - Ctrl+Enter：注册编辑器 action，回调经 ref 取最新值（避免闭包过期）
 * - 补全 provider：注册一次，闭包经 ref 读最新轮询快照（快照刷新无需重注册）；
 *   卸载时 dispose，避免多实例重复注册
 * - 块级运行/缩进按钮：跟随光标所在请求块（选中块直接显示，鼠标移入其他块不显示）；
 *   双模式接线（gutter = 头行左侧仿 Kibana 原生；lineEnd = 头行行末 content widget），
 *   独立 effect，切换位置仅重建按钮逻辑
 */
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import { findRequestAt, parseRequests } from "../parser/parseRequests";
import { provideBodySuggestions } from "../completion/body";
import {
  HTTP_METHODS,
  provideRequestLineSuggestions,
} from "../completion/requestLine";
import type {
  AutocompleteSnapshot,
  KibanaToolbarButtonPosition,
  ParsedConsoleRequest,
} from "../types";

/** useConsoleEditor 的配置项 */
export interface UseConsoleEditorOptions {
  /** 运行当前请求的回调（Ctrl+Enter 触发） */
  onRun: () => void;
  /** 运行指定请求的回调（块级 ▶ 按钮触发） */
  onRunRequest: (request: ParsedConsoleRequest) => void;
  /** 缩进指定请求的回调（块级缩进按钮触发） */
  onFormatRequest: (request: ParsedConsoleRequest) => void;
  /** 轮询快照（补全的字段/实体来源） */
  snapshot: AutocompleteSnapshot;
  /** 块级按钮位置，默认 gutter（头行左侧） */
  buttonPosition: KibanaToolbarButtonPosition;
}

/** 方法名 → 着色 class（与 console.css 中的 .kt-http-* 对应） */
const METHOD_CLASS_MAP: Record<string, string> = {
  GET: "kt-http-get",
  POST: "kt-http-post",
  PUT: "kt-http-put",
  DELETE: "kt-http-delete",
  HEAD: "kt-http-head",
  PATCH: "kt-http-patch",
};

/**
 * 接线编辑器命令式逻辑
 * @param editor 请求编辑器实例（null = 尚未挂载；由父组件以 state 传入，
 *               挂载完成后从 null 变为实例时本 hook 自动接线）
 */
export function useConsoleEditor(
  editor: monaco.editor.IStandaloneCodeEditor | null,
  options: UseConsoleEditorOptions,
): void {
  // latest-ref：effect 内始终读取最新回调与快照
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // ---- 基础接线：方法色/活动块 decoration + Ctrl+Enter + 补全 provider ----
  useEffect(() => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    // ---- decoration：方法色 + 当前请求块 ----
    const methodCollection = editor.createDecorationsCollection();
    const activeCollection = editor.createDecorationsCollection();

    /** 解析全文并刷新两组 decoration（cursorLine 为 null 时清除块高亮） */
    const refreshDecorations = (cursorLine: number | null) => {
      const { methodLines, requests } = parseRequests(model.getValue());
      methodCollection.set(
        methodLines.map(({ line, method }) => ({
          range: new monaco.Range(line, 1, line, method.length + 1),
          options: { inlineClassName: METHOD_CLASS_MAP[method] },
        })),
      );
      const active =
        cursorLine == null ? null : findRequestAt(requests, cursorLine);
      activeCollection.set(
        active
          ? [
              {
                range: new monaco.Range(active.startLine, 1, active.endLine, 1),
                options: {
                  isWholeLine: true,
                  className: "kt-request-active",
                },
              },
            ]
          : [],
      );
    };

    const currentLine = () => editor.getPosition()?.lineNumber ?? null;
    refreshDecorations(currentLine());

    const contentListener = editor.onDidChangeModelContent(() => {
      refreshDecorations(currentLine());
    });
    const cursorListener = editor.onDidChangeCursorPosition((e) => {
      refreshDecorations(e.position.lineNumber);
    });

    // ---- Ctrl+Enter 运行当前请求 ----
    const runAction = editor.addAction({
      id: "kibana-tools.run",
      label: "运行当前请求 (Ctrl+Enter)",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1,
      run: () => optionsRef.current.onRun(),
    });

    // ---- 补全 provider：一次注册，按光标位置分流 ----
    const provider = monaco.languages.registerCompletionItemProvider("json", {
      triggerCharacters: ['"', " ", ".", ":", "{", ",", "/"],
      provideCompletionItems(model, position) {
        const { snapshot } = optionsRef.current;
        const { requests } = parseRequests(model.getValue());
        const request = findRequestAt(requests, position.lineNumber);

        // Kibana 式判定：光标前文本是空或某方法名的前缀（正在开写新请求）
        // → 视为头行上下文，使用户在任意空行输入 `GE` 也能拿到方法建议
        const typedUpper = model
          .getLineContent(position.lineNumber)
          .substring(0, position.column - 1)
          .trim()
          .toUpperCase();
        const isMethodPrefix = HTTP_METHODS.some((m) =>
          m.startsWith(typedUpper),
        );

        // 头行 / 空隙（输入新请求）→ 方法名 + 路径段补全
        if (
          !request ||
          position.lineNumber === request.startLine ||
          isMethodPrefix
        ) {
          return {
            suggestions: provideRequestLineSuggestions(
              model,
              position,
              snapshot,
            ),
          };
        }

        // body 区域 → API 结构 + 动态字段补全（索引段取 path 首段）
        const indexToken = request.path.split(/[/?#]/)[0] ?? "";
        return {
          suggestions: provideBodySuggestions({
            model,
            position,
            snapshot,
            indexToken,
            startLine: request.startLine + 1,
          }),
        };
      },
    });

    return () => {
      provider.dispose();
      runAction.dispose();
      contentListener.dispose();
      cursorListener.dispose();
    };
  }, [editor]);

  // ---- 块级运行/缩进按钮：按 buttonPosition 双模式接线 ----
  // （buttonPosition 进依赖：运行时切换位置时仅重建本 effect 的按钮逻辑）
  const { buttonPosition } = options;
  useEffect(() => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    /** 编辑器鼠标事件的行号（position 可能为 null，退回 range 行号） */
    const eventLine = (e: monaco.editor.IEditorMouseEvent): number | null =>
      e.target.position?.lineNumber ?? e.target.range?.startLineNumber ?? null;

    /** 按光标位置重算按钮（文档变化后缓存失效，避免按钮残留在变化前的行） */
    const currentLine = () => editor.getPosition()?.lineNumber ?? null;

    // 上次处理的行号：同行不重复解析；
    // undefined 哨兵表示缓存失效（文档刚变化），强制下次重算
    let lastCursorLine: number | null | undefined = undefined;

    /** 解析全文，返回光标行所属请求头行（无请求时 null） */
    const resolveHeadLine = (cursorLine: number | null): number | null => {
      const { requests } = parseRequests(model.getValue());
      return cursorLine == null
        ? null
        : (findRequestAt(requests, cursorLine)?.startLine ?? null);
    };

    if (buttonPosition === "gutter") {
      // gutter 模式：光标所在请求块的头行显示 ▶ 运行（glyph margin）
      // 与缩进（行装饰区）两个 gutter 按钮，点击分别触发对应回调
      const gutterCollection = editor.createDecorationsCollection();

      /** 光标行号 → 在该行所属请求头行上显示/清除 gutter 按钮 */
      const refreshGutterButtons = (cursorLine: number | null) => {
        if (cursorLine === lastCursorLine) return;
        lastCursorLine = cursorLine;
        const headLine = resolveHeadLine(cursorLine);
        gutterCollection.set(
          headLine == null
            ? []
            : [
                {
                  range: new monaco.Range(headLine, 1, headLine, 1),
                  options: {
                    isWholeLine: true,
                    glyphMarginClassName: "kt-glyph-run",
                    linesDecorationsClassName: "kt-line-indent",
                  },
                },
              ],
        );
      };

      const cursorListener = editor.onDidChangeCursorPosition((e) => {
        refreshGutterButtons(e.position.lineNumber);
      });
      const mouseDownListener = editor.onMouseDown((e) => {
        // 仅响应鼠标左键，右键/中键不触发运行与缩进
        if (!e.event.leftButton) return;
        // 仅响应两个按钮区域：glyph margin = 运行，行装饰区 = 缩进
        const type = e.target.type;
        const { GUTTER_GLYPH_MARGIN, GUTTER_LINE_DECORATIONS } =
          monaco.editor.MouseTargetType;
        if (type !== GUTTER_GLYPH_MARGIN && type !== GUTTER_LINE_DECORATIONS) {
          return;
        }
        const line = eventLine(e);
        if (line == null) return;
        const { requests } = parseRequests(model.getValue());
        const request = findRequestAt(requests, line);
        if (!request) return;
        if (type === GUTTER_GLYPH_MARGIN) {
          optionsRef.current.onRunRequest(request);
        } else {
          optionsRef.current.onFormatRequest(request);
        }
      });
      const contentListener = editor.onDidChangeModelContent(() => {
        refreshGutterButtons(currentLine());
      });

      // 初始即按当前光标显示按钮（选中块直接显示，不等鼠标事件）
      refreshGutterButtons(currentLine());

      return () => {
        gutterCollection.set([]);
        cursorListener.dispose();
        mouseDownListener.dispose();
        contentListener.dispose();
      };
    }

    // lineEnd 模式：光标所在请求块的头行行末显示按钮（content widget）
    // 双层 DOM：monaco 会内联强控 widget 根节点的 display（显示=block/隐藏=none），
    // flex 布局放内层，避免被 monaco 的内联 display 覆盖
    const widgetDom = document.createElement("div");
    widgetDom.className = "kt-row-end-widget";
    const btnsDom = document.createElement("div");
    btnsDom.className = "kt-row-btns";
    const runBtn = document.createElement("span");
    runBtn.className = "kt-row-btn kt-row-btn-run";
    runBtn.title = "运行该请求";
    const indentBtn = document.createElement("span");
    indentBtn.className = "kt-row-btn kt-row-btn-indent";
    indentBtn.title = "自动缩进该请求";
    // 阻断 mousedown 冒泡：避免点击按钮时编辑器把光标定位到行末
    for (const btn of [runBtn, indentBtn]) {
      btn.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
    }
    runBtn.addEventListener("click", () => {
      if (activeHeadLine == null) return;
      const { requests } = parseRequests(model.getValue());
      const request = findRequestAt(requests, activeHeadLine);
      if (request) optionsRef.current.onRunRequest(request);
    });
    indentBtn.addEventListener("click", () => {
      if (activeHeadLine == null) return;
      const { requests } = parseRequests(model.getValue());
      const request = findRequestAt(requests, activeHeadLine);
      if (request) optionsRef.current.onFormatRequest(request);
    });
    btnsDom.append(runBtn, indentBtn);
    widgetDom.append(btnsDom);

    // 当前按钮所在的请求头行号（null = 隐藏 widget）
    let activeHeadLine: number | null = null;

    const rowBtnsWidget: monaco.editor.IContentWidget = {
      getId: () => "kibana-tools.row-btns",
      getDomNode: () => widgetDom,
      // 列固定为 1：widget 根宽度由 syncWidgetWidth 同步为内容区宽，形成整行条带，
      // 按钮由内层 flex 右对齐固定在内容区最右端
      getPosition: () =>
        activeHeadLine == null
          ? null
          : {
              position: { lineNumber: activeHeadLine, column: 1 },
              preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
            },
    };
    editor.addContentWidget(rowBtnsWidget);

    // monaco 的 .contentWidgets 挂载容器宽度为 0，absolute left+right 拉伸参照它必然
    // 得到 0 宽，条带宽度须显式同步为编辑器内容区宽（resize 时经 onDidLayoutChange 重算）
    const syncWidgetWidth = () => {
      widgetDom.style.width = `${editor.getLayoutInfo().contentWidth}px`;
    };

    /** 光标行号 → 在该行所属请求头行行末显示/隐藏按钮 */
    const refreshRowButtons = (cursorLine: number | null) => {
      if (cursorLine === lastCursorLine) return;
      lastCursorLine = cursorLine;
      activeHeadLine = resolveHeadLine(cursorLine);
      if (activeHeadLine != null) syncWidgetWidth();
      // layoutContentWidget 依据 getPosition 的新值重新定位/隐藏
      editor.layoutContentWidget(rowBtnsWidget);
    };

    const cursorListener = editor.onDidChangeCursorPosition((e) => {
      refreshRowButtons(e.position.lineNumber);
    });
    const contentListener = editor.onDidChangeModelContent(() => {
      refreshRowButtons(currentLine());
    });
    const layoutListener = editor.onDidLayoutChange(() => {
      if (activeHeadLine == null) return;
      syncWidgetWidth();
      editor.layoutContentWidget(rowBtnsWidget);
    });

    // 初始即按当前光标显示按钮（选中块直接显示，不等鼠标事件）
    refreshRowButtons(currentLine());

    return () => {
      cursorListener.dispose();
      contentListener.dispose();
      layoutListener.dispose();
      editor.removeContentWidget(rowBtnsWidget);
    };
  }, [editor, buttonPosition]);
}

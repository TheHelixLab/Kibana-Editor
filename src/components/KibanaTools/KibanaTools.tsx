/**
 * KibanaTools：仿 Kibana Dev Tools Console 的多请求查询编辑器组件
 *
 * - 左侧请求编辑器：多请求解析 + 方法着色 + Ctrl+Enter 运行光标所在请求
 * - 右侧响应面板：状态码 / 耗时 / 请求摘要 / 响应正文
 * - 补全上下文：_mapping/_aliases/_template 每 5 秒轮询（可关），驱动补全建议
 * - 双栏可拖宽：react-resizable-panels 分隔编辑器与响应面板
 * - 外部通信全部经 adapter（默认 fetch 实现，真实 SDK 只需替换 adapter）
 */
import { useCallback, useRef, useState } from "react";
import { Button, message } from "antd";
import { Group, Panel, Separator } from "react-resizable-panels";
import JSON5 from "json5";
import * as monaco from "monaco-editor";
import ConsoleEditor from "./editor/ConsoleEditor";
import ResponsePanel from "./ResponsePanel";
import { useAutocompletePolling } from "./hooks/useAutocompletePolling";
import { useConsoleEditor } from "./hooks/useConsoleEditor";
import { fetchConsoleAdapter } from "./adapter/fetchAdapter";
import { findRequestAt, parseRequests } from "./parser/parseRequests";
import { DEFAULT_QUERY } from "./defaults";
import type {
  KibanaToolsProps,
  ParsedConsoleRequest,
  QueryResult,
} from "./types";

const KibanaTools = ({
  adapter = fetchConsoleAdapter,
  defaultValue = DEFAULT_QUERY,
  polling = true,
  pollingIntervalMs = 5000,
  height = "80vh",
  buttonPosition = "gutter",
  onResult,
}: KibanaToolsProps) => {
  /** 请求编辑器实例（null = 未挂载），useConsoleEditor 依赖它接线 */
  const [editor, setEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { snapshot, loading, lastError, lastSyncAt } = useAutocompletePolling(
    adapter,
    { enabled: polling, intervalMs: pollingIntervalMs },
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [activeRequest, setActiveRequest] =
    useState<ParsedConsoleRequest | null>(null);

  /** 运行指定请求（工具栏按钮、Ctrl+Enter、头行 ▶ 按钮共用） */
  const runningRef = useRef(false);
  const runRequest = useCallback(
    async (request: ParsedConsoleRequest) => {
      // 并发守卫：gutter ▶ 与 Ctrl+Enter 不经过工具栏按钮的 disabled，
      // 用 ref 判断防止双击/多入口同时触发重复执行
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      try {
        const queryResult = await adapter.executeQuery({
          method: request.method,
          path: request.path,
          body: request.body || undefined,
        });
        setResult(queryResult);
        setActiveRequest(request);
        onResult?.(queryResult, request);
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [adapter, onResult],
  );

  /** 运行光标所在请求 */
  const handleRun = useCallback(async () => {
    const model = editor?.getModel();
    const cursorLine = editor?.getPosition()?.lineNumber;
    if (!editor || !model || !cursorLine) return;

    const { requests } = parseRequests(model.getValue());
    const request = findRequestAt(requests, cursorLine);
    if (!request) {
      message.warning("未找到可运行的请求");
      return;
    }
    await runRequest(request);
  }, [editor, runRequest]);

  /**
   * 缩进单个请求：body JSON5 解析后 2 空格重排
   * @returns false = 请求体不是合法 JSON（保留原文）
   */
  const formatOneRequest = useCallback(
    (request: ParsedConsoleRequest): boolean => {
      const model = editor?.getModel();
      if (!editor || !model) return false;

      let body = request.body;
      if (body) {
        try {
          body = JSON.stringify(JSON5.parse(body), null, 2);
        } catch {
          return false; // 解析失败的请求体保留原文
        }
      }
      const headLine = `${request.method} ${request.path}`;
      editor.executeEdits("kibana-tools.format", [
        {
          range: new monaco.Range(
            request.startLine,
            1,
            request.endLine,
            model.getLineMaxColumn(request.endLine),
          ),
          text: body ? `${headLine}\n${body}` : headLine,
        },
      ]);
      return true;
    },
    [editor],
  );

  /** 头行缩进按钮：单个请求缩进，失败提示 */
  const handleFormatRequest = useCallback(
    (request: ParsedConsoleRequest) => {
      if (!formatOneRequest(request)) {
        message.warning("请求体不是合法 JSON，无法缩进");
      }
    },
    [formatOneRequest],
  );

  /**
   * 全文格式化：逐请求缩进
   * （文档级 formatDocument 在含 METHOD 头行的 json 模型上必失败，故按块处理；
   *   从最后一个请求向前替换，避免行号位移影响后续替换范围）
   */
  const handleFormat = useCallback(() => {
    const model = editor?.getModel();
    if (!editor || !model) return;

    const { requests } = parseRequests(model.getValue());
    if (requests.length === 0) {
      message.info("未发现可格式化的请求");
      return;
    }

    let invalidCount = 0;
    for (let i = requests.length - 1; i >= 0; i--) {
      if (!formatOneRequest(requests[i])) {
        invalidCount++;
      }
    }
    if (invalidCount > 0) {
      message.warning(`${invalidCount} 个请求体不是合法 JSON，已保留原文`);
    }
  }, [editor, formatOneRequest]);

  useConsoleEditor(editor, {
    onRun: handleRun,
    onRunRequest: runRequest,
    onFormatRequest: handleFormatRequest,
    snapshot,
    buttonPosition,
  });

  /** 工具栏右侧轮询状态文案 */
  const renderSyncStatus = () => {
    if (!polling) {
      return <span className="kt-sync-status">补全上下文轮询已关闭</span>;
    }
    if (lastError) {
      return (
        <span className="kt-sync-status" style={{ color: "#ef5350" }}>
          补全上下文同步失败，沿用上次数据
        </span>
      );
    }
    if (loading) {
      return <span className="kt-sync-status">补全上下文同步中…</span>;
    }
    if (lastSyncAt) {
      const time = new Date(lastSyncAt).toLocaleTimeString("zh-CN", {
        hour12: false,
      });
      return <span className="kt-sync-status">补全上下文 {time}</span>;
    }
    return <span className="kt-sync-status">补全上下文等待首次同步…</span>;
  };

  return (
    <div className="kt-root" style={{ height }}>
      <div className="kt-toolbar">
        <span className="kt-toolbar-title">Dev Tools</span>
        <Button size="small" onClick={handleRun} disabled={running}>
          ▶ 运行
        </Button>
        <Button size="small" onClick={handleFormat}>
          格式化
        </Button>
        {renderSyncStatus()}
      </div>
      <div className="kt-body">
        {/* v4 尺寸约束：数值是像素，字符串才是百分比，故用 "50%" 形式 */}
        <Group orientation="horizontal" className="kt-panel-group">
          <Panel defaultSize="50%" minSize="20%">
            <div className="kt-pane kt-pane-editor">
              <ConsoleEditor
                defaultValue={defaultValue}
                onEmitRef={setEditor}
                // gutter 模式：glyphMargin 留出 ▶ 按钮区、行装饰区留给缩进按钮；
                // lineEnd 模式不占用 gutter，编辑器保持默认外观
                options={
                  buttonPosition === "gutter"
                    ? { glyphMargin: true, folding: false, lineDecorationsWidth: 22 }
                    : undefined
                }
              />
            </div>
          </Panel>
          <Separator className="kt-resize-handle" />
          <Panel defaultSize="50%" minSize="15%">
            <div className="kt-pane">
              <ResponsePanel
                result={result}
                request={activeRequest}
                running={running}
              />
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  );
};

export default KibanaTools;

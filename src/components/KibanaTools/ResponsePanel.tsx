/**
 * 响应面板：状态码 Tag + 耗时 + 请求摘要 + 只读深色编辑器
 */
import { useMemo } from "react";
import { Spin, Tag } from "antd";
import JSON5 from "json5";
import ConsoleEditor from "./editor/ConsoleEditor";
import type { ParsedConsoleRequest, QueryResult } from "./types";

interface ResponsePanelProps {
  /** 最近一次执行结果（null = 尚未执行） */
  result: QueryResult | null;
  /** 结果对应的请求（用于摘要行展示 method + path） */
  request: ParsedConsoleRequest | null;
  /** 是否执行中 */
  running: boolean;
}

/** 响应文本：JSON 解析成功则 2 空格美化，失败显原文 */
function prettify(data: string): string {
  try {
    return JSON.stringify(JSON5.parse(data), null, 2);
  } catch {
    return data;
  }
}

/** 状态码 Tag：2xx 绿 / 其它红 / 0 显示 ERR */
function StatusTag({ result }: { result: QueryResult }) {
  const ok = result.statusCode >= 200 && result.statusCode < 300;
  const label = result.statusCode === 0 ? "ERR" : String(result.statusCode);
  return <Tag color={ok ? "success" : "error"}>{label}</Tag>;
}

const ResponsePanel = ({ result, request, running }: ResponsePanelProps) => {
  const display = useMemo(
    () => (result ? prettify(result.data) : ""),
    [result],
  );

  return (
    <div className="kt-pane">
      <div className="kt-response-header">
        {running ? (
          <>
            <Spin size="small" />
            <span className="kt-response-empty">运行中…</span>
          </>
        ) : result ? (
          <>
            <StatusTag result={result} />
            <span className="kt-response-time">{result.timeMs} ms</span>
            <span className="kt-response-request">
              {request ? `${request.method} ${request.path}` : ""}
            </span>
          </>
        ) : (
          <span className="kt-response-empty">
            按 Ctrl + Enter 运行光标所在请求
          </span>
        )}
      </div>
      <ConsoleEditor readOnly value={display} />
    </div>
  );
};

export default ResponsePanel;

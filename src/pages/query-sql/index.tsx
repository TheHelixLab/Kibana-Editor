import React, { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@/components/editor";
import * as monaco from "monaco-editor";
import { message } from "antd";
import JSON5 from "json5";

/* ---------------- component ---------------- */

const CustomMonacoEditor = ({
  initialFirstLine = "// 固定不可修改的第一行",
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [response, setResponse] = useState("");
  const [querySql, setQuerySql] = useState(`{"query": {}}`);

  const handleFormat = async () => {
    try {
      JSON5.parse(querySql);
      editorRef?.current?.getAction("editor.action.formatDocument").run();
    } catch (error) {
      message.error("查询语句格式错误");
      return;
    }
  };

  return (
    <div
      style={{
        padding: 20,
        background: "#f7f8fa",
        borderRadius: 8,
      }}
    >
      {/* 工具栏 */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <button
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #1677ff",
            background: "#1677ff",
            color: "#fff",
            cursor: "pointer",
          }}
          onClick={() => {
            try {
              console.log(JSON5.parse(querySql));
              message.success("发起请求");
              // 先格式化 JSON，再赋值
              const rawJson =
                '{"error":{"root_cause":[{"type":"illegal_argument_exception","reason":"request [GET /.apm-custom-link] does not support having a body"}],"type":"illegal_argument_exception","reason":"request [GET /.apm-custom-link] does not support having a body"},"status":400}';
              const formattedJson = JSON.stringify(
                JSON5.parse(rawJson),
                null,
                2,
              );
              setResponse(formattedJson);
            } catch (error) {
              message.error("查询语句格式错误");
              return;
            }
          }}
        >
          发起请求
        </button>

        <button
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #d9d9d9",
            background: "#fff",
            cursor: "pointer",
          }}
          onClick={handleFormat}
        >
          格式化
        </button>
      </div>

      {/* 编辑器容器 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        {/* 左侧 */}
        <div
          style={{
            border: "1px solid #e5e6eb",
            borderRadius: 8,
            overflow: "hidden",
            background: "#fff",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid #eee",
              fontSize: 13,
              fontWeight: 500,
              background: "#fafafa",
            }}
          >
            查询
          </div>

          <Editor
            initialFirstLine={initialFirstLine}
            defaultQuery={querySql}
            onEmitRef={(ref) => (editorRef.current = ref)}
            handleChange={(value, ev) => {
              if (value) {
                setQuerySql(value);
              } else {
                console.log(value, ev);
              }
            }}
          />
        </div>

        {/* 右侧 */}
        <div
          style={{
            border: "1px solid #e5e6eb",
            borderRadius: 8,
            overflow: "hidden",
            background: "#fff",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid #eee",
              fontSize: 13,
              fontWeight: 500,
              background: "#fafafa",
            }}
          >
            响应
          </div>

          <Editor
            value={response}
            options={{
              readOnly: true,
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default CustomMonacoEditor;

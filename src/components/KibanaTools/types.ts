/**
 * KibanaTools 组件类型定义
 */

/** 支持的 HTTP 方法 */
export type ConsoleMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "HEAD"
  | "PATCH";

/** 解析出的单个请求块 */
export interface ParsedConsoleRequest {
  /** 大写 HTTP 方法 */
  method: ConsoleMethod;
  /** 请求路径（含 query 部分，如 "index/_search?size=1"，整体透传适配层） */
  path: string;
  /** 头行之后的请求体原文（trim 后，可为空） */
  body: string;
  /** 头行行号（1-based） */
  startLine: number;
  /** 请求最后一个非空行行号（1-based，inclusive） */
  endLine: number;
}

/** 全文解析结果 */
export interface ParseResult {
  requests: ParsedConsoleRequest[];
  /** 头行信息列表（供方法色 decoration 使用） */
  methodLines: {
    line: number;
    method: ConsoleMethod;
    /** path 起始列（1-based） */
    pathStartColumn: number;
  }[];
}

/** 轮询资源类型（组装查询条件的三个固定端点） */
export type ConsoleResource = "mapping" | "aliases" | "template";

/** 查询执行入参 */
export interface ExecuteInput {
  /** 大写 HTTP 方法 */
  method: string;
  /** 请求路径（含 query） */
  path: string;
  /** 请求体原文（GET/DELETE 通常为空） */
  body?: string;
}

/** 查询执行结果（响应面板展示所需的最小集合） */
export interface QueryResult {
  /** HTTP 状态码；0 表示网络层失败 */
  statusCode: number;
  statusText: string;
  /** 耗时（毫秒，取整） */
  timeMs: number;
  /** 响应原文（面板侧再尝试解析美化） */
  data: string;
}

/**
 * 请求适配层：组件所有外部通信的出入口
 *
 * - 轮询资源：fetchResource（失败应 reject，由轮询 hook 容错）
 * - 执行查询：executeQuery（永不 reject，非 2xx 与网络错误都包装为 QueryResult）
 *
 * 真实 SDK 接入时只需实现此接口（或修改默认的 fetchConsoleAdapter）。
 */
export interface ConsoleRequestAdapter {
  fetchResource(resource: ConsoleResource): Promise<unknown>;
  executeQuery(input: ExecuteInput): Promise<QueryResult>;
}

/** 补全上下文快照（由 _mapping/_aliases/_template 轮询数据构建） */
export interface AutocompleteSnapshot {
  /** 快照版本号，每次成功刷新 +1（供 useMemo / effect 依赖） */
  version: number;
  /** 索引名列表（排序去重） */
  indices: string[];
  /** 别名列表 */
  aliases: string[];
  /** 模板名列表 */
  templates: string[];
  /**
   * 解析索引表达式为具体索引列表
   * 支持 "a*,b" 逗号分隔 + 通配符；别名会反解为对应索引
   */
  resolveIndices(token: string): string[];
  /** 取索引（支持通配/别名/逗号）对应的字段列表（含模板匹配字段的并集） */
  getFields(indexToken: string): FieldInfo[];
}

/** 字段信息（与 demo esSuggestion 的 FieldInfo 保持一致） */
export interface FieldInfo {
  path: string;
  type: string;
}

/** 块级运行/缩进按钮的位置 */
export type KibanaToolbarButtonPosition =
  /** 头行左侧 gutter（仿 Kibana 原生）：▶ 在 glyph margin、缩进在行装饰区 */
  | "gutter"
  /** 头行行末（行文本最右侧，content widget 实现） */
  | "lineEnd";

/** KibanaTools 组件 props */
export interface KibanaToolsProps {
  /** 请求适配层，默认 fetchConsoleAdapter */
  adapter?: ConsoleRequestAdapter;
  /** 编辑器初始内容，默认使用内置示例 */
  defaultValue?: string;
  /** 是否轮询补全上下文，默认 true */
  polling?: boolean;
  /** 轮询间隔（毫秒），默认 5000 */
  pollingIntervalMs?: number;
  /** 组件高度，默认 "80vh" */
  height?: string | number;
  /** 块级运行/缩进按钮位置，默认 "gutter"（头行左侧） */
  buttonPosition?: KibanaToolbarButtonPosition;
  /** 每次请求执行完成后的回调 */
  onResult?: (result: QueryResult, request: ParsedConsoleRequest) => void;
}

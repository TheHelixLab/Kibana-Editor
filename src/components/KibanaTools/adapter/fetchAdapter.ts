/**
 * 默认请求适配层：基于 fetch 直调 /api/console/proxy
 *
 * ★ 真实 SDK 联调时只需要改这一个文件 ★
 *
 * 协议约定（与 Kibana 代理一致）：
 * - 资源接口：GET /api/console/proxy?path=_mapping%3Fpretty%3Dfalse（path 值内含 "?"，必须整体 encode）
 * - 执行接口：POST /api/console/proxy?path=<请求路径>&method=<HTTP 方法>，ES 请求体走 POST body
 *   （method 的传递方式属后端契约差异，联调时只调整此处）
 */
import type {
  ConsoleRequestAdapter,
  ConsoleResource,
  QueryResult,
} from "../types";

/** 代理端点前缀 */
const PROXY_BASE = "/api/console/proxy";

/** 资源类型 → 代理路径映射 */
const RESOURCE_PATH: Record<ConsoleResource, string> = {
  mapping: "_mapping",
  aliases: "_aliases",
  template: "_template",
};

/** 资源接口统一带 pretty=false（与需求给定的 URL 格式一致） */
const RESOURCE_QUERY = "?pretty=false";

export const fetchConsoleAdapter: ConsoleRequestAdapter = {
  /** 拉取补全上下文资源（失败 reject，由轮询 hook 的 allSettled 容错） */
  async fetchResource(resource: ConsoleResource): Promise<unknown> {
    const path = `${RESOURCE_PATH[resource]}${RESOURCE_QUERY}`;
    const res = await fetch(`${PROXY_BASE}?path=${encodeURIComponent(path)}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  },

  /** 执行请求：永不 reject，非 2xx 与网络错误都包装为 QueryResult */
  async executeQuery({ method, path, body }): Promise<QueryResult> {
    const t0 = performance.now();
    const timeMs = () => Math.round(performance.now() - t0);
    try {
      // fetch 的 GET 请求不允许携带 body
      const hasBody = Boolean(body) && method !== "GET" && method !== "HEAD";
      const res = await fetch(
        `${PROXY_BASE}?path=${encodeURIComponent(path)}&method=${method}`,
        {
          method: "POST",
          body: hasBody ? body : undefined,
          headers: hasBody ? { "Content-Type": "application/json" } : undefined,
        },
      );
      const data = await res.text();
      return {
        statusCode: res.status,
        statusText: res.statusText,
        timeMs: timeMs(),
        data,
      };
    } catch (err) {
      return {
        statusCode: 0,
        statusText: "Network Error",
        timeMs: timeMs(),
        data: String(err),
      };
    }
  },
};

/**
 * console proxy mock 分发核心（纯函数，无框架依赖）
 *
 * 供两端共享：
 * - demo：console-mock.vite.ts（vite dev server 中间件）
 * - 主应用：mock/console-proxy.ts（umi mock 约定）
 *
 * 接口约定：
 * - 资源接口（组装查询条件，5s 轮询）：path = _mapping / _aliases / _template
 * - 查询执行接口：path = .security（及任意 ES 风格路径）
 * - path 参数值本身可携带 query（如 "_mapping?pretty=false"），统一在此剥除
 */
import mappingData from "./data/mapping.json";
import aliasesData from "./data/aliases.json";
import templateData from "./data/template.json";
import securityData from "./data/security.json";

/** mock 响应结构：HTTP 状态码 + 响应体 */
export interface MockResponse {
  status: number;
  payload: unknown;
}

/** 尝试用严格 JSON 解析请求体（仅用于制造 400 场景，mock 不依赖 json5） */
function isValidJson(body: string): boolean {
  if (!body || !body.trim()) return true;
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

/**
 * 按 path 分发 mock 响应
 * @param rawPath 代理路径原值（可含 "?pretty=false" 之类后缀，可带前导 /）
 * @param method HTTP 方法（默认 GET）
 * @param body 请求体原文（POST 等场景）
 */
export function respondForPath(
  rawPath: string,
  method = "GET",
  body?: string,
): MockResponse {
  // 剥除 query 与前导斜杠，得到纯路径
  const path = rawPath.split("?")[0].replace(/^\//, "");

  // 写请求携带非法 JSON body：返回 ES parsing_exception（可测的红色状态）
  // 放在所有路径分发之前，保证任意端点的写请求都能触发 400
  if ((method === "POST" || method === "PUT") && !isValidJson(body ?? "")) {
    return {
      status: 400,
      payload: {
        error: {
          root_cause: [
            {
              type: "parsing_exception",
              reason: "request body 不是一个合法的 JSON",
            },
          ],
          type: "parsing_exception",
          status: 400,
        },
      },
    };
  }

  // 资源接口：组装查询条件的三个固定端点
  if (path === "_mapping") return { status: 200, payload: mappingData };
  if (path === "_aliases") return { status: 200, payload: aliasesData };
  if (path === "_template") return { status: 200, payload: templateData };

  // 查询执行接口：.security
  if (path === ".security" || path === ".security/_search") {
    return { status: 200, payload: securityData };
  }

  // 其余 _search 请求：返回通用空结果
  if (path.endsWith("_search")) {
    return {
      status: 200,
      payload: {
        took: 3,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: { total: { value: 0 }, max_score: null, hits: [] },
      },
    };
  }

  // 兜底：通用写响应
  return { status: 200, payload: { acknowledged: true } };
}

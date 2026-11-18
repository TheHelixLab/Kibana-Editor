/**
 * umi mock 入口（主应用 Umi Max 4 约定：mock/ 目录默认导出路由表）
 *
 * 迁移方式：把整个 mock/ 目录拷入主应用即可生效（umi dev 自动启用）。
 * 说明：umi 按路径匹配（query 不参与匹配），GET/POST 两条都要注册。
 */
import { respondForPath } from "./es-mock-server";

/** 从请求中取出代理路径与真实 HTTP 方法 */
function resolve(req: {
  query?: Record<string, unknown>;
  method?: string;
  body?: unknown;
}) {
  const path = String(req.query?.path ?? "");
  // 适配层约定：真实方法走 query 的 method 参数（与 Kibana 代理协议对齐），兜底用请求自身方法
  const method = String(req.query?.method ?? req.method ?? "GET").toUpperCase();
  // body 可能已被 umi 解析为对象，转回字符串供校验
  const body =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
  return { path, method, body };
}

export default {
  "GET /api/console/proxy": (req: any, res: any) => {
    const { path, method, body } = resolve(req);
    const { status, payload } = respondForPath(path, method, body);
    res.status(status).json(payload);
  },
  "POST /api/console/proxy": (req: any, res: any) => {
    const { path, method, body } = resolve(req);
    const { status, payload } = respondForPath(path, method, body);
    res.status(status).json(payload);
  },
};

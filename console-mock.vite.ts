/**
 * demo 专用 vite 插件：在 dev server 上挂载 /api/console/proxy mock 中间件
 * 复用 mock/es-mock-server.ts 的分发逻辑（与主应用 umi mock 共享同一份数据）
 */
import type { Plugin } from "vite";
import { respondForPath } from "./mock/es-mock-server";

/** POST body 收集上限（1MB，防异常请求撑爆内存） */
const MAX_BODY_SIZE = 1024 * 1024;

export function consoleMockPlugin(): Plugin {
  return {
    name: "console-mock",
    configureServer(server) {
      server.middlewares.use("/api/console/proxy", (req, res) => {
        // 中间件挂载后 req.url 已剥去 /api/console/proxy 前缀
        const url = new URL(req.url ?? "/", "http://localhost");
        const path = url.searchParams.get("path") ?? "";
        // 真实方法走 query 的 method 参数（与适配层约定对齐），兜底用请求自身方法
        const method = (
          url.searchParams.get("method") ??
          req.method ??
          "GET"
        ).toUpperCase();

        // connect 不解析 body，手动收集数据块
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_BODY_SIZE) chunks.push(chunk);
        });
        req.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const { status, payload } = respondForPath(path, method, body);
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.statusCode = status;
          res.end(JSON.stringify(payload));
        });
      });
    },
  };
}

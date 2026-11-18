/**
 * 补全上下文轮询 hook（默认 5 秒一次）
 *
 * 设计与 Kibana AutocompleteInfo.retrieve 一致：
 * - setTimeout 自调度（本轮响应到达后再排下一轮），而非 setInterval（避免请求耗时挤占间隔/后台堆积）
 * - Promise.allSettled 三源并发：单源失败保留上一次数据，全失败保留旧快照并暴露 lastError
 * - cleanup 清理定时器 + cancelled 标记（React StrictMode 双挂载安全，最多多打一轮幂等 GET）
 */
import { useEffect, useRef, useState } from "react";
import type { AutocompleteSnapshot, ConsoleRequestAdapter } from "../types";
import { buildSnapshot, EMPTY_SNAPSHOT } from "../entities/buildSnapshot";
import type { SnapshotState } from "../entities/buildSnapshot";

export interface PollingOptions {
  /** 轮询开关，默认 true */
  enabled?: boolean;
  /** 轮询间隔（毫秒），默认 5000 */
  intervalMs?: number;
}

export interface PollingResult {
  snapshot: AutocompleteSnapshot;
  /** 任一轮请求进行中为 true */
  loading: boolean;
  /** 最近一轮三源全失败时的错误（单源失败不产生） */
  lastError: Error | null;
  /** 最近一次成功同步的时间戳（null 表示尚未成功过） */
  lastSyncAt: number | null;
}

export function useAutocompletePolling(
  adapter: ConsoleRequestAdapter,
  { enabled = true, intervalMs = 5000 }: PollingOptions = {},
): PollingResult {
  const [snapshot, setSnapshot] = useState<AutocompleteSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  // 内部状态（索引字段/别名/模板映射）跨轮保留，供失败源复用上一次数据
  const stateRef = useRef<SnapshotState | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let version = 0;

    const poll = async () => {
      setLoading(true);
      // 三源互不拖累：单个失败不影响其它两个入库
      const [mapping, aliases, template] = await Promise.allSettled([
        adapter.fetchResource("mapping"),
        adapter.fetchResource("aliases"),
        adapter.fetchResource("template"),
      ]);
      if (cancelled) return;
      setLoading(false);

      const fulfilled = (r: PromiseSettledResult<unknown>) =>
        r.status === "fulfilled" ? r.value : null;
      const anyFulfilled =
        mapping.status === "fulfilled" ||
        aliases.status === "fulfilled" ||
        template.status === "fulfilled";

      if (anyFulfilled) {
        // 失败源传 null：buildSnapshot 内部复用上一次的对应数据
        const { snapshot: next, state } = buildSnapshot(
          {
            mapping: fulfilled(mapping),
            aliases: fulfilled(aliases),
            template: fulfilled(template),
          },
          ++version,
          stateRef.current,
        );
        stateRef.current = state;
        setSnapshot(next);
        setLastError(null);
        setLastSyncAt(Date.now());
      } else {
        // 三源全失败：保留旧快照，仅暴露错误
        setLastError(new Error("补全上下文三源均不可用"));
      }

      // 自调度下一轮（本轮结束后再排，见文件头说明）
      timer = setTimeout(poll, intervalMs);
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [adapter, enabled, intervalMs]);

  return { snapshot, loading, lastError, lastSyncAt };
}

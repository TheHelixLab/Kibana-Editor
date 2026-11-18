/**
 * 补全上下文快照构建
 *
 * 将 _mapping / _aliases / _template 三个资源接口的原始响应
 * 转换为补全所需的 AutocompleteSnapshot（索引/别名/模板列表 + 字段解析能力）
 */
import type { AutocompleteSnapshot, FieldInfo } from "../types";

/** 递归展开 mapping.properties 为扁平字段列表（沿用 demo flattenFields 逻辑） */
function flattenFields(properties: unknown, parent = ""): FieldInfo[] {
  const fields: FieldInfo[] = [];
  const entries = Object.entries(
    (properties ?? {}) as Record<string, Record<string, unknown>>,
  );
  for (const [key, value] of entries) {
    const path = parent ? `${parent}.${key}` : key;
    if (value && typeof value === "object" && "properties" in value) {
      fields.push(...flattenFields(value.properties, path));
    } else {
      fields.push({ path, type: String(value?.type ?? "unknown") });
    }
  }
  return fields;
}

/** 通配表达式转正则：仅 * 为通配，其余字符转义 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** 快照内部状态：索引 → 字段 / 别名 → 索引映射 / 模板（含名称，供源失败时整体复用） */
export interface SnapshotState {
  indexFieldMap: Map<string, FieldInfo[]>;
  aliasToIndices: Map<string, string[]>;
  templates: { name: string; patterns: RegExp[]; fields: FieldInfo[] }[];
}

/** 由三源数据构建内部状态（任一源为 null 时跳过该源，保留已有数据由调用方合并） */
function buildState(input: {
  mapping: unknown;
  aliases: unknown;
  template: unknown;
}): SnapshotState {
  const state: SnapshotState = {
    indexFieldMap: new Map(),
    aliasToIndices: new Map(),
    templates: [],
  };

  // _mapping：Record<索引, { mappings: { properties } }>
  const mapping = (input.mapping ?? {}) as Record<string, any>;
  for (const [index, value] of Object.entries(mapping)) {
    state.indexFieldMap.set(
      index,
      flattenFields(value?.mappings?.properties),
    );
  }

  // _aliases：Record<索引, { aliases: Record<别名, {}> }>
  const aliases = (input.aliases ?? {}) as Record<string, any>;
  for (const [index, value] of Object.entries(aliases)) {
    const aliasNames = Object.keys(value?.aliases ?? {});
    for (const alias of aliasNames) {
      const list = state.aliasToIndices.get(alias) ?? [];
      list.push(index);
      state.aliasToIndices.set(alias, list);
    }
  }

  // _template：Record<模板名, { index_patterns: string[], mappings?: { properties } }>
  const template = (input.template ?? {}) as Record<string, any>;
  for (const [name, value] of Object.entries(template)) {
    const patterns = (Array.isArray(value?.index_patterns)
      ? value.index_patterns
      : []).map(globToRegExp);
    state.templates.push({
      name,
      patterns,
      fields: flattenFields(value?.mappings?.properties),
    });
  }

  return state;
}

/** 空快照（轮询尚未成功时的初始值） */
export const EMPTY_SNAPSHOT: AutocompleteSnapshot = {
  version: 0,
  indices: [],
  aliases: [],
  templates: [],
  resolveIndices: () => [],
  getFields: () => [],
};

/**
 * 构建快照
 * @param input 三源数据，失败源传 null（跳过该源，不清空已有索引信息）
 * @param prevState 上一次的内部状态（源失败时复用其数据）
 */
export function buildSnapshot(
  input: {
    mapping: unknown;
    aliases: unknown;
    template: unknown;
  },
  version: number,
  prevState?: SnapshotState,
): { snapshot: AutocompleteSnapshot; state: SnapshotState } {
  // 失败源为 null：沿用上一次状态里的数据
  const state = buildState({
    mapping: input.mapping ?? undefined,
    aliases: input.aliases ?? undefined,
    template: input.template ?? undefined,
  });
  if (input.mapping == null && prevState) {
    state.indexFieldMap = prevState.indexFieldMap;
  }
  if (input.aliases == null && prevState) {
    state.aliasToIndices = prevState.aliasToIndices;
  }
  if (input.template == null && prevState) {
    state.templates = prevState.templates;
  }

  // 索引列表 = mapping keys ∪ 别名反解出的索引（排序去重）
  const indices = new Set<string>(state.indexFieldMap.keys());
  for (const list of state.aliasToIndices.values()) {
    for (const index of list) indices.add(index);
  }

  const resolveIndices = (token: string): string[] => {
    const result = new Set<string>();
    for (const part of token.split(",")) {
      const name = part.trim();
      if (!name) continue;
      if (state.indexFieldMap.has(name)) {
        // 精确命中索引
        result.add(name);
      } else if (state.aliasToIndices.has(name)) {
        // 精确命中别名 → 反解为索引
        for (const index of state.aliasToIndices.get(name)!) {
          result.add(index);
        }
      } else if (name.includes("*")) {
        // 通配：匹配索引名与别名
        const re = globToRegExp(name);
        for (const index of indices) {
          if (re.test(index)) result.add(index);
        }
        for (const [alias, list] of state.aliasToIndices) {
          if (re.test(alias)) {
            for (const index of list) result.add(index);
          }
        }
      }
    }
    return [...result].sort();
  };

  // 字段查询按 token 记忆化（同 token 只算一次）
  const fieldCache = new Map<string, FieldInfo[]>();

  const getFields = (indexToken: string): FieldInfo[] => {
    const cacheKey = indexToken;
    const cached = fieldCache.get(cacheKey);
    if (cached) return cached;

    const matchedIndices = new Set(resolveIndices(indexToken));
    // 空表达式：视为匹配全部索引（body 补全对缺省索引给出整体字段兜底）
    const useAll = indexToken.trim() === "";
    if (useAll) {
      for (const index of indices) matchedIndices.add(index);
    }

    // 索引字段并集
    const merged = new Map<string, FieldInfo>();
    for (const index of matchedIndices) {
      for (const field of state.indexFieldMap.get(index) ?? []) {
        if (!merged.has(field.path)) merged.set(field.path, field);
      }
    }
    // 模板字段并集：index_patterns 匹配 token（或空表达式时全部模板）
    for (const tpl of state.templates) {
      const hit =
        useAll ||
        tpl.patterns.some((re) =>
          [...matchedIndices].some((index) => re.test(index)),
        );
      if (hit) {
        for (const field of tpl.fields) {
          if (!merged.has(field.path)) merged.set(field.path, field);
        }
      }
    }

    const fields = [...merged.values()].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    fieldCache.set(cacheKey, fields);
    return fields;
  };

  const snapshot: AutocompleteSnapshot = {
    version,
    indices: [...indices].sort(),
    aliases: [...state.aliasToIndices.keys()].sort(),
    templates: state.templates.map((tpl) => tpl.name).sort(),
    resolveIndices,
    getFields,
  };

  return { snapshot, state };
}

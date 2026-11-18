/**
 * KibanaTools 组件出口
 *
 * 默认导出组件；具名导出 adapter 与类型，便于主应用按需替换/扩展
 */
export { default } from "./KibanaTools";
export { fetchConsoleAdapter } from "./adapter/fetchAdapter";
export { useAutocompletePolling } from "./hooks/useAutocompletePolling";
export type {
  AutocompleteSnapshot,
  ConsoleMethod,
  ConsoleRequestAdapter,
  ConsoleResource,
  ExecuteInput,
  FieldInfo,
  KibanaToolsProps,
  ParsedConsoleRequest,
  ParseResult,
  QueryResult,
} from "./types";

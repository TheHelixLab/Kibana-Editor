/**
 * 编辑器默认内容：三段示例请求
 * - GET _aliases（资源接口示例，演示 path 携带 query）
 * - GET .security/_search（对齐约定的查询执行接口 path=.security）
 * - POST index_org_attribute_info/_search（业务索引查询，演示 JSON body 补全）
 */
export const DEFAULT_QUERY = `// KibanaTools 示例：Ctrl+Enter 运行光标所在请求
GET _aliases?pretty=false

GET .security/_search
{
  "query": { "match_all": {} },
  "size": 10
}

POST index_org_attribute_info/_search
{
  "query": {
    "bool": {
      "must": [
        { "term": { "authStatus": "1" } }
      ]
    }
  },
  "size": 5
}
`;

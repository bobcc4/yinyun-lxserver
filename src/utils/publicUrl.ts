export const normalizePublicUrl = (value: unknown): string => {
  const text = String(value ?? '').trim()
  if (!text) return ''

  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new Error('公网访问地址必须是完整的 http:// 或 https:// 地址')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('公网访问地址只支持 http:// 或 https://')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('公网访问地址不能包含用户名、密码、查询参数或片段')
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('公网访问地址不能包含 /music、/admin 或其他路径')
  }

  return parsed.origin
}

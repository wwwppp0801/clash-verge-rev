import { dump } from 'js-yaml'
import type { Rule } from 'tauri-plugin-mihomo-api'

import { parseYamlSafe } from './yaml'

export type RuleInsertPosition = 'prepend' | 'before-match' | 'append'

export interface RuleTypeOption {
  name: string
  example?: string
  noResolve?: boolean
  requiresPayload?: boolean
}

export const COMMON_RULE_TYPES: RuleTypeOption[] = [
  { name: 'DOMAIN', example: 'example.com' },
  { name: 'DOMAIN-SUFFIX', example: 'example.com' },
  { name: 'DOMAIN-KEYWORD', example: 'example' },
  { name: 'DOMAIN-REGEX', example: 'example.*' },
  { name: 'IP-CIDR', example: '127.0.0.0/8', noResolve: true },
  { name: 'IP-CIDR6', example: '2620:0:2d0:200::7/32', noResolve: true },
  { name: 'GEOIP', example: 'CN', noResolve: true },
  { name: 'GEOSITE', example: 'youtube' },
  { name: 'IP-ASN', example: '13335', noResolve: true },
  { name: 'IP-SUFFIX', example: '8.8.8.8/24', noResolve: true },
  { name: 'SRC-IP-CIDR', example: '192.168.1.201/32' },
  { name: 'DST-PORT', example: '443' },
  { name: 'SRC-PORT', example: '7777' },
  { name: 'PROCESS-NAME', example: 'curl' },
  { name: 'RULE-SET', example: 'providername', noResolve: true },
  { name: 'MATCH', requiresPayload: false },
]

export const NO_RESOLVE_RULE_TYPES = new Set(
  COMMON_RULE_TYPES.filter((r) => r.noResolve).map((r) => r.name),
)

export const BUILTIN_PROXY_POLICIES = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
] as const

export interface ParsedProfileRule {
  index: number
  raw: string
  type: string
  payload: string
  proxy: string
  noResolve: boolean
  extraParams: string[]
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const splitRuleParts = (raw: string): string[] => {
  const parts: string[] = []
  let current = ''
  let depth = 0

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '(') {
      depth++
      current += ch
    } else if (ch === ')') {
      if (depth > 0) depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current.trim())
  return parts
}

export function normalizeRuleType(type: string): string {
  return type.trim().replace(/-/g, '').toUpperCase()
}

export function getRuntimeRuleType(rule: Rule): string {
  return typeof rule.type === 'string' ? rule.type : rule.type.Unknown
}

export function parseRuleString(
  raw: string,
): Omit<ParsedProfileRule, 'index' | 'raw'> | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const parts = splitRuleParts(trimmed)
  if (parts.length < 2) return null

  const type = parts[0].toUpperCase()
  if (!type) return null

  if (type === 'MATCH') {
    const proxy = parts[1]
    if (!proxy) return null
    return {
      type,
      payload: '',
      proxy,
      noResolve: false,
      extraParams: parts.slice(2).filter(Boolean),
    }
  }

  if (parts.length < 3) return null
  const payload = parts[1]
  const proxy = parts[2]
  if (!proxy) return null

  const rest = parts.slice(3).filter(Boolean)
  const noResolve = rest.some((p) => p.toLowerCase() === 'no-resolve')
  const extraParams = rest.filter((p) => p.toLowerCase() !== 'no-resolve')

  return {
    type,
    payload,
    proxy,
    noResolve,
    extraParams,
  }
}

export function formatRuleString(input: {
  type: string
  payload: string
  proxy: string
  noResolve?: boolean
  extraParams?: string[]
}): string {
  const type = input.type.trim().toUpperCase()
  const payload = input.payload.trim()
  const proxy = input.proxy.trim()
  const extra = (input.extraParams ?? []).map((p) => p.trim()).filter(Boolean)

  if (type === 'MATCH') {
    return [type, proxy, ...extra].join(',')
  }

  const parts = [type, payload, proxy]
  if (input.noResolve) {
    parts.push('no-resolve')
  }
  if (extra.length > 0) {
    parts.push(...extra)
  }
  return parts.join(',')
}

export function parseProfileRules(yamlText: string): ParsedProfileRule[] {
  const doc = parseYamlSafe(yamlText)
  if (!isPlainRecord(doc) || !Array.isArray(doc.rules)) {
    return []
  }

  const result: ParsedProfileRule[] = []
  for (let i = 0; i < doc.rules.length; i++) {
    const item = doc.rules[i]
    if (typeof item !== 'string') continue
    const parsed = parseRuleString(item)
    if (!parsed) continue
    result.push({
      index: i,
      raw: item,
      ...parsed,
    })
  }
  return result
}

export function parseProfileProxyGroups(yamlText: string): string[] {
  const doc = parseYamlSafe(yamlText)
  if (!isPlainRecord(doc) || !Array.isArray(doc['proxy-groups'])) {
    return []
  }

  const names: string[] = []
  const seen = new Set<string>()
  for (const group of doc['proxy-groups']) {
    if (!isPlainRecord(group) || typeof group.name !== 'string') continue
    const name = group.name.trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

const makeMatchKey = (type: string, payload: string, proxy: string): string =>
  `${normalizeRuleType(type)}\0${payload.trim().toLowerCase()}\0${proxy.trim()}`

export function matchRuntimeRulesToProfile(
  runtimeRules: Rule[],
  profileRules: ParsedProfileRule[],
): (ParsedProfileRule | null)[] {
  const buckets = new Map<string, ParsedProfileRule[]>()
  for (const rule of profileRules) {
    const key = makeMatchKey(rule.type, rule.payload, rule.proxy)
    const list = buckets.get(key)
    if (list) {
      list.push(rule)
    } else {
      buckets.set(key, [rule])
    }
  }

  return runtimeRules.map((runtimeRule) => {
    const key = makeMatchKey(
      getRuntimeRuleType(runtimeRule),
      runtimeRule.payload ?? '',
      runtimeRule.proxy ?? '',
    )
    const list = buckets.get(key)
    if (!list || list.length === 0) return null
    return list.shift() ?? null
  })
}

export function addProfileRule(
  yamlText: string,
  ruleString: string,
  position: RuleInsertPosition = 'prepend',
): string {
  const parsed = parseYamlSafe(yamlText)
  const doc: Record<string, unknown> = isPlainRecord(parsed)
    ? { ...parsed }
    : {}
  const rules: unknown[] = Array.isArray(doc.rules) ? [...doc.rules] : []

  if (position === 'prepend') {
    rules.unshift(ruleString)
  } else if (position === 'before-match') {
    const matchIndex = rules.findIndex(
      (item) =>
        typeof item === 'string' &&
        item.trim().toUpperCase().startsWith('MATCH,'),
    )
    if (matchIndex >= 0) {
      rules.splice(matchIndex, 0, ruleString)
    } else {
      rules.push(ruleString)
    }
  } else {
    rules.push(ruleString)
  }

  doc.rules = rules
  return dump(doc, { lineWidth: -1, noRefs: true })
}

export function updateProfileRule(
  yamlText: string,
  ruleIndex: number,
  ruleString: string,
): string {
  const parsed = parseYamlSafe(yamlText)
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.rules)) {
    return yamlText
  }
  if (ruleIndex < 0 || ruleIndex >= parsed.rules.length) {
    return yamlText
  }

  const doc: Record<string, unknown> = { ...parsed }
  const rules = [...parsed.rules]
  rules[ruleIndex] = ruleString
  doc.rules = rules
  return dump(doc, { lineWidth: -1, noRefs: true })
}

export function deleteProfileRule(yamlText: string, ruleIndex: number): string {
  const parsed = parseYamlSafe(yamlText)
  if (!isPlainRecord(parsed) || !Array.isArray(parsed.rules)) {
    return yamlText
  }
  if (ruleIndex < 0 || ruleIndex >= parsed.rules.length) {
    return yamlText
  }

  const doc: Record<string, unknown> = { ...parsed }
  const rules = [...parsed.rules]
  rules.splice(ruleIndex, 1)
  doc.rules = rules
  return dump(doc, { lineWidth: -1, noRefs: true })
}

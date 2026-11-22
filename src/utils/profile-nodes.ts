import { dump } from 'js-yaml'

import { parseYamlSafe } from './yaml'

export type RawProxyNode = Record<string, unknown> & {
  name: string
  type: string
  server?: string
  port?: number | string
}

export const DEFAULT_LOCAL_PROFILE_YAML = `proxies: []
proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - DIRECT
rules:
  - MATCH,PROXY
`

const AUTO_ADD_GROUP_TYPES = new Set(['select', 'url-test', 'fallback'])

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseProfileNodes(yamlText: string): RawProxyNode[] {
  const doc = parseYamlSafe(yamlText)
  if (!isPlainRecord(doc) || !Array.isArray(doc.proxies)) {
    return []
  }

  return doc.proxies.filter(
    (item): item is RawProxyNode =>
      isPlainRecord(item) &&
      typeof item.name === 'string' &&
      item.name.trim().length > 0 &&
      typeof item.type === 'string' &&
      item.type.trim().length > 0,
  )
}

export function upsertProfileNode(
  yamlText: string,
  node: RawProxyNode,
  options: {
    originalName?: string
    addToGroups?: boolean
  } = {},
): string {
  const parsed = parseYamlSafe(yamlText)
  const doc: Record<string, unknown> = isPlainRecord(parsed)
    ? { ...parsed }
    : {}
  const proxies: unknown[] = Array.isArray(doc.proxies) ? [...doc.proxies] : []

  if (options.originalName !== undefined) {
    const index = proxies.findIndex(
      (item) => isPlainRecord(item) && item.name === options.originalName,
    )
    if (index >= 0) {
      const existing = proxies[index] as Record<string, unknown>
      const merged: Record<string, unknown> = { ...existing, ...node }
      for (const [key, val] of Object.entries(merged)) {
        if (val === undefined) {
          delete merged[key]
        }
      }
      proxies[index] = merged
    } else {
      proxies.push(node)
    }

    if (
      options.originalName !== node.name &&
      Array.isArray(doc['proxy-groups'])
    ) {
      doc['proxy-groups'] = doc['proxy-groups'].map((group) => {
        if (!isPlainRecord(group) || !Array.isArray(group.proxies)) {
          return group
        }
        return {
          ...group,
          proxies: group.proxies.map((proxyName) =>
            proxyName === options.originalName ? node.name : proxyName,
          ),
        }
      })
    }
  } else {
    proxies.push(node)

    if (options.addToGroups && Array.isArray(doc['proxy-groups'])) {
      doc['proxy-groups'] = doc['proxy-groups'].map((group) => {
        if (
          !isPlainRecord(group) ||
          typeof group.type !== 'string' ||
          !AUTO_ADD_GROUP_TYPES.has(group.type)
        ) {
          return group
        }
        const groupProxies = Array.isArray(group.proxies)
          ? [...group.proxies]
          : []
        if (!groupProxies.includes(node.name)) {
          groupProxies.push(node.name)
        }
        return {
          ...group,
          proxies: groupProxies,
        }
      })
    }
  }

  doc.proxies = proxies
  return dump(doc, { lineWidth: -1, noRefs: true })
}

export function deleteProfileNode(yamlText: string, nodeName: string): string {
  const parsed = parseYamlSafe(yamlText)
  if (!isPlainRecord(parsed)) {
    return yamlText
  }

  const doc: Record<string, unknown> = { ...parsed }

  if (Array.isArray(doc.proxies)) {
    doc.proxies = doc.proxies.filter(
      (item) => !(isPlainRecord(item) && item.name === nodeName),
    )
  }

  if (Array.isArray(doc['proxy-groups'])) {
    doc['proxy-groups'] = doc['proxy-groups'].map((group) => {
      if (!isPlainRecord(group) || !Array.isArray(group.proxies)) {
        return group
      }
      return {
        ...group,
        proxies: group.proxies.filter((proxyName) => proxyName !== nodeName),
      }
    })
  }

  return dump(doc, { lineWidth: -1, noRefs: true })
}

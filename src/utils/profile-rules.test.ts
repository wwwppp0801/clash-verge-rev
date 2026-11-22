import type { Rule } from 'tauri-plugin-mihomo-api'
import { describe, expect, it } from 'vitest'

import {
  addProfileRule,
  deleteProfileRule,
  formatRuleString,
  matchRuntimeRulesToProfile,
  parseProfileProxyGroups,
  parseProfileRules,
  parseRuleString,
  updateProfileRule,
} from './profile-rules'

const SAMPLE_YAML = `proxies:
  - name: node-a
    type: ss
proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - node-a
      - DIRECT
rules:
  - DOMAIN-SUFFIX,coswift.ai,PROXY
  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
  - MATCH,PROXY
`

describe('profile-rules', () => {
  it('parses and formats standard, no-resolve, logical, and MATCH rules', () => {
    expect(parseRuleString('DOMAIN-SUFFIX,coswift.ai,PROXY')).toEqual({
      type: 'DOMAIN-SUFFIX',
      payload: 'coswift.ai',
      proxy: 'PROXY',
      noResolve: false,
      extraParams: [],
    })

    expect(parseRuleString('IP-CIDR,127.0.0.0/8,DIRECT,no-resolve')).toEqual({
      type: 'IP-CIDR',
      payload: '127.0.0.0/8',
      proxy: 'DIRECT',
      noResolve: true,
      extraParams: [],
    })

    expect(
      parseRuleString('AND,((DOMAIN,baidu.com),(NETWORK,UDP)),REJECT'),
    ).toEqual({
      type: 'AND',
      payload: '((DOMAIN,baidu.com),(NETWORK,UDP))',
      proxy: 'REJECT',
      noResolve: false,
      extraParams: [],
    })

    expect(parseRuleString('MATCH,PROXY')).toEqual({
      type: 'MATCH',
      payload: '',
      proxy: 'PROXY',
      noResolve: false,
      extraParams: [],
    })

    expect(
      formatRuleString({
        type: 'IP-CIDR',
        payload: '10.0.0.0/8',
        proxy: 'DIRECT',
        noResolve: true,
      }),
    ).toBe('IP-CIDR,10.0.0.0/8,DIRECT,no-resolve')

    expect(
      formatRuleString({
        type: 'MATCH',
        payload: '',
        proxy: 'PROXY',
      }),
    ).toBe('MATCH,PROXY')
  })

  it('matches runtime camelCase Mihomo rules to profile YAML rules and ignores non-profile rules', () => {
    const profileRules = parseProfileRules(SAMPLE_YAML)
    const runtimeRules: Rule[] = [
      {
        index: 0,
        size: -1,
        type: 'DomainSuffix',
        payload: 'coswift.ai',
        proxy: 'PROXY',
      },
      {
        index: 1,
        size: -1,
        type: 'Domain',
        payload: 'from-provider.com',
        proxy: 'DIRECT',
      },
      {
        index: 2,
        size: -1,
        type: 'IPCIDR',
        payload: '127.0.0.0/8',
        proxy: 'DIRECT',
      },
      { index: 3, size: -1, type: 'Match', payload: '', proxy: 'PROXY' },
    ]

    const matched = matchRuntimeRulesToProfile(runtimeRules, profileRules)
    expect(matched[0]?.index).toBe(0)
    expect(matched[1]).toBeNull()
    expect(matched[2]?.index).toBe(1)
    expect(matched[2]?.noResolve).toBe(true)
    expect(matched[3]?.index).toBe(2)
  })

  it('adds, updates, and deletes rules while preserving other YAML sections', () => {
    expect(parseProfileProxyGroups(SAMPLE_YAML)).toEqual(['PROXY'])

    const prepended = addProfileRule(
      SAMPLE_YAML,
      'DOMAIN,example.com,DIRECT',
      'prepend',
    )
    expect(parseProfileRules(prepended).map((r) => r.raw)).toEqual([
      'DOMAIN,example.com,DIRECT',
      'DOMAIN-SUFFIX,coswift.ai,PROXY',
      'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
      'MATCH,PROXY',
    ])

    const beforeMatch = addProfileRule(
      SAMPLE_YAML,
      'DOMAIN,before.com,DIRECT',
      'before-match',
    )
    expect(parseProfileRules(beforeMatch).map((r) => r.raw)).toEqual([
      'DOMAIN-SUFFIX,coswift.ai,PROXY',
      'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve',
      'DOMAIN,before.com,DIRECT',
      'MATCH,PROXY',
    ])

    const updated = updateProfileRule(
      SAMPLE_YAML,
      0,
      'DOMAIN-SUFFIX,coswift.ai,DIRECT',
    )
    expect(parseProfileRules(updated)[0].proxy).toBe('DIRECT')
    expect(parseProfileProxyGroups(updated)).toEqual(['PROXY'])

    const deleted = deleteProfileRule(SAMPLE_YAML, 1)
    expect(parseProfileRules(deleted).map((r) => r.raw)).toEqual([
      'DOMAIN-SUFFIX,coswift.ai,PROXY',
      'MATCH,PROXY',
    ])
  })
})

import { AddOutlined, AppsOutlined } from '@mui/icons-material'
import { Badge, Box, Button } from '@mui/material'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BaseEmpty,
  BasePage,
  BaseSearchBox,
  VirtualList,
  type VirtualListHandle,
} from '@/components/base'
import { ScrollTopButton } from '@/components/layout/scroll-top-button'
import { AppRoutingDialog } from '@/components/rule/app-routing-dialog'
import { ProviderButton } from '@/components/rule/provider-button'
import { RuleFormDialog } from '@/components/rule/rule-form-dialog'
import RuleItem from '@/components/rule/rule-item'
import { usePageSearch } from '@/hooks/use-page-search'
import { useProfiles } from '@/hooks/use-profiles'
import { useVerge } from '@/hooks/use-verge'
import { useVisibility } from '@/hooks/use-visibility'
import { useAppRefreshers, useRulesData } from '@/providers/app-data-context'
import {
  enhanceProfiles,
  readProfileFile,
  saveProfileFile,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import getSystem from '@/utils/get-system'
import {
  BUILTIN_PROXY_POLICIES,
  type ParsedProfileRule,
  type RuleInsertPosition,
  addProfileRule,
  deleteProfileRule,
  getRuntimeRuleType,
  matchRuntimeRulesToProfile,
  parseProfileProxyGroups,
  parseProfileRules,
  updateProfileRule,
} from '@/utils/profile-rules'

const RulesPage = () => {
  const { t } = useTranslation()
  const { rules = [] } = useRulesData()
  const { refreshRules, refreshRuleProviders } = useAppRefreshers()
  const { profiles } = useProfiles()
  const { verge } = useVerge()
  const { searchState, match, onSearch } = usePageSearch('rules')
  const virtuosoRef = useRef<VirtualListHandle>(null)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const pageVisible = useVisibility()

  const currentProfile = useMemo(() => {
    const uid = profiles?.current
    if (!uid) return null
    return profiles?.items?.find((item) => item.uid === uid) ?? null
  }, [profiles])

  const currentUid = currentProfile?.uid
  const currentUpdated = currentProfile?.updated
  const loadKey = currentUid ? `${currentUid}:${currentUpdated ?? 0}` : ''

  const [loadedState, setLoadedState] = useState<{
    key: string
    yaml: string
  }>({ key: '', yaml: '' })
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<ParsedProfileRule | null>(null)
  const [appRoutingOpen, setAppRoutingOpen] = useState(false)

  const enabledAppRoutingCount = useMemo(
    () => (verge?.app_routing ?? []).filter((r) => r.enabled).length,
    [verge?.app_routing],
  )
  const system = getSystem()
  const showAppRouting =
    system === 'macos' ||
    system === 'windows' ||
    (verge?.app_routing?.length ?? 0) > 0

  // 页面可见时刷新规则数据：挂载时可见或从隐藏恢复可见各触发一次
  useEffect(() => {
    if (pageVisible) {
      refreshRules()
      refreshRuleProviders()
    }
  }, [refreshRules, refreshRuleProviders, pageVisible])

  useEffect(() => {
    if (!currentUid) return

    let cancelled = false
    const key = `${currentUid}:${currentUpdated ?? 0}`
    void readProfileFile(currentUid)
      .then((content) => {
        if (!cancelled) {
          setLoadedState({ key, yaml: content })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedState({ key, yaml: '' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentUid, currentUpdated])

  const rawYaml =
    currentUid && loadedState.key === loadKey ? loadedState.yaml : ''

  const profileRules = useMemo(() => parseProfileRules(rawYaml), [rawYaml])

  const policyOptions = useMemo(() => {
    const groups = parseProfileProxyGroups(rawYaml)
    const seen = new Set<string>(BUILTIN_PROXY_POLICIES)
    const result: string[] = [...BUILTIN_PROXY_POLICIES]
    for (const group of groups) {
      if (!seen.has(group)) {
        seen.add(group)
        result.push(group)
      }
    }
    return result
  }, [rawYaml])

  const matchedProfileRules = useMemo(
    () => matchRuntimeRulesToProfile(rules, profileRules),
    [rules, profileRules],
  )

  const filteredRules = useMemo(() => {
    const indices: number[] = []
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]
      if (
        match(rule.payload ?? '') ||
        match(getRuntimeRuleType(rule)) ||
        match(rule.proxy ?? '')
      ) {
        indices.push(i)
      }
    }
    return indices
  }, [rules, match])

  const handleScroll = useCallback((e: Event) => {
    setShowScrollTop((e.target as HTMLElement).scrollTop > 100)
  }, [])

  const scrollToTop = () => {
    virtuosoRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openAddDialog = useCallback(() => {
    setEditingRule(null)
    setDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((rule: ParsedProfileRule) => {
    setEditingRule(rule)
    setDialogOpen(true)
  }, [])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setEditingRule(null)
  }, [])

  const handleSubmitRule = useLockFn(
    async (data: {
      ruleString: string
      position: RuleInsertPosition
      editingIndex?: number
    }) => {
      if (!currentUid) return
      setSaving(true)
      try {
        const latestYaml = await readProfileFile(currentUid).catch(
          () => rawYaml,
        )
        const nextYaml =
          data.editingIndex !== undefined
            ? updateProfileRule(latestYaml, data.editingIndex, data.ruleString)
            : addProfileRule(latestYaml, data.ruleString, data.position)

        await mutate(() => saveProfileFile(currentUid, nextYaml), {
          id: `save-profile-file:${currentUid}`,
          errorNotice: false,
        })
        await mutate(() => enhanceProfiles(), {
          id: 'enhance-profiles',
          errorNotice: false,
        })
        setLoadedState({ key: loadKey, yaml: nextYaml })
        await refreshRules()
        closeDialog()
        showNotice.success(
          data.editingIndex !== undefined
            ? 'rules.feedback.notifications.crud.ruleUpdated'
            : 'rules.feedback.notifications.crud.ruleAdded',
        )
      } catch (err) {
        showNotice.error(err, 3000)
      } finally {
        setSaving(false)
      }
    },
  )

  const handleDeleteRule = useLockFn(async (ruleIndex: number) => {
    if (!currentUid) return
    setSaving(true)
    try {
      const latestYaml = await readProfileFile(currentUid).catch(() => rawYaml)
      const nextYaml = deleteProfileRule(latestYaml, ruleIndex)

      await mutate(() => saveProfileFile(currentUid, nextYaml), {
        id: `save-profile-file:${currentUid}`,
        errorNotice: false,
      })
      await mutate(() => enhanceProfiles(), {
        id: 'enhance-profiles',
        errorNotice: false,
      })
      setLoadedState({ key: loadKey, yaml: nextYaml })
      await refreshRules()
      showNotice.success('rules.feedback.notifications.crud.ruleDeleted')
    } catch (err) {
      showNotice.error(err, 3000)
    } finally {
      setSaving(false)
    }
  })

  return (
    <BasePage
      full
      title={t('rules.page.title')}
      contentStyle={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddOutlined />}
            disabled={!currentUid || saving}
            onClick={openAddDialog}
          >
            {t('rules.page.actions.addRule')}
          </Button>
          {showAppRouting && (
            <Badge
              badgeContent={enabledAppRoutingCount}
              color="primary"
              invisible={enabledAppRoutingCount === 0}
            >
              <Button
                variant="outlined"
                size="small"
                startIcon={<AppsOutlined />}
                onClick={() => setAppRoutingOpen(true)}
              >
                {t('rules.page.actions.appRouting')}
              </Button>
            </Badge>
          )}
          <ProviderButton />
        </Box>
      }
    >
      <Box
        sx={{
          pt: 1,
          mb: 0.5,
          mx: '10px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <BaseSearchBox
          defaultValue={searchState.text}
          {...searchState}
          onSearch={onSearch}
        />
      </Box>

      {filteredRules && filteredRules.length > 0 ? (
        <>
          <VirtualList
            ref={virtuosoRef}
            count={filteredRules.length}
            estimateSize={40}
            renderItem={(i) => {
              const ruleIndex = filteredRules[i]
              const matchedRule = matchedProfileRules[ruleIndex]
              return (
                <RuleItem
                  value={rules[ruleIndex]}
                  lineNo={ruleIndex + 1}
                  editable={matchedRule !== null}
                  disabled={saving}
                  onEdit={
                    matchedRule ? () => openEditDialog(matchedRule) : undefined
                  }
                  onDelete={
                    matchedRule
                      ? () => handleDeleteRule(matchedRule.index)
                      : undefined
                  }
                />
              )
            }}
            style={{ flex: 1 }}
            onScroll={handleScroll}
          />
          <ScrollTopButton onClick={scrollToTop} show={showScrollTop} />
        </>
      ) : (
        <BaseEmpty />
      )}

      {dialogOpen && (
        <RuleFormDialog
          open={dialogOpen}
          editingRule={editingRule}
          policyOptions={policyOptions}
          saving={saving}
          onClose={closeDialog}
          onSubmit={handleSubmitRule}
        />
      )}

      {appRoutingOpen && (
        <AppRoutingDialog
          open={appRoutingOpen}
          policyOptions={policyOptions}
          onClose={() => setAppRoutingOpen(false)}
          onSaved={refreshRules}
        />
      )}
    </BasePage>
  )
}

export default RulesPage

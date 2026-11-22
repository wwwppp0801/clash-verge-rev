import { AddOutlined, AppsOutlined } from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useVerge } from '@/hooks/use-verge'
import { enhanceProfiles, listInstalledApps } from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'

interface AppRoutingDialogProps {
  open: boolean
  policyOptions: string[]
  onClose: () => void
  onSaved: () => Promise<unknown>
}

interface AppEntry {
  name: string
  path: string
  bundle_id?: string | null
  policy: string
  enabled: boolean
}

type FilterMode = 'all' | 'configured'

function deriveNameFromPath(appPath: string): string {
  const normalized = appPath.replace(/\/+$/, '')
  const segments = normalized.split('/')
  const last = segments[segments.length - 1] || normalized
  return last.endsWith('.app') ? last.slice(0, -4) : last
}

export const AppRoutingDialog = ({
  open,
  policyOptions,
  onClose,
  onSaved,
}: AppRoutingDialogProps) => {
  const { t } = useTranslation()
  const { verge, patchVerge } = useVerge()

  const defaultPolicy = policyOptions[0] ?? 'DIRECT'

  const [installedApps, setInstalledApps] = useState<IInstalledApp[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [customPath, setCustomPath] = useState('')

  const [draftMap, setDraftMap] = useState<Record<string, AppEntry>>(() => {
    const initial: Record<string, AppEntry> = {}
    for (const rule of verge?.app_routing ?? []) {
      initial[rule.path] = {
        name: rule.name,
        path: rule.path,
        bundle_id: rule.bundle_id,
        policy: rule.policy || defaultPolicy,
        enabled: rule.enabled,
      }
    }
    return initial
  })

  useEffect(() => {
    let cancelled = false
    void listInstalledApps()
      .then((apps) => {
        if (!cancelled) {
          setInstalledApps(apps)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          showNotice.error(err, 3000)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const mergedApps = useMemo(() => {
    const byPath = new Map<string, AppEntry>()

    for (const app of installedApps) {
      const existing = draftMap[app.path]
      byPath.set(app.path, {
        name: existing?.name || app.name,
        path: app.path,
        bundle_id: app.bundle_id ?? existing?.bundle_id,
        policy: existing?.policy ?? '',
        enabled: existing?.enabled ?? false,
      })
    }

    for (const entry of Object.values(draftMap)) {
      if (!byPath.has(entry.path)) {
        byPath.set(entry.path, entry)
      }
    }

    return Array.from(byPath.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    )
  }, [installedApps, draftMap])

  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase()
    return mergedApps.filter((app) => {
      if (filterMode === 'configured' && !app.enabled) {
        return false
      }
      if (!q) return true
      return (
        app.name.toLowerCase().includes(q) || app.path.toLowerCase().includes(q)
      )
    })
  }, [mergedApps, search, filterMode])

  const configuredCount = useMemo(
    () => Object.values(draftMap).filter((item) => item.enabled).length,
    [draftMap],
  )

  const handleToggle = (app: AppEntry, checked: boolean) => {
    setDraftMap((prev) => ({
      ...prev,
      [app.path]: {
        name: app.name,
        path: app.path,
        bundle_id: app.bundle_id,
        policy: app.policy || defaultPolicy,
        enabled: checked,
      },
    }))
  }

  const handlePolicyChange = (app: AppEntry, nextPolicy: string) => {
    setDraftMap((prev) => ({
      ...prev,
      [app.path]: {
        name: app.name,
        path: app.path,
        bundle_id: app.bundle_id,
        policy: nextPolicy,
        enabled: true,
      },
    }))
  }

  const handleAddCustomPath = () => {
    const trimmed = customPath.trim()
    if (!trimmed) return
    const name = deriveNameFromPath(trimmed)
    setDraftMap((prev) => ({
      ...prev,
      [trimmed]: {
        name,
        path: trimmed,
        policy: prev[trimmed]?.policy || defaultPolicy,
        enabled: true,
      },
    }))
    setCustomPath('')
  }

  const handleSave = useLockFn(async () => {
    setSaving(true)
    try {
      const rulesToSave: IAppRoutingRule[] = Object.values(draftMap)
        .filter((entry) => entry.enabled && entry.path.trim() && entry.policy)
        .map((entry) => ({
          name: entry.name,
          path: entry.path,
          policy: entry.policy,
          enabled: true,
          ...(entry.bundle_id ? { bundle_id: entry.bundle_id } : {}),
        }))

      await patchVerge({ app_routing: rulesToSave })
      await mutate(() => enhanceProfiles(), {
        id: 'enhance-profiles',
        errorNotice: false,
      })
      await onSaved()
      showNotice.success('rules.feedback.notifications.appRouting.saved')
      onClose()
    } catch (err) {
      showNotice.error(err, 3000)
    } finally {
      setSaving(false)
    }
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AppsOutlined fontSize="small" />
        {t('rules.modals.appRouting.title')}
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Alert severity="info" sx={{ py: 0.5 }}>
            {t('rules.modals.appRouting.info')}
          </Alert>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              fullWidth
              placeholder={t('rules.modals.appRouting.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ToggleButtonGroup
              size="small"
              exclusive
              value={filterMode}
              onChange={(_, value: FilterMode | null) => {
                if (value) setFilterMode(value)
              }}
              sx={{ flexShrink: 0 }}
            >
              <ToggleButton value="all">
                {t('rules.modals.appRouting.filters.all')}
              </ToggleButton>
              <ToggleButton value="configured">
                {`${t('rules.modals.appRouting.filters.configured')} (${configuredCount})`}
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              fullWidth
              placeholder={t('rules.modals.appRouting.customPath.placeholder')}
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddCustomPath()
                }
              }}
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddOutlined />}
              disabled={!customPath.trim()}
              onClick={handleAddCustomPath}
              sx={{ flexShrink: 0, height: 40 }}
            >
              {t('rules.modals.appRouting.customPath.add')}
            </Button>
          </Stack>

          {loading ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.5,
                py: 6,
              }}
            >
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                {t('rules.modals.appRouting.loading')}
              </Typography>
            </Box>
          ) : filteredApps.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="body2" color="text.secondary">
                {t('rules.modals.appRouting.empty')}
              </Typography>
            </Box>
          ) : (
            <List
              dense
              disablePadding
              sx={{
                maxHeight: 380,
                overflowY: 'auto',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              {filteredApps.map((app) => {
                const selectOptions =
                  app.policy && !policyOptions.includes(app.policy)
                    ? [app.policy, ...policyOptions]
                    : policyOptions

                return (
                  <ListItem
                    key={app.path}
                    divider
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      py: 0.75,
                    }}
                  >
                    <ListItemText
                      primary={app.name}
                      secondary={app.path}
                      slotProps={{
                        primary: {
                          variant: 'body2',
                          sx: { fontWeight: app.enabled ? 600 : 400 },
                          noWrap: true,
                        },
                        secondary: {
                          variant: 'caption',
                          noWrap: true,
                        },
                      }}
                      sx={{ minWidth: 0, flex: 1 }}
                    />
                    <Select
                      size="small"
                      displayEmpty
                      value={app.policy}
                      onChange={(e) => handlePolicyChange(app, e.target.value)}
                      sx={{ minWidth: 150, maxWidth: 200 }}
                      renderValue={(selected) =>
                        selected || (
                          <Typography variant="body2" color="text.secondary">
                            {t('rules.modals.appRouting.policyPlaceholder')}
                          </Typography>
                        )
                      }
                    >
                      {selectOptions.map((policy) => (
                        <MenuItem key={policy} value={policy}>
                          {policy}
                        </MenuItem>
                      ))}
                    </Select>
                    <Switch
                      size="small"
                      checked={app.enabled}
                      onChange={(_, checked) => handleToggle(app, checked)}
                    />
                  </ListItem>
                )
              })}
            </List>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('shared.actions.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

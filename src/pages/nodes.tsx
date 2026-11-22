import {
  AddOutlined,
  ContentCopyRounded,
  DeleteOutlined,
  EditOutlined,
  SearchOutlined,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BasePage } from '@/components/base'
import {
  NodeFormDialog,
  type NodeFormMode,
} from '@/components/home/node-form-dialog'
import { useProfiles } from '@/hooks/use-profiles'
import { useAppRefreshers } from '@/providers/app-data-context'
import {
  createProfile,
  enhanceProfiles,
  getProfiles,
  readProfileFile,
  saveProfileFile,
} from '@/services/cmds'
import { mutate } from '@/services/mutate'
import { showNotice } from '@/services/notice-service'
import {
  DEFAULT_LOCAL_PROFILE_YAML,
  type RawProxyNode,
  deleteProfileNode,
  parseProfileNodes,
  upsertProfileNode,
} from '@/utils/profile-nodes'

const getDuplicateNodeName = (baseName: string, existingNames: string[]) => {
  const existingSet = new Set(existingNames)
  const firstCandidate = `${baseName}-copy`
  if (!existingSet.has(firstCandidate)) {
    return firstCandidate
  }
  let index = 2
  while (existingSet.has(`${baseName}-copy-${index}`)) {
    index += 1
  }
  return `${baseName}-copy-${index}`
}

const NodesPage = () => {
  const { t } = useTranslation()
  const theme = useTheme()
  const { current, mutateProfiles, patchProfiles } = useProfiles()
  const { refreshAll } = useAppRefreshers()

  const [loadedState, setLoadedState] = useState<{
    key: string
    yaml: string
  }>({ key: '', yaml: '' })
  const [saving, setSaving] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<NodeFormMode>('add')
  const [editingNode, setEditingNode] = useState<RawProxyNode | null>(null)

  const currentUid = current?.uid
  const currentUpdated = current?.updated
  const loadKey = currentUid ? `${currentUid}:${currentUpdated ?? 0}` : ''

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
      .catch((err) => {
        if (!cancelled) {
          setLoadedState({ key, yaml: '' })
          showNotice.error(err, 3000)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentUid, currentUpdated])

  const loading = Boolean(currentUid) && loadedState.key !== loadKey
  const rawYaml =
    currentUid && loadedState.key === loadKey ? loadedState.yaml : ''

  const nodes = useMemo(() => parseProfileNodes(rawYaml), [rawYaml])
  const existingNames = useMemo(() => nodes.map((n) => n.name), [nodes])

  const filteredNodes = useMemo(() => {
    const query = searchText.trim().toLowerCase()
    if (!query) return nodes
    return nodes.filter((node) => {
      const server = typeof node.server === 'string' ? node.server : ''
      return (
        node.name.toLowerCase().includes(query) ||
        node.type.toLowerCase().includes(query) ||
        server.toLowerCase().includes(query)
      )
    })
  }, [nodes, searchText])

  const openAddDialog = useCallback(() => {
    setDialogMode('add')
    setEditingNode(null)
    setDialogOpen(true)
  }, [])

  const openEditDialog = useCallback((node: RawProxyNode) => {
    setDialogMode('edit')
    setEditingNode(node)
    setDialogOpen(true)
  }, [])

  const openDuplicateDialog = useCallback(
    (node: RawProxyNode) => {
      setDialogMode('duplicate')
      setEditingNode({
        ...node,
        name: getDuplicateNodeName(node.name, existingNames),
      })
      setDialogOpen(true)
    },
    [existingNames],
  )

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setEditingNode(null)
  }, [])

  const handleSubmitNode = useLockFn(
    async (
      node: RawProxyNode,
      options: { originalName?: string; addToGroups: boolean },
    ) => {
      setSaving(true)
      try {
        if (!currentUid) {
          const beforeProfiles = await getProfiles().catch(() => null)
          const existingUids = new Set(
            (beforeProfiles?.items ?? []).map((item) => item.uid),
          )
          const nextYaml = upsertProfileNode(DEFAULT_LOCAL_PROFILE_YAML, node, {
            addToGroups: options.addToGroups,
          })
          await mutate(
            () =>
              createProfile(
                {
                  type: 'local',
                  name: 'Local Profile',
                  desc: '',
                },
                nextYaml,
              ),
            {
              id: 'nodes-create-local-profile',
              errorNotice: false,
            },
          )
          const afterProfiles = await getProfiles()
          const created =
            afterProfiles.items?.find((item) => !existingUids.has(item.uid)) ??
            afterProfiles.items?.[afterProfiles.items.length - 1]
          if (created?.uid) {
            await patchProfiles({ current: created.uid })
            setLoadedState({
              key: `${created.uid}:${created.updated ?? 0}`,
              yaml: nextYaml,
            })
          }
          mutateProfiles()
          refreshAll()
          closeDialog()
          showNotice.success(t('home.components.nodes.messages.nodeAdded'))
          return
        }

        const latestYaml = await readProfileFile(currentUid).catch(
          () => rawYaml,
        )
        const nextYaml = upsertProfileNode(latestYaml, node, options)
        await mutate(() => saveProfileFile(currentUid, nextYaml), {
          id: `save-profile-file:${currentUid}`,
          errorNotice: false,
        })
        await mutate(() => enhanceProfiles(), {
          id: 'enhance-profiles',
          errorNotice: false,
        })
        setLoadedState({ key: loadKey, yaml: nextYaml })
        mutateProfiles()
        refreshAll()
        closeDialog()
        showNotice.success(
          options.originalName
            ? t('home.components.nodes.messages.nodeUpdated')
            : t('home.components.nodes.messages.nodeAdded'),
        )
      } catch (err) {
        showNotice.error(err, 3000)
      } finally {
        setSaving(false)
      }
    },
  )

  const handleDeleteNode = useLockFn(async (nodeName: string) => {
    if (!currentUid) return
    setSaving(true)
    try {
      const latestYaml = await readProfileFile(currentUid).catch(() => rawYaml)
      const nextYaml = deleteProfileNode(latestYaml, nodeName)
      await mutate(() => saveProfileFile(currentUid, nextYaml), {
        id: `save-profile-file:${currentUid}`,
        errorNotice: false,
      })
      await mutate(() => enhanceProfiles(), {
        id: 'enhance-profiles',
        errorNotice: false,
      })
      setLoadedState({ key: loadKey, yaml: nextYaml })
      mutateProfiles()
      refreshAll()
      showNotice.success(t('home.components.nodes.messages.nodeDeleted'))
    } catch (err) {
      showNotice.error(err, 3000)
    } finally {
      setSaving(false)
    }
  })

  return (
    <BasePage
      full
      title={t('home.components.nodes.title')}
      contentStyle={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '12px 16px',
      }}
      header={
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip
            label={nodes.length}
            size="small"
            color="primary"
            variant="outlined"
            sx={{ height: 24, fontSize: 12 }}
          />
          <Button
            variant="contained"
            size="small"
            startIcon={<AddOutlined fontSize="small" />}
            disabled={saving}
            onClick={openAddDialog}
          >
            {t('home.components.nodes.actions.addNode')}
          </Button>
        </Stack>
      }
    >
      {loading ? (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CircularProgress size={28} />
        </Box>
      ) : nodes.length === 0 ? (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('home.components.nodes.labels.empty')}
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <TextField
            size="small"
            fullWidth
            placeholder={t('home.components.nodes.labels.searchPlaceholder')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlined fontSize="small" color="action" />
                  </InputAdornment>
                ),
              },
            }}
          />

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.75,
              pr: 0.5,
            }}
          >
            {filteredNodes.length === 0 ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ textAlign: 'center', py: 4 }}
              >
                {t('home.components.nodes.labels.noMatch')}
              </Typography>
            ) : (
              filteredNodes.map((node) => {
                const endpoint = node.server
                  ? node.port !== undefined
                    ? `${String(node.server)}:${String(node.port)}`
                    : String(node.server)
                  : '-'
                return (
                  <Box
                    key={node.name}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      px: 1.5,
                      py: 0.75,
                      borderRadius: 1.5,
                      border: 1,
                      borderColor: 'divider',
                      backgroundColor: alpha(theme.palette.action.hover, 0.04),
                      '&:hover': {
                        backgroundColor: theme.palette.action.hover,
                      },
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <Chip
                        label={node.type.toUpperCase()}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: 11,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      />
                      <Typography
                        variant="body2"
                        noWrap
                        title={node.name}
                        sx={{ minWidth: 0, fontWeight: 'medium' }}
                      >
                        {node.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        title={endpoint}
                        sx={{ ml: 'auto', mr: 1, flexShrink: 0 }}
                      >
                        {endpoint}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                      <Tooltip
                        title={t('home.components.nodes.actions.duplicateNode')}
                        arrow
                      >
                        <IconButton
                          size="small"
                          disabled={saving}
                          onClick={() => openDuplicateDialog(node)}
                        >
                          <ContentCopyRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('shared.actions.edit')} arrow>
                        <IconButton
                          size="small"
                          disabled={saving}
                          onClick={() => openEditDialog(node)}
                        >
                          <EditOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('shared.actions.delete')} arrow>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={saving}
                          onClick={() => handleDeleteNode(node.name)}
                        >
                          <DeleteOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>
                )
              })
            )}
          </Box>
        </Stack>
      )}

      {dialogOpen && (
        <NodeFormDialog
          key={`${dialogMode}:${editingNode?.name ?? '__new__'}`}
          open={dialogOpen}
          mode={dialogMode}
          initialNode={editingNode}
          existingNames={existingNames}
          saving={saving}
          onClose={closeDialog}
          onSubmit={handleSubmitNode}
        />
      )}
    </BasePage>
  )
}

export default NodesPage

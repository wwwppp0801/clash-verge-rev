import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { showNotice } from '@/services/notice-service'
import type { RawProxyNode } from '@/utils/profile-nodes'
import parseUri from '@/utils/uri-parser'

const SUPPORTED_PROTOCOLS = [
  'ss',
  'vmess',
  'vless',
  'trojan',
  'hysteria2',
  'socks5',
  'http',
] as const

const SS_CIPHERS = [
  'aes-128-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
  'none',
]

const VMESS_CIPHERS = ['auto', 'aes-128-gcm', 'chacha20-poly1305', 'none']

interface NodeFormState {
  name: string
  type: string
  server: string
  port: string
  cipher: string
  password: string
  udp: boolean
  uuid: string
  alterId: string
  flow: string
  tls: boolean
  servername: string
  skipCertVerify: boolean
  network: string
  wsPath: string
  wsHost: string
  grpcServiceName: string
  realityPublicKey: string
  realityShortId: string
  obfs: string
  obfsPassword: string
  username: string
}

const asRecord = (val: unknown): Record<string, unknown> | undefined =>
  typeof val === 'object' && val !== null && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : undefined

const asString = (val: unknown, fallback = ''): string =>
  typeof val === 'string'
    ? val
    : typeof val === 'number'
      ? String(val)
      : fallback

const nodeToFormState = (node?: RawProxyNode | null): NodeFormState => {
  if (!node) {
    return {
      name: '',
      type: 'ss',
      server: '',
      port: '443',
      cipher: 'aes-256-gcm',
      password: '',
      udp: true,
      uuid: '',
      alterId: '0',
      flow: '',
      tls: false,
      servername: '',
      skipCertVerify: false,
      network: 'tcp',
      wsPath: '',
      wsHost: '',
      grpcServiceName: '',
      realityPublicKey: '',
      realityShortId: '',
      obfs: '',
      obfsPassword: '',
      username: '',
    }
  }

  const wsOpts = asRecord(node['ws-opts'])
  const wsHeaders = asRecord(wsOpts?.headers)
  const grpcOpts = asRecord(node['grpc-opts'])
  const realityOpts = asRecord(node['reality-opts'])

  return {
    name: asString(node.name),
    type: asString(node.type, 'ss'),
    server: asString(node.server),
    port: asString(node.port, '443'),
    cipher: asString(
      node.cipher,
      node.type === 'vmess' ? 'auto' : 'aes-256-gcm',
    ),
    password: asString(node.password),
    udp: node.udp !== false,
    uuid: asString(node.uuid),
    alterId: asString(node.alterId, '0'),
    flow: asString(node.flow),
    tls: Boolean(node.tls),
    servername: asString(node.servername ?? node.sni),
    skipCertVerify: Boolean(node['skip-cert-verify']),
    network: asString(node.network, 'tcp'),
    wsPath: asString(wsOpts?.path),
    wsHost: asString(wsHeaders?.Host ?? wsHeaders?.host),
    grpcServiceName: asString(grpcOpts?.['grpc-service-name']),
    realityPublicKey: asString(realityOpts?.['public-key']),
    realityShortId: asString(realityOpts?.['short-id']),
    obfs: asString(node.obfs),
    obfsPassword: asString(node['obfs-password']),
    username: asString(node.username),
  }
}

const formStateToNode = (
  form: NodeFormState,
  parsedExtra?: RawProxyNode | null,
): RawProxyNode => {
  const portNum = Number.parseInt(form.port.trim(), 10)
  const base: RawProxyNode = {
    ...(parsedExtra ?? {}),
    name: form.name.trim(),
    type: form.type,
    server: form.server.trim(),
    port: portNum,
  }

  const trimOrUndef = (v: string) => {
    const trimmed = v.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const applyTransportOpts = (target: RawProxyNode) => {
    target.network = form.network === 'tcp' ? undefined : form.network
    if (form.network === 'ws') {
      const wsOpts: Record<string, unknown> = {}
      const path = trimOrUndef(form.wsPath)
      const host = trimOrUndef(form.wsHost)
      if (path) wsOpts.path = path
      if (host) wsOpts.headers = { Host: host }
      target['ws-opts'] = Object.keys(wsOpts).length > 0 ? wsOpts : undefined
      target['grpc-opts'] = undefined
    } else if (form.network === 'grpc') {
      const serviceName = trimOrUndef(form.grpcServiceName)
      target['grpc-opts'] = serviceName
        ? { 'grpc-service-name': serviceName }
        : undefined
      target['ws-opts'] = undefined
    } else {
      target['ws-opts'] = undefined
      target['grpc-opts'] = undefined
    }
  }

  switch (form.type) {
    case 'ss': {
      base.cipher = form.cipher.trim() || 'aes-256-gcm'
      base.password = form.password
      base.udp = form.udp
      break
    }
    case 'vmess': {
      base.uuid = form.uuid.trim()
      base.alterId = Number.parseInt(form.alterId.trim() || '0', 10) || 0
      base.cipher = form.cipher.trim() || 'auto'
      base.tls = form.tls
      base.servername = trimOrUndef(form.servername)
      base['skip-cert-verify'] = form.skipCertVerify
      applyTransportOpts(base)
      break
    }
    case 'vless': {
      base.uuid = form.uuid.trim()
      base.flow = trimOrUndef(form.flow)
      base.tls = form.tls
      base.servername = trimOrUndef(form.servername)
      base['skip-cert-verify'] = form.skipCertVerify
      const pubKey = trimOrUndef(form.realityPublicKey)
      const shortId = trimOrUndef(form.realityShortId)
      if (pubKey || shortId) {
        const realityOpts: Record<string, unknown> = {}
        if (pubKey) realityOpts['public-key'] = pubKey
        if (shortId) realityOpts['short-id'] = shortId
        base['reality-opts'] = realityOpts
      } else {
        base['reality-opts'] = undefined
      }
      applyTransportOpts(base)
      break
    }
    case 'trojan': {
      base.password = form.password
      base.sni = trimOrUndef(form.servername)
      base['skip-cert-verify'] = form.skipCertVerify
      applyTransportOpts(base)
      break
    }
    case 'hysteria2': {
      base.password = form.password
      base.sni = trimOrUndef(form.servername)
      base['skip-cert-verify'] = form.skipCertVerify
      base.obfs = trimOrUndef(form.obfs)
      base['obfs-password'] = trimOrUndef(form.obfsPassword)
      break
    }
    case 'socks5':
    case 'http': {
      base.username = trimOrUndef(form.username)
      base.password = trimOrUndef(form.password)
      base.tls = form.tls
      base['skip-cert-verify'] = form.skipCertVerify
      break
    }
    default:
      break
  }

  return base
}

export interface NodeFormDialogProps {
  open: boolean
  initialNode?: RawProxyNode | null
  existingNames: string[]
  saving: boolean
  onClose: () => void
  onSubmit: (
    node: RawProxyNode,
    options: { originalName?: string; addToGroups: boolean },
  ) => Promise<void>
}

export const NodeFormDialog = ({
  open,
  initialNode,
  existingNames,
  saving,
  onClose,
  onSubmit,
}: NodeFormDialogProps) => {
  const { t } = useTranslation()
  const isEdit = Boolean(initialNode)

  const [form, setForm] = useState<NodeFormState>(() =>
    nodeToFormState(initialNode),
  )
  const [uriInput, setUriInput] = useState('')
  const [parsedExtra, setParsedExtra] = useState<RawProxyNode | null>(null)
  const [addToGroups, setAddToGroups] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const updateField = <K extends keyof NodeFormState>(
    key: K,
    value: NodeFormState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrorMsg(null)
  }

  const handleParseUri = () => {
    const trimmed = uriInput.trim()
    if (!trimmed) return
    try {
      const parsed = parseUri(trimmed) as unknown as RawProxyNode
      setParsedExtra(parsed)
      setForm(nodeToFormState(parsed))
      setErrorMsg(null)
      showNotice.success(t('home.components.nodes.messages.uriParsed'))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setErrorMsg(t('home.components.nodes.errors.uriParseFailed', { message }))
    }
  }

  const handleSave = async () => {
    const trimmedName = form.name.trim()
    const trimmedServer = form.server.trim()
    const portNum = Number.parseInt(form.port.trim(), 10)

    if (!trimmedName) {
      setErrorMsg(t('home.components.nodes.errors.nameRequired'))
      return
    }
    if (
      existingNames.includes(trimmedName) &&
      trimmedName !== initialNode?.name
    ) {
      setErrorMsg(t('home.components.nodes.errors.nameDuplicate'))
      return
    }
    if (!trimmedServer) {
      setErrorMsg(t('home.components.nodes.errors.serverRequired'))
      return
    }
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setErrorMsg(t('home.components.nodes.errors.portInvalid'))
      return
    }

    const node = formStateToNode(form, isEdit ? null : parsedExtra)
    await onSubmit(node, {
      originalName: initialNode?.name,
      addToGroups,
    })
  }

  const protocolOptions = SUPPORTED_PROTOCOLS.includes(
    form.type as (typeof SUPPORTED_PROTOCOLS)[number],
  )
    ? [...SUPPORTED_PROTOCOLS]
    : [...SUPPORTED_PROTOCOLS, form.type]

  const supportsNetwork =
    form.type === 'vmess' || form.type === 'vless' || form.type === 'trojan'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEdit
          ? t('home.components.nodes.dialog.editTitle')
          : t('home.components.nodes.dialog.addTitle')}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              fullWidth
              label={t('home.components.nodes.dialog.shareUri')}
              placeholder="ss://, vmess://, vless://, trojan://, hy2://..."
              value={uriInput}
              onChange={(e) => setUriInput(e.target.value)}
            />
            <Button
              variant="outlined"
              onClick={handleParseUri}
              disabled={!uriInput.trim()}
              sx={{ flexShrink: 0 }}
            >
              {t('home.components.nodes.dialog.parseUri')}
            </Button>
          </Stack>

          <Divider />

          {errorMsg && (
            <Typography variant="body2" color="error">
              {errorMsg}
            </Typography>
          )}

          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, sm: 7 }}>
              <TextField
                size="small"
                fullWidth
                required
                label={t('home.components.nodes.fields.name')}
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>
                  {t('home.components.nodes.fields.protocol')}
                </InputLabel>
                <Select
                  label={t('home.components.nodes.fields.protocol')}
                  value={form.type}
                  onChange={(e) => {
                    const nextType = e.target.value
                    setForm((prev) => ({
                      ...prev,
                      type: nextType,
                      cipher:
                        nextType === 'vmess'
                          ? 'auto'
                          : nextType === 'ss'
                            ? 'aes-256-gcm'
                            : prev.cipher,
                    }))
                  }}
                >
                  {protocolOptions.map((proto) => (
                    <MenuItem key={proto} value={proto}>
                      {proto.toUpperCase()}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField
                size="small"
                fullWidth
                required
                label={t('home.components.nodes.fields.server')}
                value={form.server}
                onChange={(e) => updateField('server', e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField
                size="small"
                fullWidth
                required
                type="number"
                label={t('home.components.nodes.fields.port')}
                value={form.port}
                onChange={(e) => updateField('port', e.target.value)}
              />
            </Grid>

            {form.type === 'ss' && (
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>
                      {t('home.components.nodes.fields.cipher')}
                    </InputLabel>
                    <Select
                      label={t('home.components.nodes.fields.cipher')}
                      value={
                        SS_CIPHERS.includes(form.cipher)
                          ? form.cipher
                          : 'aes-256-gcm'
                      }
                      onChange={(e) => updateField('cipher', e.target.value)}
                    >
                      {SS_CIPHERS.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label={t('home.components.nodes.fields.password')}
                    value={form.password}
                    onChange={(e) => updateField('password', e.target.value)}
                  />
                </Grid>
                <Grid size={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={form.udp}
                        onChange={(e) => updateField('udp', e.target.checked)}
                      />
                    }
                    label="UDP"
                  />
                </Grid>
              </>
            )}

            {form.type === 'vmess' && (
              <>
                <Grid size={12}>
                  <TextField
                    size="small"
                    fullWidth
                    label="UUID"
                    value={form.uuid}
                    onChange={(e) => updateField('uuid', e.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    size="small"
                    fullWidth
                    type="number"
                    label="Alter ID"
                    value={form.alterId}
                    onChange={(e) => updateField('alterId', e.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>
                      {t('home.components.nodes.fields.cipher')}
                    </InputLabel>
                    <Select
                      label={t('home.components.nodes.fields.cipher')}
                      value={
                        VMESS_CIPHERS.includes(form.cipher)
                          ? form.cipher
                          : 'auto'
                      }
                      onChange={(e) => updateField('cipher', e.target.value)}
                    >
                      {VMESS_CIPHERS.map((c) => (
                        <MenuItem key={c} value={c}>
                          {c}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </>
            )}

            {form.type === 'vless' && (
              <>
                <Grid size={{ xs: 12, sm: 8 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="UUID"
                    value={form.uuid}
                    onChange={(e) => updateField('uuid', e.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Flow"
                    placeholder="xtls-rprx-vision"
                    value={form.flow}
                    onChange={(e) => updateField('flow', e.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Reality Public Key"
                    value={form.realityPublicKey}
                    onChange={(e) =>
                      updateField('realityPublicKey', e.target.value)
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Reality Short ID"
                    value={form.realityShortId}
                    onChange={(e) =>
                      updateField('realityShortId', e.target.value)
                    }
                  />
                </Grid>
              </>
            )}

            {(form.type === 'trojan' || form.type === 'hysteria2') && (
              <Grid size={12}>
                <TextField
                  size="small"
                  fullWidth
                  label={t('home.components.nodes.fields.password')}
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                />
              </Grid>
            )}

            {form.type === 'hysteria2' && (
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Obfs"
                    placeholder="salamander"
                    value={form.obfs}
                    onChange={(e) => updateField('obfs', e.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Obfs Password"
                    value={form.obfsPassword}
                    onChange={(e) =>
                      updateField('obfsPassword', e.target.value)
                    }
                  />
                </Grid>
              </>
            )}

            {(form.type === 'socks5' || form.type === 'http') && (
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label={t('home.components.nodes.fields.username')}
                    value={form.username}
                    onChange={(e) => updateField('username', e.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label={t('home.components.nodes.fields.password')}
                    value={form.password}
                    onChange={(e) => updateField('password', e.target.value)}
                  />
                </Grid>
              </>
            )}

            {(form.type === 'vmess' ||
              form.type === 'vless' ||
              form.type === 'trojan' ||
              form.type === 'hysteria2') && (
              <Grid size={12}>
                <TextField
                  size="small"
                  fullWidth
                  label="SNI / Servername"
                  value={form.servername}
                  onChange={(e) => updateField('servername', e.target.value)}
                />
              </Grid>
            )}

            {supportsNetwork && (
              <>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>
                      {t('home.components.nodes.fields.network')}
                    </InputLabel>
                    <Select
                      label={t('home.components.nodes.fields.network')}
                      value={form.network}
                      onChange={(e) => updateField('network', e.target.value)}
                    >
                      <MenuItem value="tcp">TCP</MenuItem>
                      <MenuItem value="ws">WebSocket (ws)</MenuItem>
                      <MenuItem value="grpc">gRPC</MenuItem>
                      {form.type === 'vmess' && (
                        <MenuItem value="h2">HTTP/2 (h2)</MenuItem>
                      )}
                    </Select>
                  </FormControl>
                </Grid>

                {form.network === 'ws' && (
                  <>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        size="small"
                        fullWidth
                        label="WS Path"
                        placeholder="/"
                        value={form.wsPath}
                        onChange={(e) => updateField('wsPath', e.target.value)}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        size="small"
                        fullWidth
                        label="WS Host"
                        value={form.wsHost}
                        onChange={(e) => updateField('wsHost', e.target.value)}
                      />
                    </Grid>
                  </>
                )}

                {form.network === 'grpc' && (
                  <Grid size={{ xs: 12, sm: 8 }}>
                    <TextField
                      size="small"
                      fullWidth
                      label="gRPC Service Name"
                      value={form.grpcServiceName}
                      onChange={(e) =>
                        updateField('grpcServiceName', e.target.value)
                      }
                    />
                  </Grid>
                )}
              </>
            )}

            {(form.type === 'vmess' ||
              form.type === 'vless' ||
              form.type === 'trojan' ||
              form.type === 'hysteria2' ||
              form.type === 'socks5' ||
              form.type === 'http') && (
              <Grid size={12}>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {(form.type === 'vmess' ||
                    form.type === 'vless' ||
                    form.type === 'socks5' ||
                    form.type === 'http') && (
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={form.tls}
                          onChange={(e) => updateField('tls', e.target.checked)}
                        />
                      }
                      label="TLS"
                    />
                  )}
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={form.skipCertVerify}
                        onChange={(e) =>
                          updateField('skipCertVerify', e.target.checked)
                        }
                      />
                    }
                    label={t('home.components.nodes.fields.skipCertVerify')}
                  />
                </Box>
              </Grid>
            )}
          </Grid>

          {!isEdit && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={addToGroups}
                  onChange={(e) => setAddToGroups(e.target.checked)}
                />
              }
              label={t('home.components.nodes.dialog.addToGroups')}
            />
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

import {
  Autocomplete,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { showNotice } from '@/services/notice-service'
import type { TranslationKey } from '@/types/generated/i18n-keys'
import {
  COMMON_RULE_TYPES,
  NO_RESOLVE_RULE_TYPES,
  type ParsedProfileRule,
  type RuleInsertPosition,
  formatRuleString,
} from '@/utils/profile-rules'

interface RuleFormDialogProps {
  open: boolean
  editingRule: ParsedProfileRule | null
  policyOptions: string[]
  saving: boolean
  onClose: () => void
  onSubmit: (data: {
    ruleString: string
    position: RuleInsertPosition
    editingIndex?: number
  }) => void
}

const RULE_TYPE_OPTIONS = COMMON_RULE_TYPES.map((r) => r.name)

const RULE_TYPE_EXAMPLES: Record<string, string> = Object.fromEntries(
  COMMON_RULE_TYPES.filter((r) => r.example).map((r) => [
    r.name,
    r.example ?? '',
  ]),
)

export const RuleFormDialog = ({
  open,
  editingRule,
  policyOptions,
  saving,
  onClose,
  onSubmit,
}: RuleFormDialogProps) => {
  const { t } = useTranslation()
  const isEditing = editingRule !== null

  const [ruleType, setRuleType] = useState(editingRule?.type ?? 'DOMAIN-SUFFIX')
  const [payload, setPayload] = useState(editingRule?.payload ?? '')
  const [proxy, setProxy] = useState(
    editingRule?.proxy ?? policyOptions[0] ?? 'DIRECT',
  )
  const [noResolve, setNoResolve] = useState(editingRule?.noResolve ?? false)
  const [position, setPosition] = useState<RuleInsertPosition>('prepend')

  const normalizedType = ruleType.trim().toUpperCase()
  const isMatchType = normalizedType === 'MATCH'
  const supportsNoResolve = NO_RESOLVE_RULE_TYPES.has(normalizedType)

  const handleSubmit = () => {
    if (!normalizedType) {
      showNotice.error('rules.modals.ruleForm.validation.typeRequired')
      return
    }
    if (!isMatchType && !payload.trim()) {
      showNotice.error('rules.modals.ruleForm.validation.payloadRequired')
      return
    }
    if (!proxy.trim()) {
      showNotice.error('rules.modals.ruleForm.validation.proxyRequired')
      return
    }

    const ruleString = formatRuleString({
      type: normalizedType,
      payload: isMatchType ? '' : payload,
      proxy,
      noResolve: supportsNoResolve && noResolve,
      extraParams: editingRule?.extraParams,
    })

    onSubmit({
      ruleString,
      position,
      editingIndex: editingRule?.index,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEditing
          ? t('rules.modals.ruleForm.editTitle')
          : t('rules.modals.ruleForm.addTitle')}
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Autocomplete
            freeSolo
            size="small"
            options={RULE_TYPE_OPTIONS}
            value={ruleType}
            onInputChange={(_, value) => {
              setRuleType(value)
              if (!NO_RESOLVE_RULE_TYPES.has(value.trim().toUpperCase())) {
                setNoResolve(false)
              }
            }}
            getOptionLabel={(option) => {
              const key =
                `rules.modals.editor.ruleTypes.${option}` as TranslationKey
              const translated = t(key, { defaultValue: option })
              return translated || option
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('rules.modals.editor.form.labels.type')}
                required
              />
            )}
          />

          {!isMatchType && (
            <TextField
              size="small"
              fullWidth
              required
              label={t('rules.modals.editor.form.labels.content')}
              placeholder={RULE_TYPE_EXAMPLES[normalizedType] ?? ''}
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
          )}

          <Autocomplete
            freeSolo
            size="small"
            options={policyOptions}
            value={proxy}
            onInputChange={(_, value) => setProxy(value)}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('rules.modals.editor.form.labels.proxyPolicy')}
                required
              />
            )}
          />

          {supportsNoResolve && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={noResolve}
                  onChange={(e) => setNoResolve(e.target.checked)}
                />
              }
              label={t('rules.modals.editor.form.toggles.noResolve')}
            />
          )}

          {!isEditing && (
            <FormControl size="small" fullWidth>
              <InputLabel id="rule-insert-position-label">
                {t('rules.modals.ruleForm.position.label')}
              </InputLabel>
              <Select
                labelId="rule-insert-position-label"
                label={t('rules.modals.ruleForm.position.label')}
                value={position}
                onChange={(e) =>
                  setPosition(e.target.value as RuleInsertPosition)
                }
              >
                <MenuItem value="prepend">
                  {t('rules.modals.ruleForm.position.prepend')}
                </MenuItem>
                <MenuItem value="before-match">
                  {t('rules.modals.ruleForm.position.beforeMatch')}
                </MenuItem>
                <MenuItem value="append">
                  {t('rules.modals.ruleForm.position.append')}
                </MenuItem>
              </Select>
            </FormControl>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('shared.actions.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

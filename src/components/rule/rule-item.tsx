import { DeleteOutlined, EditOutlined } from '@mui/icons-material'
import { Box, IconButton, Tooltip, Typography, styled } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { Rule } from 'tauri-plugin-mihomo-api'

const Item = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: '4px 16px',
  color: theme.palette.text.primary,
}))

const COLOR = [
  'primary',
  'secondary',
  'info.main',
  'warning.main',
  'success.main',
]

interface Props {
  value: Rule
  lineNo: number
  editable?: boolean
  disabled?: boolean
  onEdit?: () => void
  onDelete?: () => void
}

const parseColor = (text: string) => {
  if (text === 'REJECT' || text === 'REJECT-DROP') return 'error.main'
  if (text === 'DIRECT') return 'text.primary'

  let sum = 0
  for (let i = 0; i < text.length; i++) {
    sum += text.charCodeAt(i)
  }
  return COLOR[sum % COLOR.length]
}

const RuleItem = (props: Props) => {
  const { value, lineNo, editable, disabled, onEdit, onDelete } = props
  const { t } = useTranslation()

  return (
    <Item sx={{ borderBottom: '1px solid var(--divider-color)' }}>
      <Typography
        color="text.secondary"
        variant="body2"
        sx={{ lineHeight: 2, minWidth: 30, mr: 2.25, textAlign: 'center' }}
      >
        {lineNo}
      </Typography>

      <Box sx={{ userSelect: 'text', flex: 1, minWidth: 0 }}>
        <Typography component="h6" variant="subtitle1" color="text.primary">
          {value.payload || '-'}
        </Typography>

        <Typography
          component="span"
          variant="body2"
          color="text.secondary"
          sx={{ mr: 3, minWidth: 120, display: 'inline-block' }}
        >
          {typeof value.type === 'string' ? value.type : value.type.Unknown}
        </Typography>

        <Typography
          component="span"
          variant="body2"
          color={parseColor(value.proxy)}
        >
          {value.proxy}
        </Typography>
      </Box>

      {editable && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
          <Tooltip title={t('rules.page.actions.editRule')}>
            <span>
              <IconButton
                size="small"
                disabled={disabled}
                onClick={onEdit}
                aria-label={t('rules.page.actions.editRule')}
              >
                <EditOutlined fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('rules.page.actions.deleteRule')}>
            <span>
              <IconButton
                size="small"
                color="error"
                disabled={disabled}
                onClick={onDelete}
                aria-label={t('rules.page.actions.deleteRule')}
              >
                <DeleteOutlined fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      )}
    </Item>
  )
}

export default RuleItem

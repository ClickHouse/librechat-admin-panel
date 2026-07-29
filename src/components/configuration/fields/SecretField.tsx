import { useState } from 'react';
import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { TextField } from './TextField';
import { useLocalize } from '@/hooks';

const ACTION_BUTTON_CLASSES =
  'inline-flex cursor-pointer items-center gap-1 rounded-md border border-(--cui-color-stroke-default) px-1.5 py-1 text-[11px] text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default) focus-visible:outline-1 focus-visible:outline-(--cui-color-outline)';

/**
 * Renders a secret that is set but redacted by the backend: a read-only masked
 * display with an explicit "Replace" flow. The masked value is never editable
 * and never emitted through onChange, so it cannot enter a save payload.
 */
export function SecretField({
  id,
  value,
  maskedValue,
  onChange,
  onCancel,
  hasPendingEdit,
  disabled,
  ...ariaProps
}: t.SecretFieldProps) {
  const localize = useLocalize();
  const [replacing, setReplacing] = useState(false);
  const showInput = replacing || value !== '' || (hasPendingEdit ?? false);
  const fieldName = ariaProps['aria-label'] ?? id;

  if (!showInput) {
    return (
      <div className="flex items-center gap-2">
        <TextField
          id={id}
          value={maskedValue}
          onChange={() => undefined}
          disabled
          aria-label={localize('com_a11y_secret_configured', { name: fieldName })}
        />
        {!disabled && (
          <button
            type="button"
            onClick={() => setReplacing(true)}
            aria-label={localize('com_a11y_secret_replace', { name: fieldName })}
            className={ACTION_BUTTON_CLASSES}
          >
            <Icon name="pencil" size="sm" />
            <span>{localize('com_config_secret_replace')}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <TextField id={id} value={value} onChange={onChange} disabled={disabled} {...ariaProps} />
      {!disabled && (
        <button
          type="button"
          onClick={() => {
            setReplacing(false);
            onCancel();
          }}
          aria-label={localize('com_a11y_secret_cancel_replace', { name: fieldName })}
          className={ACTION_BUTTON_CLASSES}
        >
          <Icon name="cross" size="sm" />
          <span>{localize('com_ui_cancel')}</span>
        </button>
      )}
    </div>
  );
}

import { useState } from 'react';
import type * as t from '@/types';
import { TextField } from './TextField';
import { useLocalize } from '@/hooks';

const ACTION_BUTTON_CLASSES =
  'inline-flex cursor-pointer items-center gap-0.5 text-[11px] text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default)';

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
  disabled,
  ...ariaProps
}: t.SecretFieldProps) {
  const localize = useLocalize();
  const [replacing, setReplacing] = useState(false);
  const showInput = replacing || value !== '';

  if (!showInput) {
    return (
      <div className="flex items-center gap-2">
        <TextField
          id={id}
          value={maskedValue}
          onChange={() => undefined}
          disabled
          aria-label={localize('com_a11y_secret_configured', {
            name: ariaProps['aria-label'] ?? id,
          })}
        />
        {!disabled && (
          <button
            type="button"
            onClick={() => setReplacing(true)}
            className={ACTION_BUTTON_CLASSES}
          >
            {localize('com_config_secret_replace')}
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
          className={ACTION_BUTTON_CLASSES}
        >
          {localize('com_ui_cancel')}
        </button>
      )}
    </div>
  );
}

import { Icon } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { SectionControls } from './SectionControls';
import { SectionHeader } from './SectionHeader';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

export function ConfigRow({
  title,
  description,
  learnMoreUrl,
  badge,
  children,
  disabled,
  hidden,
  fieldId,
  fieldPath,
  previewChangedPaths,
  permissions,
  onResetField,
  isConfigured,
  isDbOverride,
  isTouched,
  isPendingReset,
  defaultHint,
}: t.ConfigRowProps) {
  const localize = useLocalize();
  if (hidden) return null;

  const isChanged = fieldPath && previewChangedPaths?.includes(fieldPath);
  const showReset =
    !isPendingReset &&
    (isDbOverride || isChanged) &&
    fieldPath &&
    !disabled &&
    permissions?.canEdit &&
    onResetField;

  const resetAction = showReset ? (
    <button
      type="button"
      onClick={() => onResetField(fieldPath)}
      aria-label={
        isChanged
          ? localize('com_a11y_remove_override', { name: title })
          : localize('com_a11y_reset_to_default', { name: title })
      }
      className="inline-flex items-center gap-0.5 text-[11px] text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default)"
    >
      <Icon name="refresh" size="sm" />
      <span>{localize('com_ui_reset')}</span>
    </button>
  ) : null;

  const pendingResetHint = isPendingReset ? (
    <span className="text-[11px] font-medium text-(--cui-color-accent-danger)">
      {localize('com_config_pending_reset')}
    </span>
  ) : null;

  const configuredDot =
    isConfigured && !isPendingReset ? (
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-(--cui-color-accent)"
        aria-hidden="true"
      />
    ) : null;

  const defaultHintEl =
    defaultHint != null ? (
      <span className="text-[11px] text-(--cui-color-text-muted)">
        {localize('com_config_default_hint', { value: String(defaultHint) })}
      </span>
    ) : null;

  const hasSubContent = description || resetAction || pendingResetHint || badge;

  return (
    <div
      className={cn(
        'config-row flex w-full gap-6 rounded-md px-2.5 py-2 transition-opacity',
        hasSubContent ? 'items-start' : 'items-center',
        disabled && 'pointer-events-none',
        isPendingReset && 'opacity-50',
        !isPendingReset && !isConfigured && !isTouched && 'opacity-50',
      )}
    >
      <SectionHeader
        title={title}
        description={description}
        learnMoreUrl={learnMoreUrl}
        htmlFor={fieldId}
        titleAdornment={configuredDot}
        subtitle={defaultHintEl}
      >
        {resetAction}
        {pendingResetHint}
        {badge}
      </SectionHeader>
      <SectionControls>{children}</SectionControls>
    </div>
  );
}

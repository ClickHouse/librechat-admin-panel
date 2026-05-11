import { useCallback } from 'react';
import { Badge, Button, Flyout, Icon, IconButton } from '@clickhouse/click-ui';
import type { ReactElement } from 'react';
import type * as t from '@/types';
import { ACTION_BADGE_STATE, ACTION_LABEL_KEY, capabilityLabel, formatTimestamp } from './auditLogUtils';
import { getScopeTypeConfig } from '@/constants';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

interface AuditLogDetailDrawerProps {
  entry: t.AuditLogEntryWithDiff | null;
  open: boolean;
  onClose: () => void;
  onCopyPermalink: () => void;
}

function CopyableMono({ value, ariaLabel }: { value: string; ariaLabel: string }): ReactElement {
  const handleCopy = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value);
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[11px]',
        'text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover)',
        'focus:outline-2 focus:outline-(--cui-color-stroke-focus)',
      )}
    >
      <span>{value}</span>
      <Icon name="copy" size="xs" />
    </button>
  );
}

function DiffList({
  items,
  variant,
  localize,
}: {
  items: readonly string[];
  variant: 'added' | 'removed';
  localize: ReturnType<typeof useLocalize>;
}): ReactElement {
  if (items.length === 0) {
    return (
      <p className="text-xs text-(--cui-color-text-muted)">
        {localize('com_audit_detail_no_changes')}
      </p>
    );
  }
  const state = variant === 'added' ? 'success' : 'danger';
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((cap) => (
        <li key={cap} className="flex flex-col gap-0.5">
          <Badge size="sm" state={state} text={capabilityLabel(cap, localize)} />
          <span className="font-mono text-[10px] text-(--cui-color-text-muted)">{cap}</span>
        </li>
      ))}
    </ul>
  );
}

export function AuditLogDetailDrawer({
  entry,
  open,
  onClose,
  onCopyPermalink,
}: AuditLogDetailDrawerProps): ReactElement | null {
  const localize = useLocalize();

  if (!entry || !open) return null;

  const targetConfig = getScopeTypeConfig(entry.targetPrincipalType);
  const summaryKey =
    entry.action === 'grant_assigned'
      ? 'com_audit_detail_summary_assigned'
      : 'com_audit_detail_summary_removed';

  const before = entry.before ?? [];
  const after = entry.after ?? [];
  const hasDiff = before.length > 0 || after.length > 0;

  return (
    <Flyout
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Flyout.Content
        size="default"
        strategy="fixed"
        align="end"
        showOverlay
        closeOnInteractOutside
        aria-label={localize('com_audit_detail_title')}
        onEscapeKeyDown={() => onClose()}
      >
        <Flyout.Header showClose={false} showSeparator>
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge
                size="sm"
                state={ACTION_BADGE_STATE[entry.action]}
                text={localize(ACTION_LABEL_KEY[entry.action])}
              />
              <span className="text-sm font-semibold text-(--cui-color-text-default)">
                {localize('com_audit_detail_title')}
              </span>
            </div>
            <IconButton
              icon="cross"
              type="ghost"
              size="sm"
              aria-label={localize('com_audit_detail_close')}
              onClick={onClose}
            />
          </div>
        </Flyout.Header>

        <Flyout.Body>
          <div className="flex flex-col gap-5 px-4 py-4">
            <p className="text-sm text-(--cui-color-text-default)">
              {localize(summaryKey, {
                actor: entry.actorName,
                capability: capabilityLabel(entry.capability, localize),
                target: entry.targetName,
              })}
            </p>

            <dl className="flex flex-col gap-3">
              <DetailRow label={localize('com_audit_detail_timestamp')}>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-(--cui-color-text-default)">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <time
                    dateTime={entry.timestamp}
                    className="font-mono text-[11px] text-(--cui-color-text-muted)"
                  >
                    {entry.timestamp}
                  </time>
                </div>
              </DetailRow>

              <DetailRow label={localize('com_audit_detail_actor')}>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-(--cui-color-text-default)">
                    {entry.actorName}
                  </span>
                  <CopyableMono
                    value={entry.actorId}
                    ariaLabel={`Copy ${localize('com_audit_detail_actor')} ID`}
                  />
                </div>
              </DetailRow>

              <DetailRow label={localize('com_audit_detail_target')}>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <Badge
                      size="sm"
                      state="neutral"
                      text={
                        <span className="inline-flex items-center gap-1">
                          <Icon name={targetConfig.icon} size="xs" />
                          {localize(targetConfig.labelKey)}
                        </span>
                      }
                    />
                    <span className="text-sm font-medium text-(--cui-color-text-default)">
                      {entry.targetName}
                    </span>
                  </span>
                  <CopyableMono
                    value={entry.targetPrincipalId}
                    ariaLabel={`Copy ${localize('com_audit_detail_target')} ID`}
                  />
                </div>
              </DetailRow>

              <DetailRow label={localize('com_audit_detail_capability')}>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm text-(--cui-color-text-default)">
                    {capabilityLabel(entry.capability, localize)}
                  </span>
                  <span className="font-mono text-[11px] text-(--cui-color-text-muted)">
                    {entry.capability}
                  </span>
                </div>
              </DetailRow>

              <DetailRow label={localize('com_audit_detail_entry_id')}>
                <CopyableMono
                  value={entry.id}
                  ariaLabel={`Copy ${localize('com_audit_detail_entry_id')}`}
                />
              </DetailRow>
            </dl>

            {hasDiff && (
              <div className="flex flex-col gap-3 border-t border-(--cui-color-stroke-default) pt-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <section className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold tracking-wide text-(--cui-color-text-muted) uppercase">
                      {localize('com_audit_detail_before')}
                    </h3>
                    <DiffList items={before} variant="removed" localize={localize} />
                  </section>
                  <section className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold tracking-wide text-(--cui-color-text-muted) uppercase">
                      {localize('com_audit_detail_after')}
                    </h3>
                    <DiffList items={after} variant="added" localize={localize} />
                  </section>
                </div>
              </div>
            )}
          </div>
        </Flyout.Body>

        <Flyout.Footer>
          <div className="flex items-center justify-end gap-2 px-4 py-3">
            <Button
              type="secondary"
              iconLeft="share"
              label={localize('com_audit_detail_copy_permalink')}
              onClick={onCopyPermalink}
            />
            <Button
              type="primary"
              label={localize('com_audit_detail_close')}
              onClick={onClose}
            />
          </div>
        </Flyout.Footer>
      </Flyout.Content>
    </Flyout>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <dt className="text-xs font-medium tracking-wide text-(--cui-color-text-muted) uppercase">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

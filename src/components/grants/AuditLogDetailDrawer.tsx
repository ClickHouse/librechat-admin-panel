import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Icon, IconButton } from '@clickhouse/click-ui';
import type { ReactElement } from 'react';
import type * as t from '@/types';
import {
  ACTION_BADGE_STATE,
  ACTION_LABEL_KEY,
  capabilityLabel,
  formatTimestamp,
} from './auditLogUtils';
import { getScopeTypeConfig } from '@/constants';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

interface AuditLogDetailDrawerProps {
  entry: t.AuditLogEntryWithDiff | null;
  open: boolean;
  onClose: () => void;
  /** Resolves to `true` when the clipboard write succeeded so the drawer only
   * flips to its "Copied!" affordance after a real success. */
  onCopyPermalink: (entryId: string) => Promise<boolean>;
  /** Render a "no entry found" message instead of the detail body when the
   * deep-linked id couldn't be located (e.g. the entry was purged). */
  notFound?: boolean;
}

function CopyableMono({
  value,
  ariaLabel,
  onCopyFailed,
}: {
  value: string;
  ariaLabel: string;
  onCopyFailed?: () => void;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      onCopyFailed?.();
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      onCopyFailed?.();
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [value, onCopyFailed]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={ariaLabel}
      aria-live="polite"
      className={cn(
        'inline-flex w-fit items-center gap-1 self-start rounded px-1 py-0.5 font-mono text-[11px]',
        'text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover)',
        'focus:outline-2 focus:outline-(--cui-color-stroke-focus)',
        copied && 'text-(--cui-color-feedback-success-foreground)',
      )}
    >
      <span>{value}</span>
      <Icon name={copied ? 'check' : 'copy'} size="xs" />
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
  notFound = false,
}: AuditLogDetailDrawerProps): ReactElement | null {
  const localize = useLocalize();

  // Keep the last non-null entry so the close animation has content to render
  // while Radix Dialog slides the panel out. Without this, unmounting on
  // `entry === null` would cut off the data-state="closed" exit animation.
  const [latestEntry, setLatestEntry] = useState<t.AuditLogEntryWithDiff | null>(entry);
  useEffect(() => {
    if (entry) setLatestEntry(entry);
  }, [entry]);

  // Copied-feedback state for the permalink button.
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);
  const handleCopyPermalinkClick = useCallback(async () => {
    if (!entry) return;
    const ok = await onCopyPermalink(entry.id);
    if (!ok) return;
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [entry, onCopyPermalink]);

  if (notFound) {
    return (
      <Dialog.Root
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            className={cn(
              'fixed inset-0 z-(--z-overlay) bg-black/30 backdrop-blur-[1px]',
              'data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
            )}
          />
          <Dialog.Content
            aria-label={localize('com_audit_detail_title')}
            onEscapeKeyDown={() => onClose()}
            className={cn(
              'fixed top-0 right-0 z-(--z-overlay) flex h-full w-full flex-col bg-(--cui-color-background-panel) shadow-xl sm:w-120',
              'border-l border-(--cui-color-stroke-default)',
              'will-change-transform',
              'data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in',
            )}
          >
            <Dialog.Title className="sr-only">{localize('com_audit_detail_title')}</Dialog.Title>
            <header className="flex items-center justify-between gap-3 border-b border-(--cui-color-stroke-default) px-4 py-3">
              <span className="text-sm font-semibold text-(--cui-color-text-default)">
                {localize('com_audit_detail_title')}
              </span>
              <IconButton
                icon="cross"
                type="ghost"
                size="sm"
                aria-label={localize('com_audit_detail_close')}
                onClick={onClose}
              />
            </header>
            <div className="flex flex-1 items-center justify-center px-4 py-8 text-center">
              <p className="text-sm text-(--cui-color-text-muted)">
                {localize('com_audit_detail_not_found')}
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-(--cui-color-stroke-default) px-4 py-3">
              <Button
                type="primary"
                label={localize('com_audit_detail_close')}
                onClick={onClose}
              />
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  if (!latestEntry) return null;

  const targetConfig = getScopeTypeConfig(latestEntry.targetPrincipalType);
  const summaryKey =
    latestEntry.action === 'grant_assigned'
      ? 'com_audit_detail_summary_assigned'
      : 'com_audit_detail_summary_removed';

  const before = latestEntry.before ?? [];
  const after = latestEntry.after ?? [];
  const hasDiff = before.length > 0 || after.length > 0;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-(--z-overlay) bg-black/30 backdrop-blur-[1px]',
            'data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
          )}
        />
        <Dialog.Content
          aria-label={localize('com_audit_detail_title')}
          onEscapeKeyDown={() => onClose()}
          className={cn(
            'fixed top-0 right-0 z-(--z-overlay) flex h-full w-full flex-col bg-(--cui-color-background-panel) shadow-xl sm:w-120',
            'border-l border-(--cui-color-stroke-default)',
            'will-change-transform',
            'data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in',
          )}
        >
          <Dialog.Title className="sr-only">{localize('com_audit_detail_title')}</Dialog.Title>
          <header className="flex items-center justify-between gap-3 border-b border-(--cui-color-stroke-default) px-4 py-3">
            <div className="flex items-center gap-2">
              <Badge
                size="sm"
                state={ACTION_BADGE_STATE[latestEntry.action]}
                text={localize(ACTION_LABEL_KEY[latestEntry.action])}
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
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-5 px-4 py-4">
              <p className="text-sm text-(--cui-color-text-default)">
                {localize(summaryKey, {
                  actor: latestEntry.actorName,
                  capability: capabilityLabel(latestEntry.capability, localize),
                  target: latestEntry.targetName,
                })}
              </p>

              <dl className="flex flex-col gap-3">
                <DetailRow label={localize('com_audit_detail_timestamp')}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-(--cui-color-text-default)">
                      {formatTimestamp(latestEntry.timestamp)}
                    </span>
                    <CopyableMono
                      value={latestEntry.timestamp}
                      ariaLabel={`Copy ${localize('com_audit_detail_timestamp')}`}
                    />
                  </div>
                </DetailRow>

                <DetailRow label={localize('com_audit_detail_actor')}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-(--cui-color-text-default)">
                      {latestEntry.actorName}
                    </span>
                    <CopyableMono
                      value={latestEntry.actorId}
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
                        {latestEntry.targetName}
                      </span>
                    </span>
                    <CopyableMono
                      value={latestEntry.targetPrincipalId}
                      ariaLabel={`Copy ${localize('com_audit_detail_target')} ID`}
                    />
                  </div>
                </DetailRow>

                <DetailRow label={localize('com_audit_detail_capability')}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm text-(--cui-color-text-default)">
                      {capabilityLabel(latestEntry.capability, localize)}
                    </span>
                    <CopyableMono
                      value={latestEntry.capability}
                      ariaLabel={`Copy ${localize('com_audit_detail_capability')}`}
                    />
                  </div>
                </DetailRow>

                <DetailRow label={localize('com_audit_detail_entry_id')}>
                  <CopyableMono
                    value={latestEntry.id}
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
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-(--cui-color-stroke-default) px-4 py-3">
            <Button
              type="secondary"
              iconLeft={copied ? 'check' : 'share'}
              label={
                copied
                  ? localize('com_audit_detail_copied')
                  : localize('com_audit_detail_copy_permalink')
              }
              onClick={() => void handleCopyPermalinkClick()}
            />
            <Button type="primary" label={localize('com_audit_detail_close')} onClick={onClose} />
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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

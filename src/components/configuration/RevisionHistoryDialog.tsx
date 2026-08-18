import { Badge, Button, Dialog } from '@clickhouse/click-ui';
import { useState } from 'react';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

const CAUSE_KEY: Record<t.ConfigRevisionCause, string> = {
  save: 'com_config_revision_cause_save',
  import: 'com_config_revision_cause_import',
  reset: 'com_config_revision_cause_reset',
  restore: 'com_config_revision_cause_restore',
};

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function RevisionHistoryDialog({
  open,
  loading,
  restoring,
  error,
  revisions,
  onRestore,
  onCancel,
}: t.RevisionHistoryDialogProps) {
  const localize = useLocalize();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pending = revisions.find((revision) => revision.id === pendingId);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setPendingId(null);
          onCancel();
        }
      }}
    >
      <Dialog.Content
        title={localize('com_config_revision_title')}
        showClose
        onClose={() => {
          setPendingId(null);
          onCancel();
        }}
        className="modal-frost"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-(--cui-color-text-muted)">
            {localize('com_config_revision_desc')}
          </p>

          {loading && (
            <p className="text-sm text-(--cui-color-text-muted)">{localize('com_ui_loading')}</p>
          )}

          {!loading && revisions.length === 0 && (
            <p className="text-sm text-(--cui-color-text-muted)">
              {localize('com_config_revision_empty')}
            </p>
          )}

          {!loading && revisions.length > 0 && (
            <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
              {revisions.map((revision) => (
                <div
                  key={revision.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-(--cui-color-stroke-default) px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-(--cui-color-text-default)">
                        {formatTimestamp(revision.createdAt)}
                      </span>
                      <Badge
                        text={localize(CAUSE_KEY[revision.cause])}
                        state="neutral"
                        size="sm"
                      />
                    </div>
                    <p className="truncate text-xs text-(--cui-color-text-muted)">
                      {revision.actorEmail ?? revision.actorId}
                    </p>
                  </div>
                  <Button
                    type="secondary"
                    label={localize('com_config_revision_restore')}
                    onClick={() => setPendingId(revision.id)}
                    disabled={restoring}
                  />
                </div>
              ))}
            </div>
          )}

          {pending && (
            <div className="flex flex-col gap-3 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-muted) px-3 py-3">
              <p className="text-sm text-(--cui-color-text-default)">
                {localize('com_config_revision_confirm', {
                  time: formatTimestamp(pending.createdAt),
                })}
              </p>
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="secondary"
                  label={localize('com_ui_cancel')}
                  onClick={() => setPendingId(null)}
                  disabled={restoring}
                />
                <Button
                  type="danger"
                  label={
                    restoring
                      ? localize('com_config_revision_restoring')
                      : localize('com_config_revision_restore')
                  }
                  iconLeft={restoring ? 'loading-animated' : undefined}
                  onClick={() => onRestore(pending.id)}
                  disabled={restoring}
                />
              </div>
            </div>
          )}

          {error && (
            <div
              className="rounded-lg bg-[rgba(220,38,38,0.1)] px-3 py-2 text-sm font-medium text-(--cui-color-text-danger)"
              role="alert"
            >
              {error}
            </div>
          )}

          {!pending && (
            <div className="flex items-center justify-end">
              <Button type="secondary" label={localize('com_ui_done')} onClick={onCancel} />
            </div>
          )}
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

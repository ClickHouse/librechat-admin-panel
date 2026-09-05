import { Button, Dialog } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

export function VersionConflictDialog({
  open,
  rebasing,
  discarding,
  onRebase,
  onDiscard,
}: t.VersionConflictDialogProps) {
  const localize = useLocalize();
  // Both actions are disabled while either is in flight — not just their own
  // busy flag — so a click on the other button can't start a second,
  // conflicting resolution (e.g. rebase landing new data mid-discard, or
  // vice versa) while the awaited cache refresh from the first is pending.
  const busy = rebasing || discarding;

  return (
    // Deliberately not dismissible via backdrop/escape: the admin must pick
    // rebase or discard, or their next save just 409s again against the same
    // stale frozen version.
    <Dialog open={open} onOpenChange={() => {}}>
      <Dialog.Content title={localize('com_config_version_conflict_title')} className="modal-frost">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-(--cui-color-text-muted)">
            {localize('com_config_version_conflict_body')}
          </p>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="secondary"
              label={localize('com_config_version_conflict_discard')}
              onClick={onDiscard}
              loading={discarding}
              disabled={busy}
            />
            <Button
              type="primary"
              label={
                rebasing
                  ? localize('com_config_version_conflict_rebasing')
                  : localize('com_config_version_conflict_rebase')
              }
              onClick={onRebase}
              disabled={busy}
            />
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}

import { Badge, Icon } from '@clickhouse/click-ui';
import type { AuditAction } from '@librechat/data-schemas';
import type * as t from '@/types';
import { ACTION_BADGE_STATE, capabilityLabel, formatTimestamp } from './auditLogUtils';
import { getScopeTypeConfig } from '@/constants';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

const ACTION_LABEL_KEY: Record<AuditAction, string> = {
  grant_assigned: 'com_audit_action_assigned',
  grant_removed: 'com_audit_action_removed',
};

export function AuditLogRow({ entry, isLast }: t.AuditLogRowProps) {
  const localize = useLocalize();
  const targetConfig = getScopeTypeConfig(entry.targetPrincipalType);

  return (
    <tr
      className={cn(
        'bg-(--cui-color-background-panel)',
        !isLast && 'border-b border-(--cui-color-stroke-default)',
      )}
    >
      <td className="px-4 py-3">
        <Badge
          size="sm"
          state={ACTION_BADGE_STATE[entry.action]}
          text={localize(ACTION_LABEL_KEY[entry.action])}
        />
      </td>
      <td className="px-4 py-3">
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
          <span className="text-(--cui-color-text-default)">{entry.targetName}</span>
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="text-(--cui-color-text-default)">
            {capabilityLabel(entry.capability, localize)}
          </span>
          <span aria-hidden="true" className="text-[10px] text-(--cui-color-text-muted)">
            {entry.capability}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 font-medium text-(--cui-color-text-default)">{entry.actorName}</td>
      <td className="px-4 py-3 text-xs whitespace-nowrap text-(--cui-color-text-muted)">
        <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>
      </td>
    </tr>
  );
}

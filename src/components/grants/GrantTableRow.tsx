import { Badge } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

export function GrantTableRow({ row, isLast, onClick, onKeyDown, rowRef }: t.GrantTableRowProps) {
  const localize = useLocalize();

  return (
    <tr
      ref={rowRef}
      tabIndex={0}
      role="button"
      aria-label={localize('com_cap_edit_title', { name: row.name })}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        'cursor-pointer bg-(--cui-color-background-panel) transition-colors hover:bg-(--cui-color-background-hover) focus-visible:bg-(--cui-color-background-hover) focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--cui-color-outline)',
        !isLast && 'border-b border-(--cui-color-stroke-default)',
      )}
    >
      <td className="px-4 py-3 font-medium text-(--cui-color-text-default)">{row.name}</td>
      <td className="px-4 py-3 text-(--cui-color-text-muted)">
        {row.grantCount === 0
          ? localize('com_grants_no_capabilities')
          : localize('com_grants_capability_count', { count: row.grantCount })}
      </td>
      <td className="px-4 py-3">
        <Badge
          size="sm"
          state={row.isActive ? 'success' : 'danger'}
          text={row.isActive ? localize('com_ui_active') : localize('com_ui_paused')}
        />
      </td>
    </tr>
  );
}

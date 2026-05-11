import { Icon } from '@clickhouse/click-ui';
import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useCallback } from 'react';
import type * as t from '@/types';
import { EmptyState, LoadingState, SearchInput } from '@/components/shared';
import { ACTION_FILTER_LABELS, auditLogToCsv } from './auditLogUtils';
import { auditLogQueryOptions } from '@/server';
import { AuditLogRow } from './AuditLogRow';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

export function AuditLogTab() {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<t.ActionFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const filters = useMemo(
    () => ({
      search: search || undefined,
      action: actionFilter !== 'all' ? actionFilter : undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    }),
    [search, actionFilter, dateFrom, dateTo],
  );

  const { data: entries = [], isLoading } = useQuery(auditLogQueryOptions(filters));

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
  }, []);

  const handleActionFilter = useCallback((filter: t.ActionFilter) => {
    setActionFilter(filter);
  }, []);

  const handleExport = useCallback(() => {
    const csv = auditLogToCsv(entries);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entries]);

  if (isLoading) {
    return <LoadingState />;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto">
      <div className="flex items-center justify-between gap-3">
        <div
          className="flex flex-1 flex-wrap items-center gap-3"
          role="group"
          aria-label={localize('com_a11y_filters')}
        >
          <SearchInput
            value={search}
            onChange={handleSearchChange}
            placeholder={localize('com_ui_search')}
            className="relative min-w-50 flex-1"
          />

          <div className="flex gap-1" role="group" aria-label={localize('com_audit_col_action')}>
            {(['all', 'grant_assigned', 'grant_removed'] as t.ActionFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={actionFilter === filter}
                onClick={() => handleActionFilter(filter)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  actionFilter === filter
                    ? 'bg-(--cui-color-background-active) text-(--cui-color-text-default)'
                    : 'text-(--cui-color-text-muted) hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)',
                )}
              >
                {localize(ACTION_FILTER_LABELS[filter])}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="audit-date-from" className="text-xs text-(--cui-color-text-muted)">
              {localize('com_audit_date_from')}
            </label>
            <input
              id="audit-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors focus-visible:ring-2 focus-visible:ring-(--cui-color-stroke-active) focus-visible:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="audit-date-to" className="text-xs text-(--cui-color-text-muted)">
              {localize('com_audit_date_to')}
            </label>
            <input
              id="audit-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors focus-visible:ring-2 focus-visible:ring-(--cui-color-stroke-active) focus-visible:outline-none"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleExport}
          disabled={entries.length === 0}
          aria-label={localize('com_audit_export_csv')}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover) disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">
            <Icon name="download" size="xs" />
          </span>
          {localize('com_audit_export_csv')}
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto rounded-lg border border-(--cui-color-stroke-default)"
        tabIndex={0}
        role="region"
        aria-label={localize('com_audit_title')}
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{localize('com_audit_title')}</caption>
          <thead className="sticky top-0 z-(--z-sticky)">
            <tr className="border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-muted)">
              <th
                scope="col"
                className="w-24 px-4 py-2.5 font-medium text-(--cui-color-text-muted)"
              >
                {localize('com_audit_col_action')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_audit_col_target')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_audit_col_capability')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_audit_col_actor')}
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 font-medium whitespace-nowrap text-(--cui-color-text-muted)"
              >
                {localize('com_audit_col_timestamp')}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <AuditLogRow key={entry.id} entry={entry} isLast={i === entries.length - 1} />
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState message={localize('com_audit_empty')} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-(--cui-color-text-muted)" aria-live="polite" aria-atomic="true">
        {localize(entries.length === 1 ? 'com_audit_entry_count' : 'com_audit_entry_count_plural', {
          count: entries.length,
        })}
      </p>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Button, ButtonGroup, DatePicker } from '@clickhouse/click-ui';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type * as t from '@/types';
import { EmptyState, LoadingState, ScreenReaderAnnouncer, SearchInput } from '@/components/shared';
import { ACTION_FILTER_LABELS, AUDIT_ACTION_FILTERS, auditLogToCsv } from './auditLogUtils';
import { useAnnouncement, useLocalize } from '@/hooks';
import { auditLogQueryOptions } from '@/server';
import { AuditLogRow } from './AuditLogRow';

function isoDateToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function dateToIsoDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function AuditLogTab() {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<t.ActionFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { message: announcement, announce } = useAnnouncement();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  };

  const handleActionFilter = (filter: string) => {
    setActionFilter(filter as t.ActionFilter);
  };

  const filters = useMemo(
    // UTC-inclusive: dateFrom -> 00:00:00Z, dateTo -> 23:59:59.999Z
    () => ({
      search: debouncedSearch || undefined,
      action: actionFilter !== 'all' ? actionFilter : undefined,
      from: dateFrom ? new Date(`${dateFrom}T00:00:00Z`).toISOString() : undefined,
      to: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined,
    }),
    [debouncedSearch, actionFilter, dateFrom, dateTo],
  );

  const {
    data: entries = [],
    isPending,
    isPlaceholderData,
    isFetching,
    isError,
  } = useQuery(auditLogQueryOptions(filters));

  useEffect(() => {
    if (isFetching) return;
    announce(localize('com_a11y_audit_filter_changed', { count: entries.length }));
  }, [debouncedSearch, actionFilter, dateFrom, dateTo, isFetching, entries.length, announce, localize]);

  const handleExport = useCallback(() => {
    const csv = auditLogToCsv(entries, localize);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [entries, localize]);

  const actionFilterOptions = useMemo(
    () =>
      AUDIT_ACTION_FILTERS.map((filter) => ({
        value: filter,
        label: localize(ACTION_FILTER_LABELS[filter]),
      })),
    [localize],
  );

  const showLoading = isPending && !isPlaceholderData;

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
            ariaLabel={localize('com_audit_search_label')}
            className="relative min-w-50 flex-1"
          />

          <div aria-label={localize('com_audit_filter_action_label')} role="group">
            <ButtonGroup
              options={actionFilterOptions}
              selected={actionFilter}
              onClick={handleActionFilter}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-(--cui-color-text-muted)">
              {localize('com_audit_date_from')}
            </span>
            <DatePicker
              date={isoDateToDate(dateFrom)}
              onSelectDate={(d) => setDateFrom(d ? dateToIsoDate(d) : '')}
              placeholder={localize('com_audit_date_from')}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-(--cui-color-text-muted)">
              {localize('com_audit_date_to')}
            </span>
            <DatePicker
              date={isoDateToDate(dateTo)}
              onSelectDate={(d) => setDateTo(d ? dateToIsoDate(d) : '')}
              placeholder={localize('com_audit_date_to')}
            />
          </div>
        </div>

        <Button
          type="secondary"
          iconLeft="download"
          onClick={handleExport}
          disabled={entries.length === 0}
          label={localize('com_audit_export_csv')}
        />
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
            {showLoading && (
              <tr>
                <td colSpan={5}>
                  <LoadingState />
                </td>
              </tr>
            )}
            {!showLoading && isError && (
              <tr>
                <td colSpan={5}>
                  <EmptyState message={localize('com_audit_error')} />
                </td>
              </tr>
            )}
            {!showLoading && !isError && entries.map((entry, i) => (
              <AuditLogRow key={entry.id} entry={entry} isLast={i === entries.length - 1} />
            ))}
            {!showLoading && !isError && entries.length === 0 && (
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
        {localize('com_audit_entry_count', { count: entries.length })}
      </p>

      <ScreenReaderAnnouncer message={announcement} />
    </div>
  );
}

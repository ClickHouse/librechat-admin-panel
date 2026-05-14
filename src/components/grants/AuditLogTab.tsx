import { PrincipalType } from 'librechat-data-provider';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, DatePicker, Icon, Select, TextField } from '@clickhouse/click-ui';
import type { AuditAction } from '@librechat/data-schemas';
import type { AuditFilters } from '@/server';
import type * as t from '@/types';
import {
  ACTION_BADGE_STATE,
  ACTION_LABEL_KEY,
  capabilityLabel,
  dateToIsoDate,
  formatTimestamp,
  isoDateToDate,
  localDayBoundaryIso,
} from './auditLogUtils';
import {
  AUDIT_LOG_PAGE_SIZE,
  auditLogEntryQueryOptions,
  auditLogQueryOptions,
  exportAuditLogServerFn,
} from '@/server';
import {
  EmptyState,
  LoadingState,
  Pagination,
  ScreenReaderAnnouncer,
  SearchInput,
} from '@/components/shared';
import { useAnnouncement, useDebouncedFilter, useLocalize } from '@/hooks';
import { AuditLogDetailDrawer } from './AuditLogDetailDrawer';
import { getScopeTypeConfig } from '@/constants';
import { cn } from '@/utils';

const AUDIT_ACTIONS: readonly AuditAction[] = ['grant_assigned', 'grant_removed'] as const;
const TARGET_TYPE_OPTIONS: readonly PrincipalType[] = [
  PrincipalType.USER,
  PrincipalType.GROUP,
  PrincipalType.ROLE,
] as const;
/** Radix `Select.Item` cannot use `value=""` (Radix reserves empty string for
 * "no selection"). Use a non-empty sentinel and translate to `''` in state. */
const TARGET_TYPE_ALL = '__all__';

/**
 * Wraps a click-ui DatePicker so only the trigger button is tab-focusable.
 * click-ui renders both a PopoverTrigger button AND an inner readonly input,
 * which produces two stops in the tab order. The input has no exposed `tabIndex`
 * prop, so we reach for the DOM node once after mount and set it to -1. The
 * class hooks the CSS rule that rounds the trigger's focus outline to match
 * the wrapper border.
 */
function DatePickerCell({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const input = node.querySelector('input');
    if (input) input.tabIndex = -1;
  }, []);
  return (
    <div ref={ref} className="audit-date-cell contents">
      {children}
    </div>
  );
}

function downloadCsv(csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AuditLogTab() {
  const localize = useLocalize();
  const navigate = useNavigate({ from: '/grants' });
  const { entryId } = useSearch({ from: '/_app/grants' });

  const [actionFilter, setActionFilter] = useState<AuditAction[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /** Bumped each clear so DatePicker remounts and drops its internal selection state. */
  const [dateResetNonce, setDateResetNonce] = useState(0);
  const [targetTypeFilter, setTargetTypeFilter] = useState<PrincipalType | ''>('');

  const [currentPage, setCurrentPage] = useState(1);
  const { message: announcement, announce } = useAnnouncement();

  const resetToFirstPage = useCallback(() => setCurrentPage(1), []);
  const searchFilter = useDebouncedFilter('', resetToFirstPage);
  const actorIdFilter = useDebouncedFilter('', resetToFirstPage);
  const targetIdFilter = useDebouncedFilter('', resetToFirstPage);
  const capabilityFilter = useDebouncedFilter('', resetToFirstPage);

  const filters = useMemo<Omit<AuditFilters, 'offset' | 'limit'>>(() => {
    const trimmed = searchFilter.debouncedValue.trim();
    return {
      search: trimmed ? trimmed : undefined,
      action: actionFilter.length ? actionFilter : undefined,
      from: localDayBoundaryIso(dateFrom, 'start'),
      to: localDayBoundaryIso(dateTo, 'end'),
      actorId: actorIdFilter.debouncedValue || undefined,
      targetPrincipalId: targetIdFilter.debouncedValue || undefined,
      targetPrincipalType: targetTypeFilter ? targetTypeFilter : undefined,
      capability: capabilityFilter.debouncedValue || undefined,
    };
  }, [
    searchFilter.debouncedValue,
    actionFilter,
    dateFrom,
    dateTo,
    actorIdFilter.debouncedValue,
    targetIdFilter.debouncedValue,
    capabilityFilter.debouncedValue,
    targetTypeFilter,
  ]);

  const { data, isPending, isFetching, isError } = useQuery({
    ...auditLogQueryOptions(currentPage, filters),
    placeholderData: keepPreviousData,
  });

  const pageEntries = useMemo<t.AuditLogEntryWithDiff[]>(() => data?.entries ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / AUDIT_LOG_PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // Reset to page 1 whenever non-debounced filters change. Debounced filter
  // handlers (search, actor id, target id, capability) reset inline within
  // the same setTimeout so the page change lands with the new query key.
  useEffect(() => {
    setCurrentPage(1);
  }, [actionFilter, dateFrom, dateTo, targetTypeFilter]);

  useEffect(() => {
    if (isFetching) return;
    announce(localize('com_a11y_audit_filter_changed', { count: pageEntries.length }));
  }, [
    searchFilter.debouncedValue,
    actionFilter,
    dateFrom,
    dateTo,
    actorIdFilter.debouncedValue,
    targetIdFilter.debouncedValue,
    capabilityFilter.debouncedValue,
    targetTypeFilter,
    isFetching,
    pageEntries.length,
    announce,
    localize,
  ]);

  const entryOnPage = useMemo(
    () => (entryId ? (pageEntries.find((e) => e.id === entryId) ?? null) : null),
    [pageEntries, entryId],
  );

  // Fall back to a direct single-entry fetch when the deep-linked id isn't on
  // the current page (older entries, or arriving via permalink with no filters
  // loaded yet). Skip the round-trip whenever the row is already in `pageEntries`.
  const entryFetch = useQuery({
    ...auditLogEntryQueryOptions(entryId),
    enabled: !!entryId && !entryOnPage,
  });

  const selectedEntry: t.AuditLogEntryWithDiff | null =
    entryOnPage ?? entryFetch.data?.entry ?? null;
  const entryNotFound =
    !!entryId && !entryOnPage && entryFetch.isSuccess && entryFetch.data?.entry === null;

  const openEntry = useCallback(
    (id: string) => {
      void navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, entryId: id }) });
    },
    [navigate],
  );

  const closeEntry = useCallback(() => {
    void navigate({
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        delete next.entryId;
        return next;
      },
    });
  }, [navigate]);

  const handleCopyPermalink = useCallback(
    async (id: string): Promise<boolean> => {
      if (typeof window === 'undefined') return false;
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        announce(localize('com_a11y_copy_failed'));
        return false;
      }
      const url = `${window.location.origin}/grants?tab=audit-log&entryId=${encodeURIComponent(id)}`;
      try {
        await navigator.clipboard.writeText(url);
        return true;
      } catch {
        announce(localize('com_a11y_copy_failed'));
        return false;
      }
    },
    [announce, localize],
  );

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>, id: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEntry(id);
      }
    },
    [openEntry],
  );

  const [exporting, setExporting] = useState(false);

  // Always export via the backend: the client only holds the current page (≤50
  // rows) of a filter that may match thousands. The previous two-path approach
  // silently truncated CSVs whenever the result set fell between the page size
  // and the old `CLIENT_EXPORT_THRESHOLD`.
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const { csv } = await exportAuditLogServerFn({ data: filters });
      downloadCsv(csv);
    } finally {
      setExporting(false);
    }
  }, [filters]);

  const showLoading = isPending && !data;
  const exportLabel = localize('com_audit_export_server');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-4 pr-1 pl-1">
      <div className="flex items-center justify-between gap-3">
        <div
          className="flex flex-1 flex-wrap items-center gap-3"
          role="group"
          aria-label={localize('com_a11y_filters')}
        >
          <SearchInput
            value={searchFilter.value}
            onChange={searchFilter.onChange}
            placeholder={localize('com_ui_search')}
            ariaLabel={localize('com_audit_search_label')}
            className="relative min-w-50 flex-1"
          />

          <div
            aria-label={localize('com_audit_filter_action_label')}
            role="group"
            className="flex items-center gap-1.5"
          >
            {AUDIT_ACTIONS.map((act) => {
              const selected = actionFilter.includes(act);
              return (
                <Button
                  key={act}
                  type={selected ? 'primary' : 'secondary'}
                  label={localize(ACTION_LABEL_KEY[act])}
                  aria-pressed={selected}
                  onClick={() => {
                    setActionFilter((prev) =>
                      prev.includes(act) ? prev.filter((a) => a !== act) : [...prev, act],
                    );
                  }}
                />
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-(--cui-color-text-muted)">
              {localize('com_audit_date_from')}
            </span>
            <DatePickerCell>
              <DatePicker
                key={`from-${dateResetNonce}`}
                date={isoDateToDate(dateFrom)}
                onSelectDate={(d) => setDateFrom(d ? dateToIsoDate(d) : '')}
                placeholder={localize('com_audit_date_from')}
              />
            </DatePickerCell>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-(--cui-color-text-muted)">
              {localize('com_audit_date_to')}
            </span>
            <DatePickerCell>
              <DatePicker
                key={`to-${dateResetNonce}`}
                date={isoDateToDate(dateTo)}
                onSelectDate={(d) => setDateTo(d ? dateToIsoDate(d) : '')}
                placeholder={localize('com_audit_date_to')}
              />
            </DatePickerCell>
          </div>
          {(dateFrom || dateTo) && (
            <Button
              type="danger"
              iconLeft="cross"
              label={localize('com_ui_clear')}
              aria-label={localize('com_a11y_clear_dates')}
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setDateResetNonce((n) => n + 1);
              }}
            />
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <Button
            type="secondary"
            iconLeft="download"
            onClick={() => void handleExport()}
            disabled={total === 0 || exporting}
            loading={exporting}
            label={exportLabel}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label={localize('com_audit_filter_actor_id')}
          value={actorIdFilter.value}
          onChange={actorIdFilter.onChange}
          placeholder={localize('com_audit_filter_actor_id')}
        />
        <TextField
          label={localize('com_audit_filter_target_id')}
          value={targetIdFilter.value}
          onChange={targetIdFilter.onChange}
          placeholder={localize('com_audit_filter_target_id')}
        />
        <div className="select-field-a11y">
          <Select
            label={localize('com_audit_filter_target_type')}
            value={targetTypeFilter === '' ? TARGET_TYPE_ALL : targetTypeFilter}
            onSelect={(v) => setTargetTypeFilter(v === TARGET_TYPE_ALL ? '' : (v as PrincipalType))}
            placeholder={localize('com_ui_all')}
          >
            <Select.Item value={TARGET_TYPE_ALL}>{localize('com_ui_all')}</Select.Item>
            {TARGET_TYPE_OPTIONS.map((pt) => (
              <Select.Item key={pt} value={pt}>
                {pt}
              </Select.Item>
            ))}
          </Select>
        </div>
        <TextField
          label={localize('com_audit_filter_capability')}
          value={capabilityFilter.value}
          onChange={capabilityFilter.onChange}
          placeholder={localize('com_audit_filter_capability')}
        />
      </div>

      <div
        className="overflow-x-auto rounded-lg border border-(--cui-color-stroke-default)"
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
            {!showLoading &&
              !isError &&
              pageEntries.map((entry, i) => (
                <AuditLogTableRow
                  key={entry.id}
                  entry={entry}
                  isLast={i === pageEntries.length - 1}
                  onActivate={() => openEntry(entry.id)}
                  onKeyDown={(e) => handleRowKeyDown(e, entry.id)}
                  localize={localize}
                />
              ))}
            {!showLoading && !isError && pageEntries.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState message={localize('com_audit_empty')} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />

      <div className="flex items-center justify-between gap-3 pb-4">
        <p className="text-xs text-(--cui-color-text-muted)" aria-live="polite" aria-atomic="true">
          {localize('com_audit_entry_count', { count: total })}
        </p>
      </div>

      <ScreenReaderAnnouncer message={announcement} />

      <AuditLogDetailDrawer
        entry={selectedEntry}
        open={selectedEntry !== null || entryNotFound}
        notFound={entryNotFound}
        onClose={closeEntry}
        onCopyPermalink={handleCopyPermalink}
      />
    </div>
  );
}

function AuditLogTableRow({
  entry,
  isLast,
  onActivate,
  onKeyDown,
  localize,
}: {
  entry: t.AuditLogEntryWithDiff;
  isLast: boolean;
  onActivate: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => void;
  localize: ReturnType<typeof useLocalize>;
}) {
  const targetConfig = getScopeTypeConfig(entry.targetPrincipalType);
  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label={localize('com_a11y_audit_row_open')}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      className={cn(
        'cursor-pointer bg-(--cui-color-background-panel) outline-none hover:bg-(--cui-color-background-hover) focus-visible:bg-(--cui-color-background-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--cui-color-outline)',
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

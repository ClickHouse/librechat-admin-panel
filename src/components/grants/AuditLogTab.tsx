import { PrincipalType } from 'librechat-data-provider';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Badge, Button, DatePicker, Icon, Select, TextField } from '@clickhouse/click-ui';
import type { AuditAction } from '@librechat/data-schemas';
import type { AuditFilters } from '@/server';
import type * as t from '@/types';
import {
  ACTION_BADGE_STATE,
  ACTION_LABEL_KEY,
  auditLogToCsv,
  capabilityLabel,
  formatTimestamp,
} from './auditLogUtils';
import {
  EmptyState,
  LoadingState,
  Pagination,
  ScreenReaderAnnouncer,
  SearchInput,
} from '@/components/shared';
import { AUDIT_LOG_PAGE_SIZE, auditLogQueryOptions, exportAuditLogServerFn } from '@/server';
import { AuditLogDetailDrawer } from './AuditLogDetailDrawer';
import { useAnnouncement, useLocalize } from '@/hooks';
import { getScopeTypeConfig } from '@/constants';
import { cn } from '@/utils';

const CLIENT_EXPORT_THRESHOLD = 500;
const AUDIT_ACTIONS: readonly AuditAction[] = ['grant_assigned', 'grant_removed'] as const;
const TARGET_TYPE_OPTIONS: readonly PrincipalType[] = [
  PrincipalType.USER,
  PrincipalType.GROUP,
  PrincipalType.ROLE,
] as const;
/** Radix `Select.Item` cannot use `value=""` (Radix reserves empty string for
 * "no selection"). Use a non-empty sentinel and translate to `''` in state. */
const TARGET_TYPE_ALL = '__all__';

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

/**
 * Wraps a click-ui DatePicker so only the trigger button is tab-focusable.
 * click-ui renders both a PopoverTrigger button AND an inner readonly input,
 * which produces two stops in the tab order. The effect un-tabs the input on
 * every render (in case click-ui re-mounts it) and the class hooks the CSS
 * rule that rounds the trigger's focus outline to match the wrapper border.
 */
function DatePickerCell({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const input = node.querySelector('input');
    if (input) input.tabIndex = -1;
  });
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

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<AuditAction[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /** Bumped each clear so DatePicker remounts and drops its internal selection state. */
  const [dateResetNonce, setDateResetNonce] = useState(0);
  const [actorIdFilter, setActorIdFilter] = useState('');
  const [debouncedActorId, setDebouncedActorId] = useState('');
  const [targetIdFilter, setTargetIdFilter] = useState('');
  const [debouncedTargetId, setDebouncedTargetId] = useState('');
  const [capabilityFilter, setCapabilityFilter] = useState('');
  const [debouncedCapability, setDebouncedCapability] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState<PrincipalType | ''>('');

  const [currentPage, setCurrentPage] = useState(1);
  const { message: announcement, announce } = useAnnouncement();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const actorDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const targetDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const capabilityDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      clearTimeout(searchDebounceRef.current);
      clearTimeout(actorDebounceRef.current);
      clearTimeout(targetDebounceRef.current);
      clearTimeout(capabilityDebounceRef.current);
    };
  }, []);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setCurrentPage(1);
    }, 300);
  };

  const handleActorIdChange = (value: string) => {
    setActorIdFilter(value);
    clearTimeout(actorDebounceRef.current);
    actorDebounceRef.current = setTimeout(() => {
      setDebouncedActorId(value);
      setCurrentPage(1);
    }, 300);
  };

  const handleTargetIdChange = (value: string) => {
    setTargetIdFilter(value);
    clearTimeout(targetDebounceRef.current);
    targetDebounceRef.current = setTimeout(() => {
      setDebouncedTargetId(value);
      setCurrentPage(1);
    }, 300);
  };

  const handleCapabilityChange = (value: string) => {
    setCapabilityFilter(value);
    clearTimeout(capabilityDebounceRef.current);
    capabilityDebounceRef.current = setTimeout(() => {
      setDebouncedCapability(value);
      setCurrentPage(1);
    }, 300);
  };

  const filters = useMemo<Omit<AuditFilters, 'offset' | 'limit'>>(() => {
    const trimmed = debouncedSearch.trim();
    return {
      search: trimmed ? trimmed : undefined,
      action: actionFilter.length ? actionFilter : undefined,
      from: dateFrom ? new Date(`${dateFrom}T00:00:00Z`).toISOString() : undefined,
      to: dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined,
      actorId: debouncedActorId || undefined,
      targetPrincipalId: debouncedTargetId || undefined,
      targetPrincipalType: targetTypeFilter ? targetTypeFilter : undefined,
      capability: debouncedCapability || undefined,
    };
  }, [
    debouncedSearch,
    actionFilter,
    dateFrom,
    dateTo,
    debouncedActorId,
    debouncedTargetId,
    debouncedCapability,
    targetTypeFilter,
  ]);

  const { data, isPending, isFetching, isError } = useQuery({
    ...auditLogQueryOptions(currentPage, filters),
    placeholderData: keepPreviousData,
  });

  const pageEntries: t.AuditLogEntryWithDiff[] = data?.entries ?? [];
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
    debouncedSearch,
    actionFilter,
    dateFrom,
    dateTo,
    debouncedActorId,
    debouncedTargetId,
    debouncedCapability,
    targetTypeFilter,
    isFetching,
    pageEntries.length,
    announce,
    localize,
  ]);

  const selectedEntry = useMemo(
    () => (entryId ? (pageEntries.find((e) => e.id === entryId) ?? null) : null),
    [pageEntries, entryId],
  );

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

  const handleCopyPermalink = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(window.location.href);
  }, []);

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTableRowElement>, id: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEntry(id);
      }
    },
    [openEntry],
  );

  const usingServerExport = total > CLIENT_EXPORT_THRESHOLD;
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (usingServerExport) {
      setExporting(true);
      try {
        const { csv } = await exportAuditLogServerFn({ data: filters });
        downloadCsv(csv);
      } finally {
        setExporting(false);
      }
      return;
    }
    const csv = auditLogToCsv(pageEntries, localize);
    downloadCsv(csv);
  }, [pageEntries, localize, filters, usingServerExport]);

  const showLoading = isPending && !data;
  const exportLabel = usingServerExport
    ? localize('com_audit_export_server')
    : localize('com_audit_export_client');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pt-4 pr-1 pl-1">
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
          value={actorIdFilter}
          onChange={handleActorIdChange}
          placeholder={localize('com_audit_filter_actor_id')}
        />
        <TextField
          label={localize('com_audit_filter_target_id')}
          value={targetIdFilter}
          onChange={handleTargetIdChange}
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
          value={capabilityFilter}
          onChange={handleCapabilityChange}
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
        open={selectedEntry !== null}
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

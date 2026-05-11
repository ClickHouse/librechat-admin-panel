import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  Badge,
  Button,
  CheckboxMultiSelect,
  DatePicker,
  Icon,
  IconButton,
  Select,
  TextField,
} from '@clickhouse/click-ui';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { PrincipalType } from 'librechat-data-provider';
import type { AuditAction } from '@librechat/data-schemas';
import type * as t from '@/types';
import { EmptyState, LoadingState, ScreenReaderAnnouncer, SearchInput } from '@/components/shared';
import {
  ACTION_BADGE_STATE,
  ACTION_LABEL_KEY,
  auditLogToCsv,
  capabilityLabel,
  formatTimestamp,
  parseAuditSearch,
} from './auditLogUtils';
import { getScopeTypeConfig } from '@/constants';
import { useAnnouncement, useLocalize } from '@/hooks';
import { auditLogInfiniteQueryOptions, exportAuditLogServerFn } from '@/server';
import type { AuditFilters } from '@/server/capabilities';
import { AuditLogDetailDrawer } from './AuditLogDetailDrawer';
import { cn } from '@/utils';

const CLIENT_EXPORT_THRESHOLD = 500;
const AUDIT_ACTIONS: readonly AuditAction[] = ['grant_assigned', 'grant_removed'] as const;
const TARGET_TYPE_OPTIONS: readonly PrincipalType[] = [
  PrincipalType.USER,
  PrincipalType.GROUP,
  PrincipalType.ROLE,
] as const;

interface QualifierChip {
  key: keyof t.AuditSearchQualifiers;
  display: string;
  removalToken: RegExp;
}

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

function buildQualifierChips(
  parsed: t.ParsedAuditSearch,
  raw: string,
): QualifierChip[] {
  const chips: QualifierChip[] = [];
  const q = parsed.qualifiers;
  if (q.actor) {
    chips.push({
      key: 'actor',
      display: `actor:${q.actor}`,
      removalToken: /\bactor:(?:"[^"]*"|\S+)\s*/gi,
    });
  }
  if (q.target) {
    chips.push({
      key: 'target',
      display: `target:${q.target}`,
      removalToken: /\btarget:(?:"[^"]*"|\S+)\s*/gi,
    });
  }
  if (q.capability) {
    chips.push({
      key: 'capability',
      display: `capability:${q.capability}`,
      removalToken: /\bcapability:(?:"[^"]*"|\S+)\s*/gi,
    });
  }
  if (q.createdAfter && q.createdAfter === q.createdBefore) {
    chips.push({
      key: 'createdAfter',
      display: `created:${q.createdAfter}`,
      removalToken: /\bcreated:(?!>|<)(?:"[^"]*"|\S+)\s*/gi,
    });
  } else {
    if (q.createdAfter) {
      chips.push({
        key: 'createdAfter',
        display: `created:>${q.createdAfter}`,
        removalToken: /\bcreated:>=?(?:"[^"]*"|\S+)\s*/gi,
      });
    }
    if (q.createdBefore) {
      chips.push({
        key: 'createdBefore',
        display: `created:<${q.createdBefore}`,
        removalToken: /\bcreated:<=?(?:"[^"]*"|\S+)\s*/gi,
      });
    }
  }
  void raw;
  return chips;
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
  const [actorIdFilter, setActorIdFilter] = useState('');
  const [debouncedActorId, setDebouncedActorId] = useState('');
  const [targetIdFilter, setTargetIdFilter] = useState('');
  const [debouncedTargetId, setDebouncedTargetId] = useState('');
  const [capabilityFilter, setCapabilityFilter] = useState('');
  const [debouncedCapability, setDebouncedCapability] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState<PrincipalType | ''>('');
  const [moreOpen, setMoreOpen] = useState(false);

  const { message: announcement, announce } = useAnnouncement();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const actorDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const targetDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const capabilityDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  const previousPageCountRef = useRef(0);

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
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(value), 300);
  };

  const handleActorIdChange = (value: string) => {
    setActorIdFilter(value);
    clearTimeout(actorDebounceRef.current);
    actorDebounceRef.current = setTimeout(() => setDebouncedActorId(value), 300);
  };

  const handleTargetIdChange = (value: string) => {
    setTargetIdFilter(value);
    clearTimeout(targetDebounceRef.current);
    targetDebounceRef.current = setTimeout(() => setDebouncedTargetId(value), 300);
  };

  const handleCapabilityChange = (value: string) => {
    setCapabilityFilter(value);
    clearTimeout(capabilityDebounceRef.current);
    capabilityDebounceRef.current = setTimeout(() => setDebouncedCapability(value), 300);
  };

  const parsed = useMemo(() => parseAuditSearch(debouncedSearch), [debouncedSearch]);
  const qualifierChips = useMemo(
    () => buildQualifierChips(parsed, debouncedSearch),
    [parsed, debouncedSearch],
  );

  const filters = useMemo<Omit<AuditFilters, 'cursor'>>(() => {
    const q = parsed.qualifiers;
    const fromIso =
      q.createdAfter || (dateFrom ? new Date(`${dateFrom}T00:00:00Z`).toISOString() : undefined);
    const toIso =
      q.createdBefore || (dateTo ? new Date(`${dateTo}T23:59:59.999Z`).toISOString() : undefined);
    return {
      search: parsed.freeText.trim() ? parsed.freeText.trim() : undefined,
      action: actionFilter.length ? actionFilter : undefined,
      from: fromIso ? new Date(fromIso).toISOString() : undefined,
      to: toIso ? new Date(toIso).toISOString() : undefined,
      actorId: (q.actor || debouncedActorId || undefined) ?? undefined,
      targetPrincipalId: (q.target || debouncedTargetId || undefined) ?? undefined,
      targetPrincipalType: targetTypeFilter ? targetTypeFilter : undefined,
      capability: (q.capability || debouncedCapability || undefined) ?? undefined,
    };
  }, [
    parsed,
    actionFilter,
    dateFrom,
    dateTo,
    debouncedActorId,
    debouncedTargetId,
    debouncedCapability,
    targetTypeFilter,
  ]);

  const {
    data,
    isPending,
    isPlaceholderData,
    isFetching,
    isFetchingNextPage,
    isError,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery(auditLogInfiniteQueryOptions(filters));

  const entries: t.AuditLogEntryWithDiff[] = useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.entries),
    [data],
  );

  useEffect(() => {
    if (isFetching) return;
    announce(localize('com_a11y_audit_filter_changed', { count: entries.length }));
    previousPageCountRef.current = data?.pages.length ?? 0;
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
    entries.length,
    announce,
    localize,
    data?.pages.length,
  ]);

  useEffect(() => {
    if (!data?.pages) return;
    const newPages = data.pages.length;
    const prev = previousPageCountRef.current;
    if (newPages > prev && prev > 0) {
      const lastPage = data.pages[newPages - 1];
      announce(
        localize('com_a11y_audit_page_loaded', { count: lastPage.entries.length }),
      );
    }
    previousPageCountRef.current = newPages;
  }, [data?.pages, announce, localize]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (!hasNextPage || isFetchingNextPage) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entriesList) => {
        if (entriesList.some((e) => e.isIntersecting)) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, entries.length]);

  const selectedEntry = useMemo(
    () => (entryId ? entries.find((e) => e.id === entryId) ?? null : null),
    [entries, entryId],
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

  const removeQualifier = useCallback((token: RegExp) => {
    setSearch((current) => {
      const next = current.replace(token, '').trim().replace(/\s+/g, ' ');
      clearTimeout(searchDebounceRef.current);
      setDebouncedSearch(next);
      return next;
    });
  }, []);

  const usingServerExport = entries.length > CLIENT_EXPORT_THRESHOLD || hasNextPage;
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
    const csv = auditLogToCsv(entries, localize);
    downloadCsv(csv);
  }, [entries, localize, filters, usingServerExport]);

  const actionOptions = useMemo(
    () =>
      AUDIT_ACTIONS.map((act) => ({
        value: act,
        label: localize(ACTION_LABEL_KEY[act]),
      })),
    [localize],
  );

  const showLoading = isPending && !isPlaceholderData;
  const exportLabel = usingServerExport
    ? localize('com_audit_export_server')
    : localize('com_audit_export_client');

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
            placeholder={localize('com_audit_search_placeholder_qualifiers')}
            ariaLabel={localize('com_audit_search_label')}
            className="relative min-w-50 flex-1"
          />

          <div aria-label={localize('com_audit_filter_action_label')} role="group" className="min-w-40">
            <CheckboxMultiSelect
              options={actionOptions}
              value={actionFilter}
              onSelect={(values) => setActionFilter(values as AuditAction[])}
              selectLabel={localize('com_audit_filter_action_label')}
              placeholder={localize('com_audit_filter_all')}
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

        <div className="flex flex-col items-end gap-1">
          <Button
            type="secondary"
            iconLeft="download"
            onClick={() => void handleExport()}
            disabled={entries.length === 0 || exporting}
            loading={exporting}
            label={exportLabel}
          />
        </div>
      </div>

      {qualifierChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label={localize('com_a11y_filters')}>
          {qualifierChips.map((chip) => (
            <Badge
              key={`${chip.key}:${chip.display}`}
              size="sm"
              state="info"
              text={chip.display}
              dismissible
              onClose={() => removeQualifier(chip.removalToken)}
              aria-label={localize('com_audit_qualifier_remove', { qualifier: chip.display })}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <IconButton
            icon={moreOpen ? 'chevron-down' : 'chevron-right'}
            type="ghost"
            size="sm"
            aria-expanded={moreOpen}
            aria-controls="audit-more-filters"
            aria-label={localize('com_audit_filter_more')}
            onClick={() => setMoreOpen((v) => !v)}
          />
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="text-xs font-medium text-(--cui-color-text-muted) outline-none focus-visible:outline-1 focus-visible:outline-(--cui-color-outline)"
            aria-expanded={moreOpen}
            aria-controls="audit-more-filters"
          >
            {localize('com_audit_filter_more')}
          </button>
        </div>
        {moreOpen && (
          <div
            id="audit-more-filters"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
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
            <div className="select-field-a11y flex flex-col gap-1">
              <span className="text-xs font-medium text-(--cui-color-text-default)">
                {localize('com_audit_filter_target_type')}
              </span>
              <Select
                value={targetTypeFilter}
                onSelect={(v) => setTargetTypeFilter(v === '' ? '' : (v as PrincipalType))}
                placeholder={localize('com_ui_all')}
                aria-label={localize('com_audit_filter_target_type')}
              >
                <Select.Item value="">{localize('com_ui_all')}</Select.Item>
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
        )}
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
            {!showLoading &&
              !isError &&
              entries.map((entry, i) => (
                <AuditLogTableRow
                  key={entry.id}
                  entry={entry}
                  isLast={i === entries.length - 1}
                  onActivate={() => openEntry(entry.id)}
                  onKeyDown={(e) => handleRowKeyDown(e, entry.id)}
                  localize={localize}
                />
              ))}
            {!showLoading && !isError && entries.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState message={localize('com_audit_empty')} />
                </td>
              </tr>
            )}
            {!showLoading && !isError && entries.length > 0 && (
              <tr ref={sentinelRef} aria-hidden="true">
                <td colSpan={5} className="h-1 p-0" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-(--cui-color-text-muted)" aria-live="polite" aria-atomic="true">
          {localize('com_audit_entry_count', { count: entries.length })}
        </p>
        {hasNextPage ? (
          <Button
            type="secondary"
            label={
              isFetchingNextPage
                ? localize('com_audit_loading_more')
                : localize('com_audit_load_more')
            }
            disabled={isFetchingNextPage}
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          />
        ) : (
          entries.length > 0 && (
            <span className="text-xs text-(--cui-color-text-muted)">
              {localize('com_audit_no_more')}
            </span>
          )
        )}
      </div>

      <ScreenReaderAnnouncer message={announcement} />

      {selectedEntry && (
        <AuditLogDetailDrawer
          entry={selectedEntry}
          open={true}
          onClose={closeEntry}
          onCopyPermalink={handleCopyPermalink}
        />
      )}
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
        'cursor-pointer bg-(--cui-color-background-panel) outline-none hover:bg-(--cui-color-background-hover) focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--cui-color-outline)',
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

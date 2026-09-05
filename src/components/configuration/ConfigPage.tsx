import { createPortal } from 'react-dom';
import { Icon } from '@clickhouse/click-ui';
import { PrincipalType } from 'librechat-data-provider';
import { getRouteApi, useBlocker, useNavigate } from '@tanstack/react-router';
import { useState, useMemo, useRef, useCallback, useEffect, startTransition } from 'react';
import { queryOptions, useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  removeFieldProfileValueFn,
  tombstoneFieldProfileValueFn,
  bulkSaveProfileValuesFn,
  getBatchFieldProfilesFn,
  availableScopesOptions,
  getResolvedConfigFn,
  importBaseConfigFn,
  resetBaseConfigFn,
  setBaseConfigActiveFn,
  baseConfigOptions,
  getBaseConfigFn,
  saveBaseConfigFn,
  getLangfuseConnectionFn,
  LANGFUSE_CONNECTION_QUERY_KEY,
  configRevisionsOptions,
  restoreConfigRevisionFn,
} from '@/server';
import {
  flattenObject,
  unflattenObject,
  deepSerializeKVPairs,
  normalizeImportConfig,
  hasConfigCapability,
  getTabsWithPermission,
  collectSecretFieldPaths,
  collectRecordFieldPaths,
  mapSecretPreviewPaths,
  secretPathForPreviewPath,
  stripSecretPreviewValues,
  notifySuccess,
  notifyError,
} from '@/utils';
import {
  applyConfigEdit,
  getBlockingConfigReset,
  applyConfigReset,
  buildSavePayload,
  detectStaleContainerEdits,
  versionedStructuralSharing,
  mergeIndexedArrayEdits,
  partitionScopeResetPaths,
  withLangfuseConfiguredPath,
  installIfNewer,
} from './utils';
import {
  useLocalize,
  useHighlightRef,
  useActiveSection,
  useCapabilities,
  useConfigSession,
} from '@/hooks';
import { CONFIG_TABS, OTHER_TAB, SECTION_META, HIDDEN_SECTIONS } from './configMeta';
import { validateMcpCrossField } from './sections/McpServersRenderer';
import { ScopeSelector, ScopeTriggerButton } from './ScopeSelector';
import { ConfigTableOfContents } from './ConfigTableOfContents';
import { ResetBaseConfigDialog } from './ResetBaseConfigDialog';
import { VersionConflictDialog } from './VersionConflictDialog';
import { refreshBaseConfig } from './queries';
import { RevisionHistoryDialog } from './RevisionHistoryDialog';
import { isVersionConflictError } from '@/server/utils/errors';
import { ConfirmSaveDialog } from './ConfirmSaveDialog';
import { StickyActionBar } from '@/components/shared';
import { ConfigTabContent } from './ConfigTabContent';
import { ImportYamlDialog } from './ImportYamlDialog';
import { ContentToolbar } from './ContentToolbar';
import { SystemCapabilities } from '@/constants';
import { ConfigTabBar } from './ConfigTabBar';
import { InfoBanner } from './InfoBanner';

const routeApi = getRouteApi('/_app/configuration/');
const appRouteApi = getRouteApi('/_app');
const LAST_SCOPE_KEY = 'config:lastScope';

const baseConfigQueryKey = (tenantId: string): string[] => [
  ...baseConfigOptions.queryKey,
  tenantId,
];

function collectFieldPaths(fields: t.SchemaField[], prefix = ''): string[] {
  const paths: string[] = [];
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    if (field.children && field.children.length > 0) {
      paths.push(...collectFieldPaths(field.children, path));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

const profileMapOptions = (fieldPaths: string[], expectedTenantId?: string) =>
  queryOptions({
    queryKey: ['profileMap', expectedTenantId ?? '__pending__', fieldPaths],
    queryFn: () =>
      getBatchFieldProfilesFn({
        data: { paths: fieldPaths, expectedTenantId: expectedTenantId! },
      }).then((r: { profileMap: Record<string, string[]> }) => r.profileMap),
    enabled: fieldPaths.length > 0 && expectedTenantId !== undefined,
    staleTime: 60_000,
  });

function resolvedConfigOptions(scope: t.ScopeSelection, expectedTenantId?: string) {
  const principalType = scope.type === 'SCOPE' ? scope.scope.principalType : null;
  const principalId = scope.type === 'SCOPE' ? scope.scope.principalId : null;
  return queryOptions({
    queryKey: [
      'resolvedConfig',
      expectedTenantId ?? '__pending__',
      principalType,
      principalId,
    ] as const,
    queryFn: () =>
      getResolvedConfigFn({
        data: {
          principalType: principalType!,
          principalId: principalId!,
          expectedTenantId: expectedTenantId!,
        },
      }),
    enabled: principalType != null && principalId != null && expectedTenantId !== undefined,
    staleTime: 60_000,
  });
}

export function ConfigPage({ initialTab, highlightField, initialScope }: t.ConfigPageProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { user } = appRouteApi.useRouteContext();
  const { hasCapability } = useCapabilities();
  const canManageConfig = hasCapability(SystemCapabilities.MANAGE_CONFIGS);
  const canAssignConfigs = hasCapability(SystemCapabilities.ASSIGN_CONFIGS) || canManageConfig;
  const navigate = useNavigate({ from: '/configuration/' });
  const { tree: schemaTree } = routeApi.useLoaderData();

  /** Per-section permission map: { [sectionKey]: { canView, canEdit } } */
  const sectionPermissions = useMemo(() => {
    const perms: Record<string, { canView: boolean; canEdit: boolean }> = {};
    for (const section of schemaTree) {
      perms[section.key] = {
        canView: hasConfigCapability(hasCapability, section.key, 'read'),
        canEdit: hasConfigCapability(hasCapability, section.key, 'manage'),
      };
    }
    return perms;
  }, [schemaTree, hasCapability]);

  const [baseTenantScope, setBaseTenantScope] = useState(user?.tenantId ?? '');
  const currentBaseQueryKey = useMemo(() => baseConfigQueryKey(baseTenantScope), [baseTenantScope]);
  const { data: baseConfigData } = useQuery({
    ...baseConfigOptions,
    queryKey: currentBaseQueryKey,
    structuralSharing: versionedStructuralSharing<Awaited<ReturnType<typeof getBaseConfigFn>>>(
      (value) => value.dbConfigVersion,
      (value) => value.effectiveTenantId,
    ),
    refetchOnMount: 'always',
  });
  useEffect(() => {
    if (
      baseConfigData?.effectiveTenantId === undefined ||
      baseConfigData.effectiveTenantId === baseTenantScope
    ) {
      return;
    }
    const effectiveTenantId = baseConfigData.effectiveTenantId;
    installIfNewer(
      queryClient,
      baseConfigQueryKey(effectiveTenantId),
      baseConfigData,
      (value) => value.dbConfigVersion,
      (value) => value.effectiveTenantId,
    );
    queryClient.removeQueries({ queryKey: currentBaseQueryKey, exact: true });
    setBaseTenantScope(effectiveTenantId);
  }, [baseConfigData, baseTenantScope, currentBaseQueryKey, queryClient]);
  const configValues = baseConfigData?.config ?? null;
  const dbOverrides = baseConfigData?.dbOverrides;
  const configuredFromBase = baseConfigData?.configuredFromBase;
  const schemaDefaults = baseConfigData?.schemaDefaults ?? {};
  const flatBaseline = useMemo(() => flattenObject(configValues ?? {}), [configValues]);
  const {
    baseline: {
      version: frozenBaseVersion,
      tenantId: frozenBaseTenantId,
      value: frozenFlatBaseline,
    },
    adoptBaseline,
    draft: editedValues,
    setDraft: setEditedValues,
    conflictOpen: versionConflictOpen,
    setConflictOpen: setVersionConflictOpen,
    resolveConflict,
    rebasing: rebasingVersion,
    discarding: discardingConflict,
  } = useConfigSession<t.FlatConfigMap, t.FlatConfigMap>(
    { version: null, tenantId: user?.tenantId ?? '', value: {} },
    {},
  );
  const touchedPaths = useMemo(() => new Set(Object.keys(editedValues)), [editedValues]);
  const [editSessionId, setEditSessionId] = useState(0);

  /**
   * Import, Reset, and Restore are only reachable while there are no pending
   * field edits (touchedPaths.size === 0 the whole time their dialog is
   * open), so the dirty-edit gate below never protects them — a background
   * refetch (30s staleTime elapsing, a window-focus refetch, an unrelated
   * Langfuse save invalidating the same document) while one of these dialogs
   * is open would otherwise silently re-freeze a newer version, and the
   * admin's eventual confirm would succeed against that newer version
   * instead of the one they were actually looking at when they opened the
   * dialog — exactly the stale-administrator overwrite this freezing exists
   * to prevent.
   */
  const [importOpen, setImportOpen] = useState(false);
  const [resetBaseOpen, setResetBaseOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasDestructiveDialogOpen = importOpen || resetBaseOpen || historyOpen;
  useEffect(() => {
    if (baseConfigData && touchedPaths.size === 0 && !hasDestructiveDialogOpen) {
      adoptBaseline({
        version: baseConfigData.dbConfigVersion,
        tenantId: baseConfigData.effectiveTenantId,
        value: flatBaseline,
      });
    }
  }, [baseConfigData, touchedPaths.size, flatBaseline, hasDestructiveDialogOpen]);

  const fieldPaths = useMemo(() => collectFieldPaths(schemaTree), [schemaTree]);
  const schemaPathSet = useMemo(() => new Set(fieldPaths), [fieldPaths]);
  const secretFieldPaths = useMemo(() => collectSecretFieldPaths(schemaTree), [schemaTree]);
  const recordFieldPaths = useMemo(() => collectRecordFieldPaths(schemaTree), [schemaTree]);

  const configuredPaths = useMemo(() => {
    const paths = new Set<string>();
    if (configuredFromBase) {
      for (const p of configuredFromBase) paths.add(p);
    }
    if (dbOverrides) {
      for (const p of Object.keys(flattenObject(dbOverrides))) paths.add(p);
    }
    return mapSecretPreviewPaths(paths, schemaPathSet);
  }, [configuredFromBase, dbOverrides, schemaPathSet]);

  const dbOverridePaths = useMemo(() => {
    if (!dbOverrides) return new Set<string>();
    return mapSecretPreviewPaths(Object.keys(flattenObject(dbOverrides)), schemaPathSet);
  }, [dbOverrides, schemaPathSet]);

  const baseRecordKeys = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    const yamlMcpKeys = baseConfigData?.yamlMcpKeys;
    if (yamlMcpKeys && Array.isArray(yamlMcpKeys)) {
      result.mcpServers = new Set(yamlMcpKeys);
    }
    return result;
  }, [baseConfigData]);

  const hasUnmappedSections = useMemo(
    () =>
      schemaTree.some(
        (s: t.SchemaField) => !HIDDEN_SECTIONS.has(s.key) && !Object.hasOwn(SECTION_META, s.key),
      ),
    [schemaTree],
  );

  const { viewableTabIds, editableTabIds } = useMemo(
    () => ({
      viewableTabIds: getTabsWithPermission(
        schemaTree,
        SECTION_META,
        OTHER_TAB.id,
        sectionPermissions,
        'canView',
        HIDDEN_SECTIONS,
      ),
      editableTabIds: getTabsWithPermission(
        schemaTree,
        SECTION_META,
        OTHER_TAB.id,
        sectionPermissions,
        'canEdit',
        HIDDEN_SECTIONS,
      ),
    }),
    [schemaTree, sectionPermissions],
  );

  const visibleTabs = useMemo(() => {
    const allTabs = hasUnmappedSections ? [...CONFIG_TABS, OTHER_TAB] : CONFIG_TABS;
    return allTabs.filter((tab) => viewableTabIds.has(tab.id));
  }, [hasUnmappedSections, viewableTabIds]);

  const activeTab =
    initialTab && visibleTabs.some((tab) => tab.id === initialTab)
      ? initialTab
      : (visibleTabs[0]?.id ?? CONFIG_TABS[0].id);

  const handleTabChange = useCallback(
    (newTab: string) => {
      navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, tab: newTab }) });
    },
    [navigate],
  );

  const [importSuccess, setImportSuccess] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(dismissTimer.current), []);

  const [showConfiguredOnly, setShowConfiguredOnly] = useState(false);

  const [scopeSelectorOpen, setScopeSelectorOpen] = useState(false);
  const [selectedScope, setSelectedScope] = useState<t.ScopeSelection>({ type: 'BASE' });

  const handleScopeChange = useCallback(
    (newSelection: t.ScopeSelection) => {
      if (Object.keys(editedValues).length > 0) {
        if (!window.confirm(localize('com_config_unsaved_leave'))) return;
        setEditedValues({});
      }
      setEditSessionId((id) => id + 1);
      setConfirmSaveOpen(false);
      setSelectedScope(newSelection);
      const scopeId =
        newSelection.type === 'SCOPE' && newSelection.scope._id
          ? newSelection.scope._id
          : undefined;
      if (scopeId) {
        localStorage.setItem(LAST_SCOPE_KEY, scopeId);
      } else {
        localStorage.removeItem(LAST_SCOPE_KEY);
      }
      navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, scope: scopeId }) });
    },
    [editedValues, localize, navigate],
  );

  const savedScope = useRef(localStorage.getItem(LAST_SCOPE_KEY) ?? undefined);
  const scopeToRestore = initialScope ?? savedScope.current;
  const { data: allScopes } = useQuery({
    ...availableScopesOptions(baseConfigData?.effectiveTenantId ?? ''),
    enabled: !!scopeToRestore && baseConfigData?.effectiveTenantId !== undefined,
  });
  const initialScopeApplied = useRef(false);
  const activeTenantRef = useRef(user?.tenantId ?? '');
  useEffect(() => {
    if (scopeToRestore && allScopes && !initialScopeApplied.current) {
      const match =
        allScopes.find((s) => s._id === scopeToRestore) ??
        (() => {
          const [type, ...rest] = scopeToRestore.split(':');
          const id = rest.join(':');
          return allScopes.find(
            (s) => s.principalType === (type as PrincipalType) && s.principalId === id,
          );
        })();
      if (match) {
        initialScopeApplied.current = true;
        setSelectedScope({ type: 'SCOPE', scope: match });
        if (!initialScope) {
          navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, scope: match._id }) });
        }
      }
    }
  }, [scopeToRestore, allScopes, initialScope, navigate]);

  const isEditingScope = selectedScope.type === 'SCOPE';
  const editingScope: t.ConfigScope | undefined =
    selectedScope.type === 'SCOPE' ? selectedScope.scope : undefined;

  const { data: profileMap = {} } = useQuery(
    profileMapOptions(fieldPaths, baseConfigData?.effectiveTenantId),
  );

  const handleProfileChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['profileMap'] });
    queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] });
  }, [queryClient]);

  const { data: resolvedData } = useQuery(
    resolvedConfigOptions(selectedScope, baseConfigData?.effectiveTenantId),
  );
  const scopeChangedPaths = resolvedData?.changedPaths ?? null;
  const scopeResolvedValues = resolvedData?.resolvedConfig ?? null;

  const scopeConfigValues = useMemo(() => {
    if (!isEditingScope || !scopeResolvedValues) return null;
    return unflattenObject(scopeResolvedValues) as Record<string, t.ConfigValue>;
  }, [isEditingScope, scopeResolvedValues]);

  const baseActiveConfigValues = isEditingScope ? scopeConfigValues : configValues;

  const activeConfigValues = useMemo(() => {
    if (!baseActiveConfigValues) return baseActiveConfigValues;
    const indexedEdits = Object.entries(editedValues).filter(([k]) => /\.\d+$/.test(k));
    if (indexedEdits.length === 0) return baseActiveConfigValues;
    return mergeIndexedArrayEdits(baseActiveConfigValues, indexedEdits);
  }, [baseActiveConfigValues, editedValues]);

  const scopeConfiguredPaths = useMemo(() => {
    if (!scopeChangedPaths) return new Set<string>();
    return mapSecretPreviewPaths(scopeChangedPaths, schemaPathSet);
  }, [scopeChangedPaths, schemaPathSet]);

  const scopeChangedPathsMapped = useMemo(() => {
    if (!scopeChangedPaths) return null;
    return Array.from(mapSecretPreviewPaths(scopeChangedPaths, schemaPathSet));
  }, [scopeChangedPaths, schemaPathSet]);

  const { data: langfuseConnection } = useQuery({
    queryKey: baseConfigData?.effectiveTenantId
      ? [...LANGFUSE_CONNECTION_QUERY_KEY, baseConfigData.effectiveTenantId]
      : LANGFUSE_CONNECTION_QUERY_KEY,
    queryFn: () =>
      getLangfuseConnectionFn({
        data: { expectedTenantId: baseConfigData!.effectiveTenantId },
      }),
    structuralSharing: versionedStructuralSharing<
      Awaited<ReturnType<typeof getLangfuseConnectionFn>>
    >(
      (value) => value.configVersion,
      (value) => value.effectiveTenantId,
    ),
    enabled:
      !isEditingScope &&
      baseConfigData?.effectiveTenantId !== undefined &&
      schemaTree.some((section) => section.key === 'langfuse') &&
      sectionPermissions.langfuse?.canEdit === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const baseConfiguredPaths = useMemo(
    () => withLangfuseConfiguredPath(configuredPaths, langfuseConnection?.configured === true),
    [configuredPaths, langfuseConnection?.configured],
  );

  const activeConfiguredPaths = isEditingScope ? scopeConfiguredPaths : baseConfiguredPaths;

  const tabConfiguredCounts = useMemo(() => {
    if (activeConfiguredPaths.size === 0) return {};
    const schemaKeyToTabs: Record<string, string[]> = {};
    for (const [metaKey, meta] of Object.entries(SECTION_META)) {
      if (meta.schemaKey) {
        (schemaKeyToTabs[meta.schemaKey] ??= []).push(meta.tab);
      }
      if (!meta.schemaKey) {
        (schemaKeyToTabs[metaKey] ??= []).push(meta.tab);
      }
    }

    const counts: Record<string, number> = {};
    for (const tab of visibleTabs) {
      if (tab.id === 'mcp' && activeConfigValues) {
        const mcpValue = activeConfigValues.mcpServers;
        counts[tab.id] =
          mcpValue && typeof mcpValue === 'object' && !Array.isArray(mcpValue)
            ? Object.keys(mcpValue).length
            : 0;
        continue;
      }

      if (tab.id === 'custom' && activeConfigValues) {
        const endpointsValue = activeConfigValues.endpoints as
          | Record<string, t.ConfigValue>
          | undefined;
        const customArray = endpointsValue?.custom;
        counts[tab.id] = Array.isArray(customArray) ? customArray.length : 0;
        continue;
      }

      const tabSections = schemaTree.filter((section: t.SchemaField) => {
        if (HIDDEN_SECTIONS.has(section.key)) return false;
        if (tab.id === OTHER_TAB.id) return !Object.hasOwn(SECTION_META, section.key);
        return schemaKeyToTabs[section.key]?.includes(tab.id) ?? false;
      });
      let count = 0;
      for (const section of tabSections) {
        const paths = section.children?.length
          ? collectFieldPaths(section.children, section.key)
          : [section.key];
        for (const p of paths) {
          if (tab.id === 'providers' && p.startsWith('endpoints.custom')) continue;
          if (activeConfiguredPaths.has(p)) count++;
        }
      }
      counts[tab.id] = count;
    }
    return counts;
  }, [activeConfiguredPaths, activeConfigValues, visibleTabs, schemaTree]);

  const scopeBaseline = useMemo(() => {
    if (!isEditingScope) return flatBaseline;
    return scopeResolvedValues ?? {};
  }, [isEditingScope, flatBaseline, scopeResolvedValues]);

  /** Container paths inferred from leaf baselines, used to tell apart subtree-deletes from no-op writes. */
  const baselineIntermediates = useMemo(() => {
    const set = new Set<string>();
    for (const leaf of Object.keys(scopeBaseline)) {
      const parts = leaf.split('.');
      for (let i = 1; i < parts.length; i++) {
        set.add(parts.slice(0, i).join('.'));
      }
    }
    return set;
  }, [scopeBaseline]);

  /** Container paths walked directly off the structured config, so an orphaned `{}` entry whose flatten dropped (or never produced) any leaf is still recognized as a real subtree-delete target. */
  const baselineContainerPaths = useMemo(() => {
    const set = new Set<string>();
    const walk = (obj: unknown, prefix: string): void => {
      if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return;
      for (const k of Object.keys(obj as Record<string, unknown>)) {
        const path = prefix ? `${prefix}.${k}` : k;
        const v = (obj as Record<string, unknown>)[k];
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          set.add(path);
          walk(v, path);
        }
      }
    };
    walk(baseActiveConfigValues, '');
    return set;
  }, [baseActiveConfigValues]);

  const handleFieldChange = useCallback(
    (path: string, value: t.ConfigValue) => {
      if (!isEditingScope && getBlockingConfigReset(editedValues, path)) {
        notifyError(localize('com_config_reset_before_edit'));
        return;
      }
      setEditedValues((prev) => {
        const next = applyConfigEdit(
          prev,
          path,
          value,
          scopeBaseline,
          baselineIntermediates,
          baselineContainerPaths,
          isEditingScope,
        );
        return next;
      });
    },
    [
      scopeBaseline,
      baselineIntermediates,
      baselineContainerPaths,
      editedValues,
      localize,
      isEditingScope,
    ],
  );

  /**
   * Removes `path` from `editedValues`/`touchedPaths` directly, bypassing
   * `applyConfigEdit`'s baseline-match diffing. Abandoning an in-progress
   * SecretField replacement (Cancel) is never a real edit — representing it
   * as `onChange(path, undefined)` would mean the same thing as a real reset
   * whenever a scope-resolved baseline happens to also read as empty.
   */
  const handleDiscardField = useCallback((path: string) => {
    setEditedValues((prev) => {
      if (!(path in prev)) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  const isDirty = Object.keys(editedValues).length > 0;

  const pendingResets = useMemo(() => {
    const resets = new Set<string>();
    for (const [k, v] of Object.entries(editedValues)) {
      if (v === undefined) resets.add(k);
    }
    return resets;
  }, [editedValues]);

  useBlocker({
    shouldBlockFn: ({ current, next }) => {
      if (!isDirty) return false;
      if (current.pathname === next.pathname) return false;
      return !window.confirm(localize('com_config_unsaved_leave'));
    },
  });

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const effectiveTenantId = baseConfigData?.effectiveTenantId;
    if (effectiveTenantId === undefined || effectiveTenantId === activeTenantRef.current) {
      return;
    }
    activeTenantRef.current = effectiveTenantId;
    savedScope.current = undefined;
    initialScopeApplied.current = true;
    localStorage.removeItem(LAST_SCOPE_KEY);
    setEditedValues({});
    setEditSessionId((id) => id + 1);
    setConfirmSaveOpen(false);
    setImportOpen(false);
    setResetBaseOpen(false);
    setHistoryOpen(false);
    setVersionConflictOpen(false);
    setScopeSelectorOpen(false);
    setSelectedScope({ type: 'BASE' });
    adoptBaseline({
      version: baseConfigData?.dbConfigVersion ?? null,
      tenantId: effectiveTenantId,
      value: flatBaseline,
    });
    queryClient.removeQueries({ queryKey: ['profileMap'] });
    queryClient.removeQueries({ queryKey: ['resolvedConfig'] });
    queryClient.removeQueries({ queryKey: ['availableScopes'] });
    queryClient.removeQueries({ queryKey: ['fieldProfileValues'] });
    queryClient.removeQueries({ queryKey: ['roles'] });
    queryClient.removeQueries({ queryKey: ['groups'] });
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, scope: undefined }) });
    notifyError(localize('com_config_tenant_changed'));
  }, [baseConfigData, flatBaseline, localize, navigate, queryClient]);

  const handleDiscard = useCallback(() => {
    setEditedValues({});
    setEditSessionId((id) => id + 1);
  }, []);

  const handleDiscardAfterConflict = useCallback(
    () =>
      resolveConflict('discard', async () => {
        const fresh = await refreshBaseConfig(queryClient);
        setBaseTenantScope(fresh.effectiveTenantId);
        handleDiscard();
        setImportOpen(false);
        setResetBaseOpen(false);
        setHistoryOpen(false);
        adoptBaseline({
          version: fresh.dbConfigVersion,
          tenantId: fresh.effectiveTenantId,
          value: flattenObject((fresh.config ?? {}) as Record<string, t.ConfigValue>),
        });
      }).catch((err: Error) => notifyError(err.message)),
    [resolveConflict, adoptBaseline, handleDiscard, queryClient],
  );

  const handleRebaseAfterConflict = useCallback(
    () =>
      resolveConflict('rebase', async () => {
        const fresh = await refreshBaseConfig(queryClient);
        if (fresh.effectiveTenantId !== frozenBaseTenantId) {
          handleDiscard();
          setBaseTenantScope(fresh.effectiveTenantId);
          adoptBaseline({
            version: fresh.dbConfigVersion,
            tenantId: fresh.effectiveTenantId,
            value: flattenObject((fresh.config ?? {}) as Record<string, t.ConfigValue>),
          });
          notifyError(localize('com_config_tenant_changed'));
          return;
        }

        // A numeric array index (endpoints.custom.2, ...) no longer safely
        // identifies its original element once the array changed underneath
        // the draft, and a whole-array or whole-record add/remove draft was
        // computed from the container's old contents — all three risk silently
        // overwriting whatever the other admin changed. Drop those specific
        // edits instead of trusting them; everything else in the draft still
        // replays onto the new baseline.
        const newFlatBaseline = flattenObject(
          (fresh.config ?? {}) as Record<string, t.ConfigValue>,
        );
        const staleContainerPaths = detectStaleContainerEdits(
          touchedPaths,
          editedValues,
          frozenFlatBaseline,
          newFlatBaseline,
          secretFieldPaths,
        );
        if (staleContainerPaths.length > 0) {
          setEditedValues((prev) => {
            const next = { ...prev };
            for (const path of staleContainerPaths) delete next[path];
            return next;
          });
          const count = staleContainerPaths.length;
          notifyError(
            count === 1
              ? localize('com_config_version_conflict_indexed_dropped', { count })
              : localize('com_config_version_conflict_indexed_dropped_plural', { count }),
          );
        }

        adoptBaseline({
          version: fresh.dbConfigVersion,
          tenantId: fresh.effectiveTenantId,
          value: newFlatBaseline,
        });
        setEditSessionId((id) => id + 1);
      }).catch((err: Error) => notifyError(err.message)),
    [
      resolveConflict,
      adoptBaseline,
      queryClient,
      touchedPaths,
      editedValues,
      frozenFlatBaseline,
      frozenBaseTenantId,
      secretFieldPaths,
      localize,
      handleDiscard,
    ],
  );

  const clearEdits = useCallback(() => {
    setEditedValues({});
    setEditSessionId((id) => id + 1);
    setConfirmSaveOpen(false);
    setSaving(false);
    setSaveError(null);
    notifySuccess(localize('com_config_saved'));
  }, [localize]);

  // Awaited (not fire-and-forget) so `baseConfigData` reflects the new
  // version by the time `clearEdits` drops touchedPaths to 0 — otherwise the
  // frozen-version re-sync effect fires immediately against the still-stale
  // cached data, and an admin who starts a new edit before the background
  // refetch lands would freeze on that stale version, 409ing on the next save.
  const invalidateAndResetBase = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['baseConfig'] }),
      queryClient.invalidateQueries({ queryKey: ['configRevisions'] }),
    ]);
    clearEdits();
  }, [queryClient, clearEdits]);

  const invalidateAndResetScope = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] }),
      queryClient.invalidateQueries({ queryKey: ['profileMap'] }),
      queryClient.invalidateQueries({ queryKey: ['availableScopes'] }),
    ]);
    clearEdits();
  }, [queryClient, clearEdits]);

  const importMutation = useMutation({
    mutationFn: (config: Record<string, t.ConfigValue>) =>
      importBaseConfigFn({
        data: {
          config,
          expectedVersion: frozenBaseVersion,
          expectedTenantId: frozenBaseTenantId,
        },
      }),
    onError: (err: Error) => {
      notifyError(err.message);
      // The import never landed — any in-progress edit draft is still valid
      // and must not be silently discarded (see VersionConflictDialog).
      if (isVersionConflictError(err)) {
        setVersionConflictOpen(true);
      }
    },
    onSuccess: invalidateAndResetBase,
  });

  const [resettingBase, setResettingBase] = useState(false);
  const [activatingBase, setActivatingBase] = useState(false);
  const [resetBaseError, setResetBaseError] = useState<string | null>(null);
  const [restoringRevision, setRestoringRevision] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const revisionsQuery = useQuery({
    ...configRevisionsOptions(user?.id ?? '', baseConfigData?.effectiveTenantId),
    enabled: historyOpen && canManageConfig && !isEditingScope,
  });

  const handleActivateBaseConfig = useCallback(async () => {
    if (activatingBase || isDirty) return;
    setActivatingBase(true);
    try {
      await setBaseConfigActiveFn({
        data: {
          isActive: true,
          expectedVersion: frozenBaseVersion,
          expectedTenantId: frozenBaseTenantId,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['baseConfig'] }),
        queryClient.invalidateQueries({ queryKey: ['configRevisions'] }),
      ]);
      notifySuccess(localize('com_config_reactivate_success'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      notifyError(message);
      if (isVersionConflictError(err)) {
        setVersionConflictOpen(true);
      }
    } finally {
      setActivatingBase(false);
    }
  }, [activatingBase, frozenBaseTenantId, frozenBaseVersion, isDirty, localize, queryClient]);

  const handleResetBaseConfig = useCallback(async () => {
    if (resettingBase) return;
    setResettingBase(true);
    setResetBaseError(null);
    try {
      await resetBaseConfigFn({
        data: {
          expectedVersion: frozenBaseVersion,
          expectedTenantId: frozenBaseTenantId,
        },
      });
      /** resolvedConfig holds each scope's own overrides (not a base merge), so a
       *  base reset doesn't make it stale on its own — but base-derived data
       *  (schemaDefaults, base values used for MCP inheritance) feeds scope mode,
       *  so flush it too, consistent with how scope saves invalidate. */
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['baseConfig'] }),
        queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] }),
        queryClient.invalidateQueries({ queryKey: ['configRevisions'] }),
      ]);
      setEditedValues({});
      setEditSessionId((id) => id + 1);
      setResettingBase(false);
      setResetBaseOpen(false);
      notifySuccess(localize('com_config_reset_base_success'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResettingBase(false);
      setResetBaseError(message);
      notifyError(message);
      // The reset never landed — any in-progress edit draft is still valid
      // and must not be silently discarded (see VersionConflictDialog).
      if (isVersionConflictError(err)) {
        setVersionConflictOpen(true);
      }
    }
  }, [resettingBase, queryClient, localize, frozenBaseVersion, frozenBaseTenantId]);

  const handleRestoreRevision = useCallback(
    async (id: string) => {
      if (restoringRevision) return;
      setRestoringRevision(true);
      setRestoreError(null);
      try {
        await restoreConfigRevisionFn({
          data: {
            id,
            expectedVersion: frozenBaseVersion,
            expectedTenantId: frozenBaseTenantId,
          },
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['baseConfig'] }),
          queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] }),
          queryClient.invalidateQueries({ queryKey: ['configRevisions'] }),
        ]);
        setEditedValues({});
        setEditSessionId((n) => n + 1);
        setRestoringRevision(false);
        setHistoryOpen(false);
        notifySuccess(localize('com_config_revision_success'));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setRestoringRevision(false);
        setRestoreError(message);
        notifyError(message);
        // The restore never landed — any in-progress edit draft is still
        // valid and must not be silently discarded (see VersionConflictDialog).
        if (isVersionConflictError(err)) {
          setVersionConflictOpen(true);
        }
      }
    },
    [restoringRevision, queryClient, localize, frozenBaseVersion, frozenBaseTenantId],
  );

  const handleResetField = useCallback((fieldPath: string) => {
    startTransition(() => {
      setEditedValues((prev) => {
        const next = applyConfigReset(prev, fieldPath);
        return next;
      });
    });
  }, []);

  const handleConfirmSave = useCallback(async () => {
    if (saving) return;
    const { touched, saves, resets } = buildSavePayload(
      touchedPaths,
      editedValues,
      schemaPathSet,
      recordFieldPaths,
    );
    if (touched.length === 0) return;

    /** Per-leaf saves can land an MCP entry in a transport state whose required siblings are missing (e.g. type=stdio with no command/args). Server-side per-field validation only sees one path at a time, so do the cross-field check here against the merged effective entry before any PATCH fires. Use baseActiveConfigValues so scope-mode edits validate against the scope-resolved baseline (where prior scope overrides supply some required fields) instead of the base config alone. */
    const mcpBaseline = (() => {
      const v = baseActiveConfigValues?.mcpServers;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, t.ConfigValue>;
      }
      return {};
    })();
    const mcpEdits: Array<[string, t.ConfigValue]> = touched
      .filter((p) => p.startsWith('mcpServers.'))
      .map((p) => [p, editedValues[p]] as [string, t.ConfigValue]);
    /** A leaf reset (undefined write) removes the override and reveals the value of the next-lower layer. In scope mode that next layer is the base config; in base mode it is the un-merged YAML config (the baseOnly response). Feed whichever layer applies as the resetFallback so the cross-field validator does not falsely flag a reset-but-still-valid field as missing. */
    const mcpResetFallback = (() => {
      const source = isEditingScope ? configValues?.mcpServers : baseConfigData?.yamlMcpServers;
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        return source as Record<string, t.ConfigValue>;
      }
      return undefined;
    })();
    if (mcpEdits.length > 0) {
      const mcpErrors = validateMcpCrossField(mcpBaseline, mcpEdits, mcpResetFallback);
      if (mcpErrors.length > 0) {
        const { entryKey, missingField } = mcpErrors[0];
        const message = localize('com_config_mcp_invalid_after_edit', {
          entry: entryKey,
          field: missingField,
        });
        setSaveError(message);
        notifyError(message);
        return;
      }
    }

    const inheritedMcpKeys = (() => {
      const source = isEditingScope ? configValues?.mcpServers : undefined;
      if (source && typeof source === 'object' && !Array.isArray(source)) {
        return new Set(Object.keys(source as Record<string, t.ConfigValue>));
      }
      return new Set<string>();
    })();

    setSaving(true);
    setSaveError(null);

    try {
      /** Resets must land before saves so a delete-then-recreate at the same path (e.g. MCP entry replaced with different fields) wipes stale fields first and the new leaf PATCHes don't race against the DELETE. Base mode sends both in one server call so a single snapshot is taken before either DELETE or PATCH. */
      if (isEditingScope) {
        if (resets.length > 0) {
          const { resetPaths, tombstonePaths } = partitionScopeResetPaths(resets, inheritedMcpKeys);
          const resetPromises = [
            ...resetPaths.map((fieldPath) =>
              removeFieldProfileValueFn({
                data: {
                  fieldPath,
                  principalType: editingScope!.principalType,
                  principalId: editingScope!.principalId,
                  expectedTenantId: frozenBaseTenantId,
                },
              }),
            ),
            ...tombstonePaths.map((fieldPath) =>
              tombstoneFieldProfileValueFn({
                data: {
                  fieldPath,
                  principalType: editingScope!.principalType,
                  principalId: editingScope!.principalId,
                  expectedTenantId: frozenBaseTenantId,
                },
              }),
            ),
          ];
          if (resetPromises.length > 0) {
            await Promise.all(resetPromises);
          }
        }
        if (saves.length > 0) {
          await bulkSaveProfileValuesFn({
            data: {
              principalType: editingScope!.principalType,
              principalId: editingScope!.principalId,
              expectedTenantId: frozenBaseTenantId,
              entries: saves,
            },
          });
        }
      } else {
        await saveBaseConfigFn({
          data: {
            entries: saves,
            resetPaths: resets,
            expectedVersion: frozenBaseVersion,
            expectedTenantId: frozenBaseTenantId,
          },
        });
      }

      if (isEditingScope) {
        await invalidateAndResetScope();
      } else {
        await invalidateAndResetBase();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaving(false);
      setSaveError(message);
      notifyError(message);
      /** A version conflict can never succeed by retrying with the same frozen
       * version, but a long edit session's draft must not be silently thrown
       * away the moment CAS detects concurrent work — hand the admin an
       * explicit choice instead (VersionConflictDialog): rebase onto the
       * latest version and keep editing, or discard and start fresh. */
      if (!isEditingScope && isVersionConflictError(err)) {
        setConfirmSaveOpen(false);
        setVersionConflictOpen(true);
      }
    }
  }, [
    touchedPaths,
    editedValues,
    schemaPathSet,
    recordFieldPaths,
    saving,
    isEditingScope,
    baseActiveConfigValues,
    configValues,
    baseConfigData,
    frozenBaseVersion,
    frozenBaseTenantId,
    localize,
    editingScope,
    invalidateAndResetScope,
    invalidateAndResetBase,
  ]);

  const serializedEditedValues = useMemo(() => {
    const result: t.FlatConfigMap = {};
    for (const [k, v] of Object.entries(editedValues)) {
      result[k] = stripSecretPreviewValues(
        deepSerializeKVPairs(v, k, recordFieldPaths),
        k,
        schemaPathSet,
      );
    }
    return result;
  }, [editedValues, schemaPathSet, recordFieldPaths]);

  const originalValuesForDialog = useMemo(() => {
    const baseline = isEditingScope ? scopeBaseline : flatBaseline;
    const result: t.FlatConfigMap = { ...baseline };
    for (const path of Object.keys(editedValues)) {
      if (path in result) {
        result[path] = stripSecretPreviewValues(result[path], path, schemaPathSet);
        continue;
      }
      const segments = path.split('.');
      let current: t.ConfigValue = configValues;
      for (const seg of segments) {
        if (current == null || typeof current !== 'object') {
          current = undefined;
          break;
        }
        current = Array.isArray(current)
          ? (current as t.ConfigValue[])[Number(seg)]
          : (current as Record<string, t.ConfigValue>)[seg];
      }
      if (current !== undefined)
        result[path] = stripSecretPreviewValues(current, path, schemaPathSet);
    }
    return result;
  }, [editedValues, flatBaseline, isEditingScope, scopeBaseline, configValues, schemaPathSet]);

  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null);

  const showImportSuccess = useCallback((message?: string) => {
    setImportSuccessMessage(message ?? null);
    setImportSuccess(true);
    clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setImportSuccess(false), 4000);
  }, []);

  const handleImportAsProfile = useCallback(
    async (appConfig: Record<string, t.ConfigValue>, scope: t.ConfigScope) => {
      const normalized = normalizeImportConfig(appConfig);
      const flat = flattenObject(normalized);
      const entries = Object.entries(flat)
        .filter(
          ([fieldPath, value]) =>
            value != null && secretPathForPreviewPath(fieldPath, schemaPathSet) == null,
        )
        .map(([fieldPath, value]) => ({
          fieldPath,
          value: stripSecretPreviewValues(value, fieldPath, schemaPathSet),
        }));
      await bulkSaveProfileValuesFn({
        data: {
          principalType: scope.principalType,
          principalId: scope.principalId,
          expectedTenantId: frozenBaseTenantId,
          entries,
        },
      });
      queryClient.invalidateQueries({ queryKey: ['profileMap'] });
      queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] });
      queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      showImportSuccess(
        localize('com_config_import_profile_success', {
          count: entries.length,
          name: scope.name,
        }),
      );
    },
    [queryClient, localize, showImportSuccess, schemaPathSet, frozenBaseTenantId],
  );

  const handleImport = useCallback(
    (appConfig: Record<string, t.ConfigValue>) => {
      const normalized = normalizeImportConfig(appConfig);
      if (isEditingScope && editingScope) {
        handleImportAsProfile(normalized, editingScope).catch((err: Error) => {
          notifyError(err.message);
        });
      } else {
        const stripped = stripSecretPreviewValues(normalized, '', schemaPathSet) as Record<
          string,
          t.ConfigValue
        >;
        importMutation.mutate(stripped, { onSuccess: () => showImportSuccess() });
      }
    },
    [
      isEditingScope,
      editingScope,
      importMutation,
      showImportSuccess,
      handleImportAsProfile,
      schemaPathSet,
    ],
  );

  const highlightRef = useHighlightRef(highlightField);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [tocEl, setTocEl] = useState<HTMLElement | null>(null);
  const scrollCallbackRef = useCallback(
    (el: HTMLDivElement | null) => {
      setScrollEl(el);
      highlightRef(el);
    },
    [highlightRef],
  );
  const setActiveSection = useActiveSection(scrollEl, tocEl, activeTab);

  const canEditActiveTab = editableTabIds.has(activeTab);

  /** Route-level gating ensures canView; canEdit reflects per-tab manage capability. */
  const permissions: t.ScopePermissions = useMemo(
    () => ({
      canView: true,
      canEdit: canEditActiveTab,
      canAssign: canAssignConfigs,
    }),
    [canEditActiveTab, canAssignConfigs],
  );

  const sectionsForActiveTab = useMemo((): t.ConfigSectionConfig[] => {
    // Collect virtual section entries (those with schemaKey) that target this tab
    const virtualEntries = Object.entries(SECTION_META).filter(
      ([, m]) => m.schemaKey && m.tab === activeTab,
    );

    const directSections = schemaTree
      .filter((section: t.SchemaField) => {
        if (HIDDEN_SECTIONS.has(section.key)) return false;
        if (activeTab === OTHER_TAB.id) return !Object.hasOwn(SECTION_META, section.key);
        return SECTION_META[section.key]?.tab === activeTab;
      })
      .map((section: t.SchemaField) => {
        const meta = SECTION_META[section.key];
        const children = section.children ?? [];
        const hasStructuredChildren =
          (section.isObject || section.type === 'record') && children.length > 0;
        return {
          id: section.key,
          titleKey: meta?.titleKey ?? `com_config_section_${section.key}`,
          descriptionKey: meta?.descriptionKey,
          fields: hasStructuredChildren ? children : [],
          ...(!hasStructuredChildren && { sectionField: section }),
          ...(section.key === 'interface' && {
            bannerText: localize('com_config_interface_permissions_info'),
          }),
        };
      });

    // Add virtual sections — these reference another schema section's data
    // but render under a different tab with their own section renderer.
    const virtualSections = virtualEntries.flatMap(([metaKey, meta]) => {
      const schemaSection = schemaTree.find((s: t.SchemaField) => s.key === meta.schemaKey);
      if (!schemaSection) return [];
      const hasStructuredChildren =
        (schemaSection.isObject || schemaSection.type === 'record') &&
        schemaSection.children &&
        schemaSection.children.length > 0;
      return [
        {
          id: metaKey,
          schemaKey: meta.schemaKey,
          titleKey: meta.titleKey,
          descriptionKey: meta.descriptionKey,
          fields: hasStructuredChildren ? (schemaSection.children ?? []) : [],
          ...(!hasStructuredChildren && { sectionField: schemaSection }),
        },
      ];
    });

    const allSections: t.ConfigSectionConfig[] = [...directSections, ...virtualSections].filter(
      (s) => {
        const permKey = 'schemaKey' in s && s.schemaKey ? s.schemaKey : s.id;
        return sectionPermissions[permKey]?.canView === true;
      },
    );

    // Custom Endpoints tab: show configured endpoint names in TOC
    if (activeTab === 'custom' && activeConfigValues) {
      for (const section of allSections) {
        const dataKey = section.schemaKey ?? section.id;
        const sectionValue = activeConfigValues[dataKey] as
          | Record<string, t.ConfigValue>
          | undefined;
        const customArray = sectionValue?.custom;
        section.titleKey = 'com_config_tab_custom_endpoints';
        if (Array.isArray(customArray) && customArray.length > 0) {
          section.tocItems = customArray.map((entry, i) => {
            const obj =
              entry && typeof entry === 'object' && !Array.isArray(entry)
                ? (entry as Record<string, t.ConfigValue>)
                : {};
            const name =
              typeof obj.name === 'string' && obj.name
                ? obj.name
                : localize('com_config_entry_n', { n: String(i + 1) });
            return {
              id: `section-${dataKey}-custom-${i}`,
              label: name,
              dataPath: `${dataKey}.custom`,
            };
          });
        }
      }
    }

    // MCP Servers tab: show configured server names in TOC
    if (activeTab === 'mcp' && activeConfigValues) {
      for (const section of allSections) {
        if (section.id !== 'mcpServers') continue;
        const dataKey = section.schemaKey ?? section.id;
        const mcpValue = activeConfigValues[dataKey];
        if (mcpValue && typeof mcpValue === 'object' && !Array.isArray(mcpValue)) {
          const serverKeys = Object.keys(mcpValue as Record<string, t.ConfigValue>);
          if (serverKeys.length > 0) {
            section.tocItems = serverKeys.map((name) => ({
              id: `section-mcpServers-${encodeURIComponent(name)}`,
              label: name,
              dataPath: `mcpServers.${name}`,
            }));
          }
        }
      }
    }

    // AI Providers tab: show provider names in TOC (excluding 'custom')
    if (activeTab === 'providers') {
      for (const section of allSections) {
        const providerFields = section.fields.filter(
          (f) => f.key !== 'custom' && f.children && f.children.length > 0,
        );
        if (providerFields.length > 0) {
          const dataKey = section.schemaKey ?? section.id;
          section.tocItems = providerFields.map((f) => ({
            id: `section-${dataKey}.${f.key}`,
            label: localize(`com_config_field_${f.key}`),
          }));
        }
      }
    }

    return allSections;
  }, [schemaTree, activeTab, activeConfigValues, localize, sectionPermissions]);

  const renderBanner = () => {
    if (importSuccess) {
      return (
        <InfoBanner
          text={importSuccessMessage ?? localize('com_config_import_success')}
          dismissible={false}
        />
      );
    }
    return null;
  };

  const banner = renderBanner();

  const resetBaseTitle = (() => {
    if (!canManageConfig) {
      return localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_CONFIGS });
    }
    if (isDirty) return localize('com_config_reset_base_dirty');
    return undefined;
  })();

  const historyTitle = (() => {
    if (!canManageConfig) {
      return localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_CONFIGS });
    }
    if (isDirty) return localize('com_config_revision_dirty');
    return undefined;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-2">
      <div className="shrink-0 px-4">
        {banner && <div className="pt-4 pb-2">{banner}</div>}
        {!isEditingScope && baseConfigData?.dbIsActive === false && (
          <div
            className="mt-4 mb-2 flex items-center gap-3 rounded-md border border-(--cui-color-accent-warning) px-3 py-2 text-sm"
            role="alert"
          >
            <span className="flex-1">{localize('com_config_base_inactive')}</span>
            <button
              type="button"
              onClick={() => void handleActivateBaseConfig()}
              disabled={activatingBase || isDirty || !canManageConfig}
              className="shrink-0 cursor-pointer rounded-md border border-(--cui-color-stroke-default) bg-transparent px-2.5 py-1 text-xs font-medium transition-colors hover:bg-(--cui-color-background-hover) disabled:cursor-not-allowed disabled:opacity-50"
            >
              {activatingBase
                ? localize('com_config_reactivating')
                : localize('com_config_reactivate')}
            </button>
          </div>
        )}
        <HeaderActions
          showImport
          importDisabled={isDirty || !canManageConfig}
          importTitle={
            !canManageConfig
              ? localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_CONFIGS })
              : undefined
          }
          onImportClick={() => setImportOpen(true)}
          showReset={!isEditingScope && dbOverridePaths.size > 0}
          resetDisabled={isDirty || !canManageConfig}
          resetTitle={resetBaseTitle}
          onResetClick={() => {
            setResetBaseError(null);
            setResetBaseOpen(true);
          }}
          showHistory={!isEditingScope}
          historyDisabled={isDirty || !canManageConfig}
          historyTitle={historyTitle}
          onHistoryClick={() => {
            setRestoreError(null);
            setHistoryOpen(true);
          }}
          showScope={permissions.canView}
          scopeSelection={selectedScope}
          onScopeClick={() => setScopeSelectorOpen(true)}
        />
        <ConfigTabBar
          tabs={visibleTabs}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          tabCounts={tabConfiguredCounts}
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 flex-1">
          {activeTab !== 'custom' && (
            <div className="pointer-events-none absolute top-2 right-3 z-(--z-floating)">
              <ContentToolbar
                scrollContainer={scrollEl}
                showConfiguredOnly={showConfiguredOnly}
                onShowConfiguredOnlyChange={setShowConfiguredOnly}
                showConfiguredToggle={activeConfiguredPaths.size > 0}
              />
            </div>
          )}
          <div
            className="h-full scrollbar-gutter-stable overflow-auto pl-4"
            ref={scrollCallbackRef}
          >
            <ConfigTabContent
              sections={sectionsForActiveTab}
              configValues={activeConfigValues}
              editedValues={editedValues}
              onFieldChange={handleFieldChange}
              onResetField={handleResetField}
              onDiscardField={handleDiscardField}
              profileMap={profileMap}
              previewMode={false}
              previewScope={editingScope}
              previewChangedPaths={scopeChangedPathsMapped}
              resolvedValues={scopeResolvedValues}
              permissions={permissions}
              onProfileChange={handleProfileChange}
              showChangedOnly={false}
              readOnly={!canEditActiveTab}
              configuredPaths={activeConfiguredPaths}
              dbOverridePaths={isEditingScope ? scopeConfiguredPaths : dbOverridePaths}
              touchedPaths={touchedPaths}
              pendingResets={pendingResets}
              sectionPermissions={sectionPermissions}
              schemaDefaults={schemaDefaults}
              showConfiguredOnly={showConfiguredOnly}
              isEditingScope={isEditingScope}
              effectiveTenantId={baseConfigData?.effectiveTenantId}
              baseRecordKeys={baseRecordKeys}
              onValidationError={(message) => notifyError(message)}
              editSessionId={editSessionId}
            />
          </div>
        </div>
        <ConfigTableOfContents
          sections={sectionsForActiveTab}
          scrollContainer={scrollEl}
          tocRef={setTocEl}
          showConfiguredOnly={showConfiguredOnly}
          configuredPaths={activeConfiguredPaths}
          onNavigate={setActiveSection}
        />
      </div>

      {isDirty && canEditActiveTab && (
        <StickyActionBar
          message={localize('com_config_unsaved_changes')}
          discardLabel={localize('com_config_discard')}
          saveLabel={localize('com_config_save')}
          onDiscard={handleDiscard}
          onSave={() => setConfirmSaveOpen(true)}
        />
      )}

      <ConfirmSaveDialog
        open={confirmSaveOpen}
        editedValues={serializedEditedValues}
        originalValues={originalValuesForDialog}
        saving={saving}
        error={saveError}
        onConfirm={handleConfirmSave}
        onCancel={() => setConfirmSaveOpen(false)}
      />

      <VersionConflictDialog
        open={versionConflictOpen}
        rebasing={rebasingVersion}
        discarding={discardingConflict}
        onRebase={handleRebaseAfterConflict}
        onDiscard={handleDiscardAfterConflict}
      />

      <ScopeSelector
        open={scopeSelectorOpen}
        expectedTenantId={baseConfigData?.effectiveTenantId ?? frozenBaseTenantId}
        onOpenChange={setScopeSelectorOpen}
        currentSelection={selectedScope}
        onSelect={handleScopeChange}
        permissions={permissions}
        onError={(msg) => notifyError(msg)}
      />

      <ImportYamlDialog
        open={importOpen}
        expectedTenantId={frozenBaseTenantId}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
        onImportAsProfile={handleImportAsProfile}
      />

      <ResetBaseConfigDialog
        open={resetBaseOpen}
        resetting={resettingBase}
        error={resetBaseError}
        onConfirm={handleResetBaseConfig}
        onCancel={() => {
          if (resettingBase) return;
          setResetBaseOpen(false);
          setResetBaseError(null);
        }}
      />

      <RevisionHistoryDialog
        open={historyOpen}
        loading={revisionsQuery.isLoading}
        restoring={restoringRevision}
        error={
          restoreError ??
          (revisionsQuery.error instanceof Error ? revisionsQuery.error.message : null)
        }
        revisions={revisionsQuery.data?.revisions ?? []}
        onRestore={handleRestoreRevision}
        onCancel={() => {
          if (restoringRevision) return;
          setHistoryOpen(false);
          setRestoreError(null);
        }}
      />
    </div>
  );
}

function HeaderActions({
  showImport,
  importDisabled,
  importTitle,
  onImportClick,
  showReset,
  resetDisabled,
  resetTitle,
  onResetClick,
  showHistory,
  historyDisabled,
  historyTitle,
  onHistoryClick,
  showScope,
  scopeSelection,
  onScopeClick,
}: {
  showImport: boolean;
  importDisabled: boolean;
  importTitle?: string;
  onImportClick: () => void;
  showReset: boolean;
  resetDisabled: boolean;
  resetTitle?: string;
  onResetClick: () => void;
  showHistory: boolean;
  historyDisabled: boolean;
  historyTitle?: string;
  onHistoryClick: () => void;
  showScope: boolean;
  scopeSelection: t.ScopeSelection;
  onScopeClick: () => void;
}) {
  const localize = useLocalize();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.getElementById('header-actions-portal'));
  }, []);

  const content = (
    <>
      {showImport && (
        <button
          type="button"
          onClick={onImportClick}
          disabled={importDisabled}
          aria-disabled={importDisabled || undefined}
          title={importTitle}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover) disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">
            <Icon name="upload" size="xs" />
          </span>
          {localize('com_config_import_yaml')}
        </button>
      )}
      {showReset && (
        <button
          type="button"
          onClick={onResetClick}
          disabled={resetDisabled}
          aria-disabled={resetDisabled || undefined}
          title={resetTitle}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:border-(--cui-color-accent-danger) hover:text-(--cui-color-accent-danger) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-(--cui-color-stroke-default) disabled:hover:text-(--cui-color-text-default)"
        >
          <span aria-hidden="true">
            <Icon name="refresh" size="xs" />
          </span>
          {localize('com_config_reset_base')}
        </button>
      )}
      {showHistory && (
        <button
          type="button"
          onClick={onHistoryClick}
          disabled={historyDisabled}
          aria-disabled={historyDisabled || undefined}
          title={historyTitle}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-3 py-1.5 text-sm text-(--cui-color-text-default) transition-colors hover:bg-(--cui-color-background-hover) disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">
            <Icon name="clock" size="xs" />
          </span>
          {localize('com_config_revision_history')}
        </button>
      )}
      {showScope && <ScopeTriggerButton currentSelection={scopeSelection} onClick={onScopeClick} />}
    </>
  );

  if (portalTarget) return createPortal(content, portalTarget);
  return null;
}

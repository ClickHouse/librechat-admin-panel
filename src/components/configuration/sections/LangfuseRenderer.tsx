import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, TextField } from '@clickhouse/click-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LangfuseConnectionStatus } from '@/server';
import type * as t from '@/types';
import {
  baseConfigOptions,
  getLangfuseConnectionFn,
  LANGFUSE_CONNECTION_QUERY_KEY,
  testLangfuseConnectionFn,
  updateLangfuseConnectionFn,
} from '@/server';
import { installIfNewer, versionedStructuralSharing } from '../utils';
import { VersionConflictDialog } from '../VersionConflictDialog';
import { isVersionConflictError } from '@/server/utils/errors';
import { notifyError, notifySuccess } from '@/utils';
import { useLocalize, useConfigSession } from '@/hooks';
import { refreshBaseConfig } from '../queries';

type VerificationState = 'idle' | 'inactive' | 'unverified' | 'checking' | 'verified' | 'failed';

function getConnectionKey(status?: LangfuseConnectionStatus): string | undefined {
  if (!status?.configured || !status.destination || !status.publicKey) return undefined;
  return `${status.destination}\u0000${status.publicKey}`;
}

function maskPublicKey(publicKey: string): string {
  const trimmed = publicKey.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function getVerificationLabel(
  state: VerificationState,
  message: string,
  localize: ReturnType<typeof useLocalize>,
): string {
  switch (state) {
    case 'checking':
      return localize('com_config_langfuse_checking');
    case 'verified':
      return localize('com_config_langfuse_verified');
    case 'failed':
      return message || localize('com_config_langfuse_test_fail');
    case 'inactive':
      return localize('com_config_langfuse_inactive');
    case 'unverified':
      return localize('com_config_langfuse_not_verified');
    default:
      return localize('com_config_langfuse_not_configured');
  }
}

function getVerificationDotClass(state: VerificationState): string {
  switch (state) {
    case 'verified':
      return 'bg-(--cui-color-accent-success)';
    case 'failed':
      return 'bg-(--cui-color-accent-danger)';
    case 'checking':
      return 'bg-(--cui-color-accent-warning)';
    default:
      return 'border border-(--cui-color-stroke-default)';
  }
}

export function LangfuseRenderer({
  disabled,
  isEditingScope,
  effectiveTenantId,
}: t.FieldRendererProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LangfuseConnectionStatus>();
  const {
    baseline: { version: expectedVersion, tenantId: expectedTenantId },
    adoptBaseline,
    draft: { destination, publicKey, secretKey },
    setDraft,
    conflictOpen: versionConflictOpen,
    setConflictOpen: setVersionConflictOpen,
    resolveConflict,
    rebasing: rebasingVersion,
    discarding: discardingConflict,
  } = useConfigSession<LangfuseConnectionStatus | undefined, t.LangfuseConnectionDraft>(
    { version: null, tenantId: effectiveTenantId ?? '', value: undefined },
    { destination: '', publicKey: '', secretKey: '' },
  );
  const setDestination = useCallback(
    (value: string) => setDraft((draft) => ({ ...draft, destination: value })),
    [setDraft],
  );
  const setPublicKey = useCallback(
    (value: string) => setDraft((draft) => ({ ...draft, publicKey: value })),
    [setDraft],
  );
  const setSecretKey = useCallback(
    (value: string) => setDraft((draft) => ({ ...draft, secretKey: value })),
    [setDraft],
  );
  const [editingPublicKey, setEditingPublicKey] = useState(false);
  const [editingSecretKey, setEditingSecretKey] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>('idle');
  const [verificationMessage, setVerificationMessage] = useState('');
  const testedConnectionRef = useRef<string | undefined>(undefined);
  const requestRef = useRef(0);
  /**
   * Whether this field's current value differs from `status` right now —
   * tracked per field, not as one combined flag, so editing only the secret
   * doesn't also freeze destination/public key against a concurrent change to
   * them. A background sync (the effect below) or a conflict rebase must not
   * clobber a real divergence with the refetched value; only fields that
   * still match get the fresh baseline.
   */
  const destinationTouchedRef = useRef(false);
  const publicKeyTouchedRef = useRef(false);
  /** Same "current dirtiness" role as the refs above, but for the secret key
   *  draft — tracked via a ref instead of reading `secretKey` state directly
   *  inside the sync effect below, so that effect stays free of a dependency
   *  that would otherwise fire it on every keystroke. There's no baseline to
   *  compare against (the server never sends back a real secret), so any
   *  non-empty draft counts as dirty. */
  const secretKeyDraftRef = useRef(false);
  const [tenantScope, setTenantScope] = useState(effectiveTenantId ?? '');
  /**
   * The highest `configVersion` this component has adopted so far, from any
   * source. The query cache now rejects older tracked results through
   * `versionedStructuralSharing`; this local guard is still required at the
   * component boundary so a pre-existing/dehydrated cache entry or another
   * caller without that policy cannot regress displayed fields while a draft
   * keeps `expectedVersion` frozen at the newer version.
   */
  const latestVersionRef = useRef<number | null>(null);
  const latestTenantRef = useRef(effectiveTenantId ?? '');
  const hasAdoptedStatusRef = useRef(false);
  const connectionQueryKey = useMemo(
    () =>
      tenantScope
        ? ([...LANGFUSE_CONNECTION_QUERY_KEY, tenantScope] as const)
        : LANGFUSE_CONNECTION_QUERY_KEY,
    [tenantScope],
  );

  const connectionQuery = useQuery({
    queryKey: connectionQueryKey,
    queryFn: () => getLangfuseConnectionFn({ data: { expectedTenantId: tenantScope } }),
    structuralSharing: versionedStructuralSharing<LangfuseConnectionStatus>(
      (value) => value.configVersion,
      (value) => value.effectiveTenantId ?? tenantScope,
    ),
    enabled: !isEditingScope && effectiveTenantId !== undefined,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (effectiveTenantId === undefined || effectiveTenantId === tenantScope) return;
    setTenantScope(effectiveTenantId);
  }, [effectiveTenantId, tenantScope]);
  const updateMutation = useMutation({
    mutationFn: (data: {
      enabled: boolean;
      destination: string;
      publicKey: string;
      secretKey?: string;
      expectedVersion: number | null;
      expectedTenantId: string;
    }) => updateLangfuseConnectionFn({ data }),
  });
  const testMutation = useMutation({
    mutationFn: (data: {
      destination: string;
      publicKey: string;
      secretKey?: string;
      expectedTenantId: string;
    }) => testLangfuseConnectionFn({ data }),
  });

  /**
   * Whether `candidate` is older than the highest version this component has
   * already adopted — see `latestVersionRef`'s doc comment. A numeric ref
   * always outranks a null candidate version: once a real version has been
   * adopted, a candidate with no version at all is older by definition.
   */
  const isStaleStatus = (candidate: LangfuseConnectionStatus): boolean =>
    (candidate.effectiveTenantId ?? latestTenantRef.current) === latestTenantRef.current &&
    latestVersionRef.current != null &&
    (candidate.configVersion == null || candidate.configVersion < latestVersionRef.current);

  useEffect(() => {
    if (!connectionQuery.data || isStaleStatus(connectionQuery.data)) return;
    const nextStatus = connectionQuery.data;
    const nextTenantId = nextStatus.effectiveTenantId ?? latestTenantRef.current;
    const tenantChanged = hasAdoptedStatusRef.current && nextTenantId !== latestTenantRef.current;
    if (tenantChanged) {
      destinationTouchedRef.current = false;
      publicKeyTouchedRef.current = false;
      secretKeyDraftRef.current = false;
      setSecretKey('');
      setEditingPublicKey(false);
      setEditingSecretKey(false);
      setVersionConflictOpen(false);
      notifyError(localize('com_config_tenant_changed'));
    }
    latestTenantRef.current = nextTenantId;
    hasAdoptedStatusRef.current = true;
    latestVersionRef.current = nextStatus.configVersion;
    setTenantScope(nextTenantId);
    setStatus(nextStatus);
    // Preserve the stored destination for display even when the server dropped it from the
    // allowlist. Blanking it made destinationChanged true, forcing edit mode and leaving an
    // enabled connection impossible to disable until a replacement was picked; a de-allowlisted
    // destination now simply shows as unselected in the picker while disable stays available.
    if (!destinationTouchedRef.current) {
      setDestination(nextStatus.destination ?? '');
    } else if (destination === (nextStatus.destination ?? '')) {
      destinationTouchedRef.current = false;
    }
    if (!publicKeyTouchedRef.current) {
      setPublicKey(nextStatus.publicKey ?? '');
    } else if (publicKey.trim() === (nextStatus.publicKey ?? '')) {
      publicKeyTouchedRef.current = false;
    }
    // A passive sync must not advance the CAS token while a draft survives —
    // see the `expectedVersion` docstring above.
    const hasLocalDraft =
      destinationTouchedRef.current || publicKeyTouchedRef.current || secretKeyDraftRef.current;
    if (!hasLocalDraft) {
      adoptBaseline({
        version: nextStatus.configVersion ?? null,
        tenantId: nextTenantId,
        value: nextStatus,
      });
    }
  }, [connectionQuery.data]);

  useEffect(() => {
    const connectionKey = getConnectionKey(status);
    if (!connectionKey) {
      setVerificationState('idle');
      setVerificationMessage('');
      return;
    }
    if (status?.configActive === false) {
      requestRef.current += 1;
      testedConnectionRef.current = undefined;
      setVerificationState('inactive');
      setVerificationMessage('');
      return;
    }
    // Read-only viewers lack manage:configs:langfuse and cannot run verification. Show the stored
    // connection as unverified rather than "not configured", and clear the in-flight and
    // tested-connection markers so switching back to editable re-verifies from scratch.
    if (disabled) {
      requestRef.current += 1;
      testedConnectionRef.current = undefined;
      setVerificationState('unverified');
      setVerificationMessage('');
      return;
    }
    if (testedConnectionRef.current === connectionKey) return;

    testedConnectionRef.current = connectionKey;
    const requestId = ++requestRef.current;
    setVerificationState('checking');
    setVerificationMessage('');
    testMutation.mutate(
      {
        destination: status?.destination ?? '',
        publicKey: status?.publicKey ?? '',
        expectedTenantId: status?.effectiveTenantId ?? expectedTenantId,
      },
      {
        onSuccess: (result) => {
          if (requestId !== requestRef.current) return;
          testedConnectionRef.current = connectionKey;
          setVerificationState(result.success ? 'verified' : 'failed');
          setVerificationMessage(result.success ? '' : (result.message ?? ''));
        },
        onError: (error: Error) => {
          if (requestId !== requestRef.current) return;
          if (testedConnectionRef.current === connectionKey) {
            testedConnectionRef.current = undefined;
          }
          setVerificationState('failed');
          setVerificationMessage(error.message);
        },
      },
    );
  }, [status, connectionQuery.dataUpdatedAt, disabled]);

  if (isEditingScope) {
    return (
      <p className="text-sm text-(--cui-color-text-muted)">
        {localize('com_config_langfuse_tenant_wide')}
      </p>
    );
  }

  if (connectionQuery.isPending) {
    return <p className="text-sm text-(--cui-color-text-muted)">{localize('com_ui_loading')}</p>;
  }

  if (connectionQuery.isError) {
    return (
      <p role="alert" className="text-sm text-(--cui-color-text-danger)">
        {connectionQuery.error.message}
      </p>
    );
  }

  const configured = status?.configured === true;
  const configActive = status?.configActive !== false;
  const controlsDisabled = disabled || !configActive;
  const trimmedPublicKey = publicKey.trim();
  const trimmedSecretKey = secretKey.trim();
  const destinationChanged = destination !== (status?.destination ?? '');
  const publicKeyChanged = trimmedPublicKey !== (status?.publicKey ?? '');
  const isEditing =
    !configured ||
    editingPublicKey ||
    editingSecretKey ||
    destinationChanged ||
    publicKeyChanged ||
    trimmedSecretKey !== '';
  const canSave =
    !controlsDisabled &&
    destination !== '' &&
    trimmedPublicKey !== '' &&
    (configured || trimmedSecretKey !== '');
  const busy = updateMutation.isPending || testMutation.isPending;

  const markDraftUnverified = () => {
    requestRef.current += 1;
    setVerificationState('unverified');
    setVerificationMessage('');
  };

  const verify = (
    nextDestination: string,
    nextPublicKey: string,
    nextSecretKey: string,
    onVerified?: () => void,
  ) => {
    const requestId = ++requestRef.current;
    if (!nextDestination || !nextPublicKey || (!configured && !nextSecretKey)) {
      setVerificationState('idle');
      setVerificationMessage('');
      return;
    }

    setVerificationState('checking');
    setVerificationMessage('');
    testMutation.mutate(
      {
        destination: nextDestination,
        publicKey: nextPublicKey,
        expectedTenantId,
        ...(nextSecretKey ? { secretKey: nextSecretKey } : {}),
      },
      {
        onSuccess: (result) => {
          if (requestId !== requestRef.current) return;
          setVerificationState(result.success ? 'verified' : 'failed');
          setVerificationMessage(result.success ? '' : (result.message ?? ''));
          if (result.success) onVerified?.();
        },
        onError: (error: Error) => {
          if (requestId !== requestRef.current) return;
          setVerificationState('failed');
          setVerificationMessage(error.message);
        },
      },
    );
  };

  /**
   * The one place an *explicit* action (save success, conflict rebase)
   * adopts a fresh record. Sets `expectedVersion` directly and
   * unconditionally instead of leaving it to the passive sync effect above,
   * since that effect intentionally freezes the version while a draft
   * survives — exactly what an explicit action must NOT do. Guarded by the
   * same `isStaleStatus` check as the passive sync effect: an explicit
   * action's own read can itself be superseded by a different action that
   * already landed a higher version while this one was in flight.
   */
  const applyFreshStatus = (fresh: LangfuseConnectionStatus) => {
    if (isStaleStatus(fresh)) {
      return;
    }
    const freshTenantId = fresh.effectiveTenantId ?? latestTenantRef.current;
    latestTenantRef.current = freshTenantId;
    hasAdoptedStatusRef.current = true;
    latestVersionRef.current = fresh.configVersion;
    setTenantScope(freshTenantId);
    setStatus(fresh);
    if (!destinationTouchedRef.current) {
      setDestination(fresh.destination ?? '');
    } else if (destination === (fresh.destination ?? '')) {
      // The surviving draft happens to already match the fresh baseline (e.g.
      // a rebase reveals another admin's change that coincides with this
      // one) — recompute rather than leave it stuck "touched", or passive
      // refreshes would keep freezing expectedVersion for a divergence that
      // no longer exists, causing unnecessary 409s.
      destinationTouchedRef.current = false;
    }
    if (!publicKeyTouchedRef.current) {
      setPublicKey(fresh.publicKey ?? '');
    } else if (publicKey.trim() === (fresh.publicKey ?? '')) {
      publicKeyTouchedRef.current = false;
    }
    adoptBaseline({ version: fresh.configVersion ?? null, tenantId: freshTenantId, value: fresh });
  };

  /** Direct reads are version-ordered even when they race outside React Query. */
  const installFreshConnection = (fresh: LangfuseConnectionStatus): LangfuseConnectionStatus => {
    return installIfNewer(
      queryClient,
      (fresh.effectiveTenantId ?? latestTenantRef.current)
        ? [...LANGFUSE_CONNECTION_QUERY_KEY, fresh.effectiveTenantId ?? latestTenantRef.current]
        : LANGFUSE_CONNECTION_QUERY_KEY,
      fresh,
      (value) => value.configVersion,
      (value) => value.effectiveTenantId,
    );
  };

  const handleUpdateError = (error: Error) => {
    if (isVersionConflictError(error)) {
      // Do NOT touch the touched refs/destination/publicKey/secretKey here —
      // the sync effect above overwrites an untouched destination/publicKey
      // from fresh query data, but never touches secretKey or the editing
      // flags. Resetting those on conflict left secretKey and the editing
      // flags stale against a destination/publicKey the admin never typed.
      // Offer an explicit rebase/discard choice instead, same as the generic
      // configuration editor.
      setVersionConflictOpen(true);
      return;
    }
    notifyError(error.message);
  };

  const handleDiscardAfterConflict = () =>
    resolveConflict('discard', async () => {
      await queryClient.cancelQueries({ queryKey: LANGFUSE_CONNECTION_QUERY_KEY });
      const fetched = await getLangfuseConnectionFn({ data: { expectedTenantId: tenantScope } });
      const fresh = installFreshConnection(fetched);
      destinationTouchedRef.current = false;
      publicKeyTouchedRef.current = false;
      secretKeyDraftRef.current = false;
      setSecretKey('');
      setEditingPublicKey(false);
      setEditingSecretKey(false);
      applyFreshStatus(fresh);
      await refreshBaseConfig(queryClient);
    }).catch((err: Error) => notifyError(err.message));

  const handleRebaseAfterConflict = () =>
    resolveConflict('rebase', async () => {
      await queryClient.cancelQueries({ queryKey: LANGFUSE_CONNECTION_QUERY_KEY });
      const fetched = await getLangfuseConnectionFn({ data: { expectedTenantId: tenantScope } });
      const fresh = installFreshConnection(fetched);
      if ((fresh.effectiveTenantId ?? latestTenantRef.current) !== expectedTenantId) {
        destinationTouchedRef.current = false;
        publicKeyTouchedRef.current = false;
        secretKeyDraftRef.current = false;
        setSecretKey('');
        setEditingPublicKey(false);
        setEditingSecretKey(false);
        applyFreshStatus(fresh);
        await refreshBaseConfig(queryClient);
        notifyError(localize('com_config_tenant_changed'));
        return;
      }
      applyFreshStatus(fresh);
      await refreshBaseConfig(queryClient);
    }).catch((err: Error) => notifyError(err.message));

  const saveConnection = () => {
    const payload = {
      // Credential edits are committed through the explicit "Save & enable" action.
      enabled: true,
      destination,
      publicKey: trimmedPublicKey,
      ...(trimmedSecretKey ? { secretKey: trimmedSecretKey } : {}),
      expectedVersion,
      expectedTenantId,
    };
    updateMutation.mutate(payload, {
      onSuccess: async (nextStatus) => {
        destinationTouchedRef.current = false;
        publicKeyTouchedRef.current = false;
        secretKeyDraftRef.current = false;
        await queryClient.cancelQueries({ queryKey: LANGFUSE_CONNECTION_QUERY_KEY });
        const fresh = installFreshConnection(nextStatus);
        testedConnectionRef.current = getConnectionKey(fresh);
        applyFreshStatus(fresh);
        setSecretKey('');
        setEditingPublicKey(false);
        setEditingSecretKey(false);
        notifySuccess(localize('com_config_langfuse_saved'));
        // This save itself succeeded regardless of what happens next, so a
        // failure here falls back to eventual consistency via invalidation
        // instead of surfacing as an error against an action that worked.
        try {
          await refreshBaseConfig(queryClient);
        } catch {
          void queryClient.invalidateQueries({ queryKey: baseConfigOptions.queryKey });
        }
      },
      onError: handleUpdateError,
    });
  };

  const handleSave = () => {
    verify(destination, trimmedPublicKey, trimmedSecretKey, saveConnection);
  };

  const handleCancel = () => {
    destinationTouchedRef.current = false;
    publicKeyTouchedRef.current = false;
    secretKeyDraftRef.current = false;
    const cachedStatus = queryClient.getQueryData<LangfuseConnectionStatus>(connectionQueryKey);
    const latestStatus =
      cachedStatus == null || isStaleStatus(cachedStatus) ? status : cachedStatus;
    if (latestStatus) {
      applyFreshStatus(latestStatus);
    }
    const storedDestination = latestStatus?.destination;
    setSecretKey('');
    setEditingPublicKey(false);
    setEditingSecretKey(false);
    if (latestStatus?.configured && storedDestination && latestStatus.publicKey) {
      verify(storedDestination, latestStatus.publicKey, '');
    } else {
      setVerificationState('idle');
      setVerificationMessage('');
    }
  };

  const handleEnabledChange = () => {
    if (!configActive || !configured || !status?.destination || !status.publicKey) return;

    const nextEnabled = status.enabled !== true;
    updateMutation.mutate(
      {
        enabled: nextEnabled,
        destination: status.destination,
        publicKey: status.publicKey,
        expectedVersion,
        expectedTenantId,
      },
      {
        onSuccess: async (nextStatus) => {
          await queryClient.cancelQueries({ queryKey: LANGFUSE_CONNECTION_QUERY_KEY });
          const fresh = installFreshConnection(nextStatus);
          testedConnectionRef.current = getConnectionKey(fresh);
          applyFreshStatus(fresh);
          notifySuccess(localize('com_config_langfuse_saved'));
          // This save itself succeeded regardless of what happens next, so a
          // failure here falls back to eventual consistency via invalidation
          // instead of surfacing as an error against an action that worked.
          try {
            await refreshBaseConfig(queryClient);
          } catch {
            void queryClient.invalidateQueries({ queryKey: baseConfigOptions.queryKey });
          }
        },
        onError: handleUpdateError,
      },
    );
  };

  const statusLabel = getVerificationLabel(verificationState, verificationMessage, localize);
  const statusDotClass = getVerificationDotClass(verificationState);

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{localize('com_config_langfuse_enabled')}</span>
          <span className="w-fit rounded-full border border-(--cui-color-stroke-default) px-2 py-0.5 text-[10px] font-medium text-(--cui-color-text-muted)">
            {localize('com_config_langfuse_beta')}
          </span>
        </div>
        <span className="text-xs text-(--cui-color-text-muted)">
          {localize('com_config_langfuse_description')}
        </span>
      </div>

      <div
        className="flex items-center gap-2 text-xs text-(--cui-color-text-muted)"
        aria-live="polite"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass}`} />
        <span>{statusLabel}</span>
      </div>

      {!configActive && (
        <p
          role="status"
          className="rounded-md border border-(--cui-color-stroke-default) bg-(--cui-color-background-muted) px-3 py-2 text-sm text-(--cui-color-text-muted)"
        >
          {localize('com_config_langfuse_config_inactive')}
        </p>
      )}

      <Select
        label={localize('com_config_langfuse_destination')}
        value={destination || undefined}
        placeholder={localize('com_config_langfuse_select_destination')}
        disabled={controlsDisabled || busy || (status?.destinations.length ?? 0) === 0}
        onSelect={(value) => {
          destinationTouchedRef.current = value !== (status?.destination ?? '');
          setDestination(value);
          verify(value, trimmedPublicKey, trimmedSecretKey);
        }}
      >
        {status?.destinations.map(({ key, baseUrl }) => (
          <Select.Item key={key} value={key}>
            {key} - {baseUrl}
          </Select.Item>
        ))}
      </Select>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{localize('com_config_langfuse_public_key')}</span>
        {configured && !editingPublicKey ? (
          <button
            type="button"
            className="rounded-md border border-(--cui-color-stroke-default) px-3 py-2 text-left hover:border-(--cui-color-stroke-emphasis) focus-visible:outline-2 focus-visible:outline-(--cui-color-stroke-emphasis)"
            disabled={controlsDisabled || busy}
            onClick={() => setEditingPublicKey(true)}
            aria-label={`${localize('com_ui_edit')} ${localize('com_config_langfuse_public_key')}`}
          >
            <code className="text-sm">{maskPublicKey(publicKey)}</code>
          </button>
        ) : (
          <TextField
            id="langfuse-public-token"
            name="langfuse-public-token"
            label=""
            autoFocus={editingPublicKey}
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
            value={publicKey}
            disabled={controlsDisabled || busy}
            placeholder="pk-lf-..."
            onChange={(value) => {
              publicKeyTouchedRef.current = value.trim() !== (status?.publicKey ?? '');
              setPublicKey(value);
              markDraftUnverified();
            }}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{localize('com_config_langfuse_secret_key')}</span>
        {configured && !editingSecretKey ? (
          <button
            type="button"
            className="rounded-md border border-(--cui-color-stroke-default) px-3 py-2 text-left hover:border-(--cui-color-stroke-emphasis) focus-visible:outline-2 focus-visible:outline-(--cui-color-stroke-emphasis)"
            disabled={controlsDisabled || busy}
            onClick={() => setEditingSecretKey(true)}
            aria-label={`${localize('com_ui_edit')} ${localize('com_config_langfuse_secret_key')}`}
          >
            <code className="text-sm">{status?.secretKeyPreview ?? status?.displaySecretKey}</code>
          </button>
        ) : (
          <TextField
            id="langfuse-private-token"
            name="langfuse-private-token"
            label=""
            autoFocus={editingSecretKey}
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
            value={secretKey}
            disabled={controlsDisabled || busy}
            placeholder="sk-lf-..."
            onChange={(value) => {
              secretKeyDraftRef.current = value.trim() !== '';
              setSecretKey(value);
              markDraftUnverified();
            }}
          />
        )}
      </div>

      <div className="flex min-h-9 items-center justify-end gap-2">
        {isEditing ? (
          <>
            <Button
              type="secondary"
              label={localize('com_ui_cancel')}
              disabled={disabled || busy}
              onClick={handleCancel}
            />
            <Button
              type="primary"
              label={
                testMutation.isPending
                  ? localize('com_config_langfuse_checking')
                  : localize('com_config_langfuse_save_and_enable')
              }
              loading={busy}
              disabled={!canSave || busy}
              onClick={handleSave}
            />
          </>
        ) : (
          <Button
            type={status?.enabled === true ? 'secondary' : 'primary'}
            label={localize(
              status?.enabled === true
                ? 'com_config_langfuse_disable'
                : 'com_config_langfuse_enable',
            )}
            disabled={controlsDisabled || busy}
            loading={updateMutation.isPending}
            onClick={handleEnabledChange}
          />
        )}
      </div>

      <VersionConflictDialog
        open={versionConflictOpen}
        rebasing={rebasingVersion}
        discarding={discardingConflict}
        onRebase={handleRebaseAfterConflict}
        onDiscard={handleDiscardAfterConflict}
      />
    </div>
  );
}

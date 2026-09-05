/**
 * Dialog for creating a new custom endpoint entry.
 *
 * Uses the same grouped field layout as expanded custom endpoint cards —
 * both are driven by the `FIELD_GROUPS` config in EndpointsRenderer via
 * the `renderFields` prop injected from the parent.
 */

import { useState, useCallback } from 'react';
import type * as t from '@/types';
import { PREVIOUS_IDENTITY_HINT_KEY } from '@/utils';
import { FormDialog } from '@/components/shared';
import { useLocalize } from '@/hooks';

export function CreateCustomEndpointDialog({
  open,
  onClose,
  onSave,
  fields,
  renderFields,
  existingNames,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (entry: Record<string, t.ConfigValue>) => void;
  fields: t.SchemaField[];
  renderFields: t.CollectionRenderFields;
  /** Names already in use — the backend keys credential preservation and
   *  restoration by this exact identity, and rejects a same-request
   *  collision outright rather than guessing which entry the credentials
   *  belong to; this check gives that feedback immediately instead of
   *  round-tripping to the server first. */
  existingNames: ReadonlySet<string>;
}) {
  const localize = useLocalize();
  const [draft, setDraft] = useState<Record<string, t.ConfigValue>>({});
  const [error, setError] = useState<string | undefined>();

  const handleFieldChange = useCallback((key: string, value: t.ConfigValue) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError(undefined);
  }, []);

  const handleSubmit = useCallback(() => {
    const name = typeof draft.name === 'string' ? draft.name.trim() : '';
    if (!name) {
      setError(localize('com_config_endpoint_name_required'));
      return;
    }
    if (existingNames.has(name)) {
      setError(localize('com_config_endpoint_name_duplicate'));
      return;
    }
    const entry: Record<string, t.ConfigValue> = {
      // Explicit, not absent: an absent hint falls back to bare-identity
      // matching on save, which would let this brand-new entry inherit
      // another entry's credentials merely by reusing a name freed up by a
      // delete earlier in the same edit — see `withPreviousIdentityHint`.
      [PREVIOUS_IDENTITY_HINT_KEY]: null,
    };
    for (const [key, val] of Object.entries(draft)) {
      if (val === '' || val === undefined || val === null) continue;
      if (Array.isArray(val) && val.length === 0) continue;
      entry[key] = val;
    }
    onSave(entry);
    setDraft({});
    setError(undefined);
    onClose();
  }, [draft, localize, onSave, onClose, existingNames]);

  const handleClose = useCallback(() => {
    setDraft({});
    setError(undefined);
    onClose();
  }, [onClose]);

  return (
    <FormDialog
      open={open}
      title={localize('com_config_create_endpoint')}
      submitLabel={localize('com_ui_create')}
      submitDisabled={!draft.name || (typeof draft.name === 'string' && !draft.name.trim())}
      saving={false}
      error={error}
      size="lg"
      onSubmit={handleSubmit}
      onClose={handleClose}
    >
      {renderFields(fields, draft, 'create-endpoint', handleFieldChange)}
    </FormDialog>
  );
}

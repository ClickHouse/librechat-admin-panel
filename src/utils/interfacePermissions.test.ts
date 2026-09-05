import { describe, expect, it } from 'vitest';
import type * as t from '@/types';
import {
  filterInterfacePermissionChildren,
  isInterfacePermissionPath,
  stripInterfacePermissionFields,
} from './interfacePermissions';
import { createField } from '@/test/fixtures';

describe('isInterfacePermissionPath', () => {
  it('allows field-specific UI keys and nested trustCheckbox paths', () => {
    expect(isInterfacePermissionPath('interface.mcpServers.placeholder')).toBe(false);
    expect(isInterfacePermissionPath('interface.mcpServers.trustCheckbox')).toBe(false);
    expect(isInterfacePermissionPath('interface.mcpServers.trustCheckbox.label')).toBe(false);
    expect(isInterfacePermissionPath('interface.marketplace.verification')).toBe(false);
    expect(isInterfacePermissionPath('interface.skills.defaultActiveOnShare')).toBe(false);
    expect(isInterfacePermissionPath('interface.sharedLinks.snapshotFiles')).toBe(false);
    expect(isInterfacePermissionPath('interface.endpointsMenu')).toBe(false);
  });

  it('rejects UI keys under a permission field that does not own them', () => {
    expect(isInterfacePermissionPath('interface.runCode.placeholder')).toBe(true);
    expect(isInterfacePermissionPath('interface.prompts.snapshotFiles')).toBe(true);
    expect(isInterfacePermissionPath('interface.mcpServers.verification')).toBe(true);
    expect(isInterfacePermissionPath('interface.skills.snapshotFiles')).toBe(true);
    expect(isInterfacePermissionPath('interface.runCode.foo')).toBe(true);
    expect(isInterfacePermissionPath('interface.mcpServers.trustCheckbox.foo')).toBe(true);
  });

  it('allows one language-key segment beneath a localized leaf', () => {
    expect(isInterfacePermissionPath('interface.mcpServers.trustCheckbox.label.en')).toBe(false);
    expect(isInterfacePermissionPath('interface.mcpServers.trustCheckbox.subLabel.fr')).toBe(false);
  });

  it('blocks two or more segments beneath a localized leaf', () => {
    expect(isInterfacePermissionPath('interface.mcpServers.trustCheckbox.label.en.foo')).toBe(true);
  });

  it('blocks a descendant of a primitive leaf that is not a localized leaf', () => {
    expect(isInterfacePermissionPath('interface.mcpServers.placeholder.foo')).toBe(true);
  });
});

describe('stripInterfacePermissionFields', () => {
  it('keeps only UI keys that belong to each permission field', () => {
    expect(
      stripInterfacePermissionFields({
        modelSelect: true,
        runCode: { placeholder: 'nope' } as never,
        mcpServers: {
          placeholder: 'Choose MCP',
          use: true,
          verification: true,
          trustCheckbox: { label: 'Trust', extra: true },
        } as never,
        prompts: { snapshotFiles: true } as never,
        skills: { defaultActiveOnShare: true, snapshotFiles: false } as never,
        sharedLinks: { snapshotFiles: false, placeholder: 'nope' } as never,
      }),
    ).toEqual({
      modelSelect: true,
      mcpServers: {
        placeholder: 'Choose MCP',
        trustCheckbox: { label: 'Trust' },
      },
      skills: { defaultActiveOnShare: true },
      sharedLinks: { snapshotFiles: false },
    });
  });

  it('strips nested containers at primitive leaves', () => {
    expect(
      stripInterfacePermissionFields({
        mcpServers: {
          placeholder: { foo: 'bad' } as never,
        } as never,
        marketplace: { verification: { nested: true } as never } as never,
        skills: { defaultActiveOnShare: ['bad'] as never } as never,
        sharedLinks: { snapshotFiles: false },
      }),
    ).toEqual({
      sharedLinks: { snapshotFiles: false },
    });
  });

  it('allows localized label records but strips nested objects within them', () => {
    expect(
      stripInterfacePermissionFields({
        mcpServers: {
          trustCheckbox: {
            label: { en: 'Trust', fr: 'Confiance' } as never,
            subLabel: { en: { nested: 'bad' } as never } as never,
          } as never,
        } as never,
      }),
    ).toEqual({
      mcpServers: {
        trustCheckbox: {
          label: { en: 'Trust', fr: 'Confiance' },
        },
      },
    });
  });
});

describe('filterInterfacePermissionChildren', () => {
  it('keeps only UI children owned by each permission field', () => {
    const children: t.SchemaField[] = [
      createField({ key: 'modelSelect', type: 'boolean' }),
      createField({ key: 'runCode', type: 'boolean' }),
      createField({
        key: 'mcpServers',
        children: [
          createField({ key: 'use', type: 'boolean' }),
          createField({ key: 'placeholder', type: 'string' }),
          createField({
            key: 'trustCheckbox',
            children: [
              createField({ key: 'label', type: 'string' }),
              createField({ key: 'extra', type: 'string' }),
            ],
          }),
        ],
      }),
    ];

    const filtered = filterInterfacePermissionChildren(children);
    expect(filtered.map((child) => child.key)).toEqual(['modelSelect', 'mcpServers']);
    expect(filtered[1]?.children?.map((child) => child.key)).toEqual([
      'placeholder',
      'trustCheckbox',
    ]);
    expect(filtered[1]?.children?.[1]?.children?.map((child) => child.key)).toEqual(['label']);
  });
});

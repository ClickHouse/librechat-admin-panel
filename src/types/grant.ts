import type { AdminAuditLogEntry, AuditAction } from '@librechat/data-schemas';
import type { PrincipalType } from 'librechat-data-provider';
import type { KeyboardEvent } from 'react';

export interface AuditLogEntryWithDiff extends AdminAuditLogEntry {
  before?: readonly string[];
  after?: readonly string[];
}

export interface AuditSearchQualifiers {
  actor?: string;
  target?: string;
  capability?: string;
  createdAfter?: string;
  createdBefore?: string;
}

export interface ParsedAuditSearch {
  freeText: string;
  qualifiers: AuditSearchQualifiers;
}

export interface GrantDiff {
  added: readonly string[];
  removed: readonly string[];
  unchanged: readonly string[];
}

export interface PrincipalRow {
  principalType: PrincipalType;
  principalId: string;
  name: string;
  grantCount: number;
  isActive: boolean;
}

export type ActionFilter = 'all' | AuditAction;

export interface AuditLogRowProps {
  entry: AdminAuditLogEntry;
  isLast: boolean;
}

export interface CapabilityPanelProps {
  capabilities: Record<string, boolean>;
  onChange: (capabilities: Record<string, boolean>) => void;
  disabled?: boolean;
}

export interface EditCapabilitiesDialogProps {
  principalType: PrincipalType | null;
  principalId: string | null;
  principalName: string;
  onClose: () => void;
}

export interface GrantsPageProps {
  activeTab: 'management' | 'audit-log';
  onTabChange: (tab: string) => void;
}

export interface GrantTableRowProps {
  row: PrincipalRow;
  isLast: boolean;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => void;
  rowRef: (el: HTMLTableRowElement | null) => void;
}

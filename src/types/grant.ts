import type { AdminAuditLogEntry } from '@librechat/data-schemas';
import type { PrincipalType } from 'librechat-data-provider';
import type { KeyboardEvent } from 'react';

export interface AuditLogEntryWithDiff extends AdminAuditLogEntry {
  before?: readonly string[];
  after?: readonly string[];
}

export interface PrincipalRow {
  principalType: PrincipalType;
  principalId: string;
  name: string;
  grantCount: number;
  isActive: boolean;
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

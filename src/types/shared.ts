import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type { ReactNode, RefObject } from 'react';
import type { MenuIconName } from './scope';

export interface ReorderableListHandle {
  discard: () => void;
  save: () => void;
}

export interface ReorderableListProps<T extends { id: string }> {
  items: T[];
  isLoading: boolean;
  filterFn: (item: T, query: string) => boolean;
  renderItemContent: (item: T) => ReactNode;
  searchPlaceholder: string;
  emptyMessage: string;
  reorderHint: string;
  onSaveOrder: (orderedIds: string[]) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  actionRef?: RefObject<ReorderableListHandle | null>;
  headerAction: ReactNode;
  children?: ReactNode;
  reorderDisabled?: boolean;
}

export interface KebabMenuItem {
  label: string;
  icon?: MenuIconName;
  danger?: boolean;
  onClick: () => void;
}

export interface KebabMenuProps {
  items: KebabMenuItem[];
  ariaLabel?: string;
}

export interface AvatarProps {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}

export interface EditButtonProps {
  onClick: () => void;
  ariaLabel: string;
  size?: 'xs' | 'sm';
  disabled?: boolean;
}

export interface EmptyStateProps {
  message: string;
  className?: string;
}

export interface FormDialogProps {
  open: boolean;
  title: string;
  submitLabel: string;
  submitDisabled?: boolean;
  saving?: boolean;
  error?: string;
  size?: 'sm' | 'lg';
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}

export interface LoadingStateProps {
  className?: string;
}

export type HovercardPlacement =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'left-start'
  | 'left-end'
  | 'right-start'
  | 'right-end';

export interface HovercardProps {
  /** Visible anchor content, rendered inside a focusable button that reveals the
   *  card on hover and on keyboard focus. */
  trigger: ReactNode;
  children: ReactNode;
  /** Accessible name for the trigger button — required when the trigger is icon-only. */
  label?: string;
  /** Optional bold heading rendered at the top of the card. */
  heading?: string;
  placement?: HovercardPlacement;
  /** Distance in px between the trigger and the card. */
  gutter?: number;
  triggerClassName?: string;
  className?: string;
}

export interface ScreenReaderAnnouncerProps {
  message: string;
}

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  ariaLabel?: string;
}

export interface SelectedMemberListProps {
  users: AdminUserSearchResult[];
  onRemove: (userId: string) => void;
  disabled?: boolean;
}

export interface StickyActionBarProps {
  discardLabel: string;
  saveLabel: string;
  onDiscard: () => void;
  onSave: () => void;
  message?: string;
}

export interface StatusToggleProps {
  id: string;
  isActive: boolean;
  onChange: (isActive: boolean) => void;
  disabled?: boolean;
}

export interface TrashButtonProps {
  onClick: () => void;
  ariaLabel: string;
  size?: 'xs' | 'sm';
  disabled?: boolean;
}

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export interface UserSearchInlineProps {
  existingIds: string[];
  onAdd: (user: AdminUserSearchResult) => void;
  listboxId?: string;
  disabled?: boolean;
}

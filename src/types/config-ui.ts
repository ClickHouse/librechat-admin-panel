import type { ReactNode } from 'react';
import type {
  ConfigScope,
  IconName,
  ScopeSelection,
  FieldProfileValue,
  ScopePermissions,
} from './scope';
import type { ConfigValue, FlatConfigMap, SchemaField } from './config';

export interface ConfigTab {
  id: string;
  labelKey: string;
  permission?: string;
}

export interface TocItem {
  id: string;
  label: string;
  /** Config path prefix for configured-only filtering. Falls back to
   *  stripping "section-" from `id` if not set. */
  dataPath?: string;
}

export interface ConfigSectionConfig {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  learnMoreUrl?: string;
  icon?: string;
  fields: SchemaField[];
  sectionField?: SchemaField;
  /** When set, use this key for config value lookup and field path prefixing
   *  instead of `id`. Used by virtual sections that share another section's
   *  schema data but render under a different tab/renderer. */
  schemaKey?: string;
  /** When set, the TOC renders these items instead of deriving children from
   *  the schema fields. Used by tabs like Custom Endpoints where the TOC
   *  should show configured entry names rather than field structure. */
  tocItems?: TocItem[];
  /** Optional info banner displayed at the top of the section content. */
  bannerText?: string;
}

export interface ConfigPageProps {
  initialTab?: string;
  highlightField?: string;
  initialScope?: string;
}

export interface ConfigTabBarProps {
  tabs: ConfigTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  tabCounts?: Record<string, number>;
  children?: ReactNode;
}

export interface ConfigTabContentProps {
  sections: ConfigSectionConfig[];
  configValues: Record<string, ConfigValue> | null;
  editedValues: FlatConfigMap;
  onFieldChange: (path: string, value: ConfigValue) => void;
  onResetField?: (path: string) => void;
  profileMap?: Record<string, string[]>;
  previewMode?: boolean;
  previewScope?: ConfigScope;
  previewChangedPaths?: string[] | null;
  resolvedValues?: FlatConfigMap | null;
  permissions?: ScopePermissions;
  onProfileChange?: () => void;
  showChangedOnly?: boolean;
  readOnly?: boolean;
  configuredPaths?: Set<string>;
  dbOverridePaths?: Set<string>;
  touchedPaths?: Set<string>;
  pendingResets?: Set<string>;
  sectionPermissions?: Record<string, { canView: boolean; canEdit: boolean }>;
  schemaDefaults?: FlatConfigMap;
  showConfiguredOnly?: boolean;
  isEditingScope?: boolean;
  /** YAML-defined entry keys per section, keyed by parent path. */
  baseRecordKeys?: Record<string, Set<string>>;
  onValidationError?: (message: string) => void;
}

export interface ConfigTableOfContentsProps {
  sections: ConfigSectionConfig[];
  scrollContainer: HTMLElement | null;
  tocRef: (el: HTMLElement | null) => void;
  showConfiguredOnly?: boolean;
  configuredPaths?: Set<string>;
  onNavigate?: (sectionId: string) => void;
}

export interface ConfigRowProps {
  title: string;
  description?: string;
  learnMoreUrl?: string;
  badge?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
  fieldId?: string;
  fieldPath?: string;
  previewMode?: boolean;
  previewScope?: ConfigScope;
  previewChangedPaths?: string[] | null;
  resolvedValues?: FlatConfigMap | null;
  permissions?: ScopePermissions;
  onProfileChange?: () => void;
  onResetField?: (path: string) => void;
  isConfigured?: boolean;
  isDbOverride?: boolean;
  isTouched?: boolean;
  isPendingReset?: boolean;
  defaultHint?: string | null;
}

export interface ConfigSectionProps {
  sectionId?: string;
  title: string;
  description?: string;
  learnMoreUrl?: string;
  children: ReactNode;
  hidden?: boolean;
  configuredCount?: number;
  totalCount?: number;
  defaultExpanded?: boolean;
  inline?: boolean;
  showConfiguredOnly?: boolean;
}

export interface ConfirmSaveDialogProps {
  open: boolean;
  editedValues: FlatConfigMap;
  originalValues: FlatConfigMap;
  saving: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface ContentToolbarProps {
  scrollContainer: HTMLElement | null;
  showConfiguredOnly: boolean;
  onShowConfiguredOnlyChange: (v: boolean) => void;
  showConfiguredToggle: boolean;
}

export interface DeleteProfileValueModalProps {
  scope: ConfigScope | null;
  fieldLabel: string;
  saving: boolean;
  onConfirm: (scope: ConfigScope) => void;
  onCancel: () => void;
}

export interface FieldProfilePopoverProps {
  fieldPath: string;
  fieldLabel: string;
  fieldSchema?: SchemaField;
  profileValues: FieldProfileValue[];
  permissions: ScopePermissions;
  onProfileChange?: () => void;
  baseValue?: ConfigValue;
  onBaseValueChange?: (value: ConfigValue) => void;
}

export interface CascadeItemProps {
  label: string;
  icon: IconName;
  color: string;
  sublabel: string;
}

export interface SingleFieldRendererProps {
  field: SchemaField;
  value: ConfigValue;
  path: string;
  getValue: (path: string, fallback: ConfigValue) => ConfigValue;
  onChange: (path: string, value: ConfigValue) => void;
  onResetField?: (path: string) => void;
  disabled?: boolean;
  permissions?: ScopePermissions;
  onProfileChange?: () => void;
  previewMode?: boolean;
  previewScope?: ConfigScope;
  previewChangedPaths?: string[] | null;
  resolvedValues?: FlatConfigMap | null;
  configuredPaths?: Set<string>;
  dbOverridePaths?: Set<string>;
  touchedPaths?: Set<string>;
  pendingResets?: Set<string>;
  schemaDefaults?: FlatConfigMap;
  showConfiguredOnly?: boolean;
  isSoleField?: boolean;
}

export interface FieldRendererProps {
  fields: SchemaField[];
  parentValue: ConfigValue;
  parentPath: string;
  getValue: (path: string, fallback: ConfigValue) => ConfigValue;
  onChange: (path: string, value: ConfigValue) => void;
  onResetField?: (path: string) => void;
  editedValues?: FlatConfigMap;
  disabled?: boolean;
  profileMap?: Record<string, string[]>;
  previewMode?: boolean;
  previewScope?: ConfigScope;
  previewChangedPaths?: string[] | null;
  resolvedValues?: FlatConfigMap | null;
  permissions?: ScopePermissions;
  onProfileChange?: () => void;
  showChangedOnly?: boolean;
  configuredPaths?: Set<string>;
  dbOverridePaths?: Set<string>;
  touchedPaths?: Set<string>;
  pendingResets?: Set<string>;
  schemaDefaults?: FlatConfigMap;
  showConfiguredOnly?: boolean;
  isEditingScope?: boolean;
  /** YAML-defined entry keys for the section being rendered. */
  yamlBaseKeys?: Set<string>;
  onValidationError?: (message: string) => void;
}

export interface ImportYamlDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (appConfig: Record<string, ConfigValue>) => void;
  onImportAsProfile: (appConfig: Record<string, ConfigValue>, scope: ConfigScope) => Promise<void>;
}

export type ImportTab = 'upload' | 'paste';
export type ImportStep = 'input' | 'target';
export type TargetMode = 'base' | 'existing' | 'create';

export interface ImportValidationError {
  path: string;
  message: string;
}

export interface InfoBannerProps {
  text: string;
  dismissible?: boolean;
  variant?: 'info' | 'scope-preview' | 'scope-edit';
  scopeSelection?: ScopeSelection;
  onBackToBase?: () => void;
}

export interface PreviewProfileActionsProps {
  fieldPath: string;
  fieldLabel: string;
  fieldSchema?: SchemaField;
  scope: ConfigScope;
  currentValue: ConfigValue;
  onProfileChange?: () => void;
}

export interface ProfileIndicatorProps {
  fieldPath: string;
  fieldLabel: string;
  fieldSchema?: SchemaField;
  profileTypes?: string[];
  permissions: ScopePermissions;
  onProfileChange?: () => void;
  baseValue?: ConfigValue;
  onBaseValueChange?: (value: ConfigValue) => void;
}

export interface ProfileValueModalProps {
  open: boolean;
  fieldSchema?: SchemaField;
  controlType: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  scopeName: string;
  scopeType: string;
  mode: 'edit' | 'add';
}

export interface ModalValueControlProps {
  fieldSchema?: SchemaField;
  controlType: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  onSubmit: () => void;
}

export interface ScopeSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSelection: ScopeSelection;
  onSelect: (selection: ScopeSelection) => void;
  permissions: ScopePermissions;
  onError?: (message: string) => void;
}

export interface ScopeItemProps {
  scope: ConfigScope;
  isSelected: boolean;
  onSelect: (scope: ConfigScope) => void;
  localize: (key: string, interpolation?: Record<string, string | number>) => string;
}

export interface ScopeTriggerButtonProps {
  currentSelection: ScopeSelection;
  onClick: () => void;
}

export interface SectionControlsProps {
  children: ReactNode;
}

export interface SectionHeaderProps {
  title: string;
  description?: string;
  learnMoreUrl?: string;
  htmlFor?: string;
  titleAdornment?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}

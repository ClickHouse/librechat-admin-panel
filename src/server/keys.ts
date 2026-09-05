export const tenantQueryKeys = {
  effectiveCapabilitiesForTenant: (tenantId: string) =>
    ['effectiveCapabilities', tenantId] as const,
  effectiveCapabilities: (tenantId: string, userId: string) =>
    ['effectiveCapabilities', tenantId, userId] as const,
  grants: (tenantId: string) => ['systemGrants', tenantId] as const,
  principalGrants: (tenantId: string, principalType: string, principalId: string) =>
    ['systemGrants', tenantId, principalType, principalId] as const,
  auditLog: (tenantId: string) => ['auditLog', tenantId] as const,
  auditLogPage: (tenantId: string, page: number, filters: object) =>
    ['auditLog', tenantId, page, filters] as const,
  auditLogEntry: (tenantId: string, id?: string) => ['auditLogEntry', tenantId, id] as const,
  users: (tenantId: string) => ['users', tenantId] as const,
  userSearch: (tenantId: string, query: string) => ['userSearch', tenantId, query] as const,
  roles: (tenantId: string) => ['roles', tenantId] as const,
  allRoles: (tenantId: string) => ['roles', tenantId, 'all'] as const,
  role: (tenantId: string) => ['role', tenantId] as const,
  roleDetail: (tenantId: string, roleName: string) => ['role', tenantId, roleName] as const,
  roleAssignments: (tenantId: string) => ['roleAssignments', tenantId] as const,
  roleMembers: (tenantId: string) => ['roleMembers', tenantId] as const,
  roleMemberList: (tenantId: string, roleId: string) => ['roleMembers', tenantId, roleId] as const,
  roleMemberPage: (tenantId: string, roleId: string, page: number) =>
    ['roleMembers', tenantId, roleId, page] as const,
  groups: (tenantId: string) => ['groups', tenantId] as const,
  allGroups: (tenantId: string) => ['groups', tenantId, 'all'] as const,
  groupAssignments: (tenantId: string) => ['groupAssignments', tenantId] as const,
  groupMembers: (tenantId: string) => ['groupMembers', tenantId] as const,
  groupMemberList: (tenantId: string, groupId: string) =>
    ['groupMembers', tenantId, groupId] as const,
  groupMemberPage: (tenantId: string, groupId: string, page: number) =>
    ['groupMembers', tenantId, groupId, page] as const,
  availableScopes: (tenantId: string) => ['availableScopes', tenantId] as const,
  fieldProfileValues: (tenantId: string, fieldPath: string) =>
    ['fieldProfileValues', tenantId, fieldPath] as const,
};

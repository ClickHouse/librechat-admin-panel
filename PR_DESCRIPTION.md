## Summary

Fixes #72 and #73.

The admin panel uses `configSchema` from `librechat-data-provider` to validate imported YAML configs and individual field edits. This schema contains `z.nativeEnum()` validators that reject values not present in the bundled enum at build time. When LibreChat adds new enum values (e.g. `subagents`, `skills` in agent capabilities, or any future addition to endpoint types, OCR strategies, etc.), the admin panel rejects otherwise valid configs — blocking users from using new features.

This PR makes validation lenient for enum mismatches: if the only validation errors are `invalid_enum_value`, the config is accepted as-is. Structural and type errors still block import. This keeps the admin panel forward-compatible with newer LibreChat versions without requiring a synchronized release.

### Changes

- `parseImportedYaml`: When `configSchema.safeParse()` fails exclusively with enum errors, accept the raw config (LibreChat validates at runtime anyway)
- `validateFieldValue`: Filter out enum errors from field-level validation so the UI doesn't block edits containing new upstream values

## Change Type

- Bug fix (non-breaking change which fixes an issue)

## Testing

1. Create a `librechat.yaml` with agent capabilities that include `subagents` and `skills`:
   ```yaml
   version: 1.3.12
   endpoints:
     agents:
       capabilities:
         - 'execute_code'
         - 'file_search'
         - 'web_search'
         - 'artifacts'
         - 'subagents'
         - 'skills'
         - 'tools'
         - 'chain'
         - 'ocr'
   ```
2. Import via the admin panel config editor
3. **Before this fix**: Validation error on `subagents` and `skills`
4. **After this fix**: Config imports successfully, all values preserved

Also verified that configs with actual structural errors (wrong types, missing required fields) still fail validation as expected.

### **Test Configuration**:

- LibreChat config version: 1.3.12
- `librechat-data-provider`: 0.8.505 (locked version that already includes `subagents`/`skills` in the enum — but the fix is generic and protects against future additions too)

## Checklist

- [x] My code adheres to this project's style guidelines
- [x] I have performed a self-review of my own code
- [x] I have commented in any complex areas of my code
- [x] My changes do not introduce new warnings
- [x] Local unit tests pass with my changes

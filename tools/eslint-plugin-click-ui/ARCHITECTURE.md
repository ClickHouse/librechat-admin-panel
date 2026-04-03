# Click UI ESLint Plugin - Architecture & Overview

## Project Structure

```
eslint-plugin-click-ui/
├── index.js                    # Main plugin entry point
├── package.json                # Package configuration
├── README.md                   # Comprehensive documentation
├── QUICK_START.md             # Quick start guide
├── .eslintrc.json             # Example configuration
├── rules/                      # Individual rule implementations
│   ├── require-provider.js
│   ├── require-css-import.js
│   ├── button-requires-label.js
│   ├── icon-name-format.js
│   ├── logo-name-format.js
│   ├── valid-icon-name.js
│   ├── valid-logo-name.js
│   ├── container-requires-orientation.js
│   ├── table-structure.js
│   ├── dialog-controlled-state.js
│   ├── form-controlled-components.js
│   ├── prefer-named-imports.js
│   ├── valid-theme-name.js
│   ├── valid-spacing-token.js
│   ├── valid-icon-size.js
│   ├── valid-button-type.js
│   ├── select-requires-options.js
│   └── datepicker-controlled.js
├── tests/                      # Test suite
│   └── rules.test.js
├── correct-examples.tsx        # Examples of correct usage
└── test-examples.tsx          # Examples of violations
```

## Rule Categories

### 1. Setup Rules (Critical)
These ensure the basic Click UI setup is correct:
- `require-provider`: Ensures ClickUIProvider wraps the app
- `require-css-import`: Ensures cui.css is imported

**Impact**: Without these, Click UI won't work at all

### 2. Component API Rules (Errors)
These catch incorrect component usage that will cause runtime errors:
- `button-requires-label`: Button needs label prop, not children
- `container-requires-orientation`: Container needs orientation
- `table-structure`: Table needs headers/rows, not data/columns
- `dialog-controlled-state`: Dialog needs controlled state
- `form-controlled-components`: Form inputs need value/onChange
- `select-requires-options`: Select needs all required props
- `datepicker-controlled`: DatePicker needs controlled state

**Impact**: These will cause runtime errors or broken components

### 3. Naming Convention Rules (Errors)
These enforce correct naming patterns:
- `icon-name-format`: Icons use hyphens (check-in-circle)
- `logo-name-format`: Logos use underscores (digital_ocean)

**Impact**: Wrong formats won't find the icon/logo assets
**Auto-fixable**: Yes

### 4. Validation Rules (Warnings)
These validate against known valid values:
- `valid-icon-name`: Checks against 165 valid icon names
- `valid-logo-name`: Checks against 58 valid logo names
- `valid-theme-name`: Validates theme values
- `valid-spacing-token`: Validates spacing tokens
- `valid-icon-size`: Validates icon sizes
- `valid-button-type`: Validates button types

**Impact**: Invalid values won't render correctly
**Provides**: Helpful suggestions for typos

### 5. Best Practice Rules (Warnings)
These encourage good patterns:
- `prefer-named-imports`: Use named imports for tree-shaking

**Impact**: Performance and bundle size

## Key Design Decisions

### 1. Two Config Presets
- **recommended**: Balanced (errors for critical, warnings for suggestions)
- **strict**: All rules as errors for maximum enforcement

### 2. Auto-fixable Where Possible
Rules that can be automatically fixed:
- `button-requires-label`: Converts children to label
- `icon-name-format`: Converts to hyphen format
- `logo-name-format`: Converts to underscore format

### 3. Smart Detection
- Only checks root files (App.tsx, _app.tsx) for provider/CSS
- Validates icon/logo names against actual library
- Suggests similar names using Levenshtein distance

### 4. TypeScript-Friendly
- Works with .tsx files
- Understands JSX expressions
- Validates against TypeScript types

## Common Patterns Detected

### Pattern 1: Missing Setup
```tsx
// ❌ Detected
function App() {
  return <Button label="Click" />;
}

// ✅ Fixed
import '@clickhouse/click-ui/cui.css';
import { ClickUIProvider } from '@clickhouse/click-ui';

function App() {
  return (
    <ClickUIProvider theme="dark">
      <Button label="Click" />
    </ClickUIProvider>
  );
}
```

### Pattern 2: Button Children
```tsx
// ❌ Detected (auto-fixable)
<Button>Click me</Button>

// ✅ Fixed to
<Button label="Click me" />
```

### Pattern 3: Icon/Logo Names
```tsx
// ❌ Detected (auto-fixable)
<Icon name="check_circle" />
<Logo name="digital-ocean" />

// ✅ Fixed to
<Icon name="check-in-circle" />
<Logo name="digital_ocean" />
```

### Pattern 4: Uncontrolled Components
```tsx
// ❌ Detected
<TextField label="Name" />
<Dialog defaultOpen={true}>...</Dialog>

// ✅ Correct pattern shown in error
const [name, setName] = useState('');
const [open, setOpen] = useState(false);

<TextField label="Name" value={name} onChange={setName} />
<Dialog open={open} onOpenChange={setOpen}>...</Dialog>
```

## Implementation Details

### AST Traversal
The plugin uses ESLint's AST (Abstract Syntax Tree) traversal:
- `ImportDeclaration`: Checks imports
- `JSXElement`: Checks component usage
- `JSXAttribute`: Checks prop values
- `Program:exit`: Performs file-level checks

### Name Validation
Icon and logo names are validated against comprehensive lists:
- **Icons** (165 total): check, cross, warning, arrow-down, etc.
- **Logos** (58 total): clickhouse, aws_s3, digital_ocean, etc.

Uses Levenshtein distance algorithm for "Did you mean?" suggestions.

### Type Validation
Validates against Click UI's TypeScript types:
- `ThemeName`: "dark" | "light" | "classic"
- `IconSize`: "xs" | "sm" | "md" | "lg" | "xl" | "xxl"
- `ButtonType`: "primary" | "secondary" | "empty" | "danger" | "ghost"
- `SpacingToken`: "none" | "xxs" | "xs" | "sm" | "md" | "lg" | "xl" | "xxl"

## Performance Considerations

### Fast by Design
- Rules only check relevant JSX elements
- No expensive operations in hot paths
- Icon/logo validation uses Set lookups (O(1))
- Levenshtein calculation only when suggesting alternatives

### Optimizations
- Setup rules only check root files
- Name format rules fix before validation
- Early returns when conditions not met

## Integration Points

### With ESLint
Standard ESLint plugin architecture:
- Exports rules and configs
- Uses ESLint's RuleTester for tests
- Follows ESLint plugin naming convention

### With IDEs
Works automatically with:
- VS Code (via ESLint extension)
- WebStorm/IntelliJ (built-in ESLint)
- Any editor with ESLint support

### With CI/CD
Can be used in build pipelines:
```bash
eslint src/**/*.tsx --max-warnings 0
```

## Future Enhancements

Potential additions:
1. More granular validation of Table structure
2. Accessibility checks (ARIA labels, etc.)
3. Performance hints (memo usage, etc.)
4. Theme consistency checks
5. Custom rule configuration per project
6. Integration with Click UI's actual type definitions

## Testing Strategy

### Unit Tests
Each rule has test cases for:
- Valid code (should pass)
- Invalid code (should fail)
- Edge cases

### Integration Tests
Test full plugin configuration:
- Recommended config
- Strict config
- Custom configs

### Real-World Testing
Test on actual Click UI projects:
- ClickHouse control plane
- Example applications
- Community projects

## Maintenance

### Keeping Up-to-Date
When Click UI updates:
1. Update icon/logo name lists
2. Add new component rules
3. Update type validations
4. Test against new version
5. Update documentation

### Version Strategy
- Follow semantic versioning
- Major: Breaking changes to rules
- Minor: New rules, non-breaking changes
- Patch: Bug fixes, doc updates

## Resources

- [ESLint Plugin Docs](https://eslint.org/docs/latest/extend/plugins)
- [AST Explorer](https://astexplorer.net/) - Visualize AST
- [Click UI Docs](https://clickhouse.design/click-ui)
- [Click UI GitHub](https://github.com/ClickHouse/click-ui)

---

**Total Rules**: 17  
**Auto-fixable Rules**: 3  
**Coverage**: Setup, Component APIs, Naming, Validation, Best Practices  
**Status**: Production Ready

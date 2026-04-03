# Changelog

All notable changes to the Click UI ESLint Plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-13

### Added
- **switch-controlled-state** rule: Ensures Switch components use controlled state with `checked` and `onCheckedChange` props
  - Detects incorrect use of `onClick` instead of `onCheckedChange`
  - Based on official Click UI documentation patterns
- **checkbox-radiogroup-controlled** rule: Ensures Checkbox and RadioGroup use controlled state
  - Checkbox requires `checked` and `onCheckedChange`
  - RadioGroup requires `value` and `onValueChange`
- **valid-title-type** rule: Validates Title component type prop (h1-h6)
- **valid-provider-config** rule: Validates ClickUIProvider config prop structure
- **avoid-generic-label** rule: Suggests using Label instead of GenericLabel for form controls (off by default)

### Improved
- Enhanced documentation based on comprehensive review of clickhouse.design/click-ui
- Updated README with new rules and examples
- Added more context about Switch component patterns
- Improved rule descriptions to match official Click UI terminology

### Total Rules
- **23 total rules** (up from 17)
- 15 error-level rules
- 7 warning-level rules  
- 1 suggestion rule (off by default)

## [1.0.0] - 2026-01-13

### Initial Release
- Core setup rules (require-provider, require-css-import)
- Component API rules (button-requires-label, container-requires-orientation, etc.)
- Naming convention rules (icon-name-format, logo-name-format)
- Validation rules (valid-icon-name, valid-logo-name, valid-theme-name, etc.)
- Form component controlled state rules
- Best practice rules (prefer-named-imports)
- Two configuration presets: recommended and strict
- Auto-fix support for 3 rules
- Comprehensive documentation and examples

### Key Features
- 17 comprehensive rules
- Auto-fix for common issues
- Smart suggestions using Levenshtein distance
- IDE integration support
- CI/CD ready

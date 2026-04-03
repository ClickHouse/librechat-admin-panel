# Click UI Linter - Team Rollout Guide

## What Is This?

A comprehensive ESLint plugin that catches common Click UI mistakes and enforces best practices. It's like having an expert Click UI developer review every line of code automatically.

## Why Do We Need This?

**Problems it solves:**
- ❌ People forget to import the CSS file
- ❌ Button components used with children instead of label
- ❌ Icon names use underscores instead of hyphens
- ❌ Logo names use hyphens instead of underscores  
- ❌ Form components used without proper state management
- ❌ Wrong Table props (data/columns vs headers/rows)
- ❌ Uncontrolled Dialog/DatePicker components
- ❌ Invalid theme/size/spacing values
- ❌ Missing ClickUIProvider wrapper

**Results:**
- ✅ Catches mistakes before code review
- ✅ Auto-fixes many issues
- ✅ Provides helpful error messages
- ✅ Works in VS Code/WebStorm automatically
- ✅ Integrates with CI/CD

## Phase 1: Install & Test (Week 1)

### Step 1: Install in One Project
Pick a small, non-critical project to test:

```bash
npm install --save-dev eslint-plugin-click-ui
```

### Step 2: Add Configuration
Add to `.eslintrc.json`:

```json
{
  "extends": ["plugin:click-ui/recommended"]
}
```

### Step 3: Run It
```bash
npx eslint src/**/*.tsx
```

**Expected Result**: You'll see errors for existing mistakes. Don't panic! Many can be auto-fixed.

### Step 4: Auto-Fix What You Can
```bash
npx eslint src/**/*.tsx --fix
```

**This will fix:**
- Icon name formats (check_circle → check-in-circle)
- Logo name formats (digital-ocean → digital_ocean)
- Button children → label conversions (simple cases)

### Step 5: Fix Remaining Issues Manually
The linter will give you clear error messages:
```
error  Button component requires "label" prop  click-ui/button-requires-label
error  Icon name "nonexistent" is not valid   click-ui/valid-icon-name
Did you mean "check-in-circle"?
```

## Phase 2: Team Education (Week 2)

### Internal Documentation
Share these files with the team:
1. `QUICK_START.md` - How to use it
2. `README.md` - Full documentation
3. `correct-examples.tsx` - Examples of correct code
4. `test-examples.tsx` - Examples of mistakes

### Team Meeting Agenda (30 min)

**Intro (5 min)**
- Why we built this
- Problems it solves
- Benefits to developers

**Demo (10 min)**
- Show auto-fix in action
- Show IDE integration
- Show error messages

**Common Issues (10 min)**
Walk through the top 5 mistakes:
1. Missing CSS import
2. Button label vs children
3. Icon/Logo naming
4. Uncontrolled form components
5. Missing Container orientation

**Q&A (5 min)**
- How to disable rules when needed
- How it affects CI/CD
- Performance impact (minimal)

## Phase 3: Gradual Rollout (Week 3-4)

### Option A: Warning Mode First
Start with all rules as warnings:

```json
{
  "extends": ["plugin:click-ui/recommended"],
  "rules": {
    "click-ui/*": "warn"
  }
}
```

**Pros**: Non-blocking, lets people learn  
**Cons**: Easy to ignore

### Option B: Critical Rules Only
Start with just the critical rules:

```json
{
  "plugins": ["click-ui"],
  "rules": {
    "click-ui/require-provider": "error",
    "click-ui/require-css-import": "error",
    "click-ui/button-requires-label": "error",
    "click-ui/icon-name-format": "error",
    "click-ui/logo-name-format": "error"
  }
}
```

**Pros**: Focuses on high-impact issues  
**Cons**: Misses some helpful checks

### Option C: Full Recommended (Recommended)
Use the recommended config from day 1:

```json
{
  "extends": ["plugin:click-ui/recommended"]
}
```

**Pros**: Full protection, clear expectations  
**Cons**: More initial errors to fix

## Phase 4: CI/CD Integration (Week 4)

### Add to CI Pipeline

**package.json:**
```json
{
  "scripts": {
    "lint": "eslint src/**/*.{ts,tsx}",
    "lint:fix": "eslint src/**/*.{ts,tsx} --fix"
  }
}
```

**CI configuration (.github/workflows/lint.yml):**
```yaml
name: Lint
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm ci
      - run: npm run lint
```

### Pre-commit Hooks (Optional)
Using husky:

```json
{
  "husky": {
    "hooks": {
      "pre-commit": "eslint src/**/*.{ts,tsx} --fix"
    }
  }
}
```

## Common Questions

### Q: What if I need to disable a rule?
A: Use eslint comments:
```tsx
// eslint-disable-next-line click-ui/button-requires-label
<Button>{dynamicContent}</Button>
```

Or disable for a file:
```tsx
/* eslint-disable click-ui/button-requires-label */
```

### Q: Does this slow down development?
A: No - it's faster to catch errors early than debug runtime issues.

### Q: Can we customize the rules?
A: Yes! Override any rule in `.eslintrc.json`:
```json
{
  "extends": ["plugin:click-ui/recommended"],
  "rules": {
    "click-ui/valid-icon-name": "off"
  }
}
```

### Q: What about legacy code?
A: Three options:
1. Fix it all at once (use auto-fix)
2. Fix gradually (use warning mode)
3. Disable for legacy files:
```tsx
/* eslint-disable click-ui/button-requires-label */
```

### Q: How do we keep it updated?
A: When Click UI updates:
1. Check for linter updates: `npm update eslint-plugin-click-ui`
2. Review changelog for new rules
3. Update team documentation if needed

## Success Metrics

Track these to measure impact:

**Before Linter:**
- Number of Click UI bugs in production
- Code review time spent on Click UI issues
- Time spent debugging component issues

**After Linter:**
- Should see 70-90% reduction in Click UI bugs
- Faster code reviews (auto-catches issues)
- Fewer "why isn't this working?" questions

## Support Resources

**Documentation:**
- `README.md` - Full documentation
- `QUICK_START.md` - Quick reference
- `ARCHITECTURE.md` - Technical details

**Examples:**
- `correct-examples.tsx` - How to do it right
- `test-examples.tsx` - Common mistakes

**External:**
- [Click UI Docs](https://clickhouse.design/click-ui)
- [Click UI AI Reference](https://clickhouse.design/click-ui/ai-quick-reference)

## Feedback Loop

**Week 1-2:** Daily check-ins
- What's working?
- What's confusing?
- Any false positives?

**Month 1:** Review and adjust
- Which rules are most helpful?
- Any rules too strict?
- Performance issues?

**Quarterly:** Major updates
- New Click UI features
- New rules needed?
- Team satisfaction survey

## Rollback Plan

If things go wrong:

**Quick disable:**
```json
{
  "extends": [],
  "plugins": []
}
```

**Gradual disable:**
```json
{
  "extends": ["plugin:click-ui/recommended"],
  "rules": {
    "click-ui/*": "off"
  }
}
```

**Then investigate:**
1. What went wrong?
2. Configuration issue?
3. Bug in linter?
4. Need better documentation?

## Expected Timeline

**Week 1:** Install & test in one project  
**Week 2:** Team education & documentation  
**Week 3:** Rollout to 3-5 projects  
**Week 4:** Full rollout + CI/CD  
**Week 5+:** Monitor, adjust, optimize  

## Champion Responsibilities

Assign a "linter champion" for:
- Answering team questions
- Updating documentation
- Monitoring feedback
- Proposing rule changes
- Keeping plugin updated

## Celebration Criteria

Declare success when:
- ✅ 80%+ of projects using it
- ✅ < 5 click-ui bugs/month in production
- ✅ Positive team feedback
- ✅ Code reviews 30% faster
- ✅ New developers onboarded faster

---

**Remember**: The goal isn't perfect code on day 1. It's continuous improvement and catching mistakes early. Start small, learn, adjust, scale up.

**Questions?** Ask the linter champion or check the docs.

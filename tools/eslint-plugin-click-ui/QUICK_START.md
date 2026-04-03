# Quick Start Guide

## 1. Install the Plugin

```bash
npm install --save-dev eslint-plugin-click-ui
```

## 2. Configure ESLint

Add to your `.eslintrc.json`:

```json
{
  "extends": ["plugin:click-ui/recommended"],
  "plugins": ["click-ui"]
}
```

## 3. Run the Linter

```bash
# Check for errors
npx eslint src/**/*.{ts,tsx}

# Auto-fix what can be fixed
npx eslint src/**/*.{ts,tsx} --fix
```

## 4. Integrate with Your Editor

### VS Code

1. Install the ESLint extension
2. Errors will show up inline automatically
3. Use `Ctrl+Shift+P` → "ESLint: Fix all auto-fixable Problems"

### WebStorm/IntelliJ

1. ESLint is built-in
2. Go to Preferences → Languages & Frameworks → JavaScript → Code Quality Tools → ESLint
3. Enable ESLint

## Common Fixes

### Missing CSS Import
```tsx
// Add this to your root file (App.tsx, _app.tsx, etc.)
import '@clickhouse/click-ui/cui.css';
```

### Missing Provider
```tsx
// Wrap your app
import { ClickUIProvider } from '@clickhouse/click-ui';

function App() {
  return (
    <ClickUIProvider theme="dark">
      {/* Your app */}
    </ClickUIProvider>
  );
}
```

### Button Requires Label
```tsx
// ❌ Wrong
<Button>Click me</Button>

// ✅ Correct
<Button label="Click me" />
```

### Icon Names Use Hyphens
```tsx
// ❌ Wrong
<Icon name="check_circle" />

// ✅ Correct (auto-fixable)
<Icon name="check-in-circle" />
```

### Logo Names Use Underscores
```tsx
// ❌ Wrong
<Logo name="digital-ocean" />

// ✅ Correct (auto-fixable)
<Logo name="digital_ocean" />
```

### Container Needs Orientation
```tsx
// ❌ Wrong
<Container>
  <div>Content</div>
</Container>

// ✅ Correct
<Container orientation="vertical">
  <div>Content</div>
</Container>
```

### Form Components Must Be Controlled
```tsx
// ❌ Wrong
<TextField label="Name" />

// ✅ Correct
const [name, setName] = useState('');
<TextField 
  label="Name" 
  value={name} 
  onChange={(e) => setName(e.target.value)} 
/>
```

## What Gets Caught?

✅ Missing CSS imports  
✅ Missing ClickUIProvider wrapper  
✅ Button using children instead of label prop  
✅ Wrong Icon/Logo name formats  
✅ Invalid Icon/Logo names  
✅ Missing required props  
✅ Uncontrolled form components  
✅ Wrong Table structure  
✅ Invalid theme/size/type values  
✅ Default imports instead of named imports  

## Need Help?

- [Full Documentation](./README.md)
- [Click UI Docs](https://clickhouse.design/click-ui)
- [Example Code](./correct-examples.tsx)

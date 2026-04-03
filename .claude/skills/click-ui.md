---
name: click-ui
description: Build interfaces using the Click UI design system (@clickhouse/click-ui). Use this skill when working with ClickHouse frontend projects, React components using Click UI, or when the user mentions Click UI components like Button, TextField, Dialog, Table, etc.
globs: ['**/*.tsx', '**/*.jsx', '**/*.ts']
version: 0.1.0
alwaysApply: false
---

# Click UI Design System - AI Assistant Skill

## Overview

Click UI is the official design system and component library for ClickHouse, built with React, TypeScript, and styled-components. This skill provides guidance for effectively using Click UI in development workflows.

**Official Documentation**: https://clickhouse.design/click-ui  
**GitHub Repository**: https://github.com/ClickHouse/click-ui  
**NPM Package**: `@clickhouse/click-ui`

## Critical First Steps

**ESSENTIAL AI-SPECIFIC RESOURCE**: https://clickhouse.design/click-ui/ai-quick-reference
This page is specifically designed for AI assistants and contains:

- Complete component props reference
- All 165 icon names and 58 logo names
- Common error patterns to avoid
- State management patterns
- Validation examples
- Type definitions

**ALWAYS consult the official documentation** at https://clickhouse.design/click-ui when:

- Learning about a specific component's API
- Understanding current best practices
- Checking for updates or changes
- Reviewing component examples
- Exploring design patterns

The documentation is the source of truth and may contain updates beyond this skill's knowledge.

## Installation & Setup

### Basic Installation

```bash
npm i @clickhouse/click-ui
# or
yarn add @clickhouse/click-ui
```

### Essential Setup Pattern

Every Click UI application MUST be wrapped in `ClickUIProvider`:

```typescript
import { ClickUIProvider } from '@clickhouse/click-ui'

function App() {
  return (
    <ClickUIProvider theme="dark">
      {/* Your app components */}
    </ClickUIProvider>
  )
}
```

**Note**: Click UI uses styled-components for styling, so no CSS import is required. The styles are injected automatically via JavaScript.

## Core Architecture Concepts

### 1. Provider Configuration

The `ClickUIProvider` accepts two main props:

```typescript
<ClickUIProvider
  theme={theme}           // 'dark' | 'light'
  config={{
    tooltip: {
      delayDuration: 0    // Customize component defaults
    }
  }}
>
```

### 2. Theming System

Click UI uses a robust design token system:

- **Dark mode**: Default theme, optimized for data visualization
- **Light mode**: Alternative theme
- **Theme switching**: Runtime theme changes supported
- **Design tokens**: Documented at https://clickhouse.design/click-ui/tokens

### 3. Accessibility First

All Click UI components are built with accessibility in mind:

- ARIA labels and roles
- Keyboard navigation
- Screen reader support
- Reference: https://clickhouse.design/click-ui/accessibility

## Component Categories

Click UI components organized by category:

| Category       | Components                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layout**     | Container, Grid, GridContainer, Panel                                                                                                                            |
| **Forms**      | TextField, TextArea, NumberField, PasswordField, SearchField, Checkbox, RadioGroup, Switch, Select, AutoComplete, DatePicker, DateRangePicker, FileUpload, Label |
| **Display**    | Text, Title, Badge, Avatar, BigStat, CodeBlock, ProgressBar, Icon, Logo, Link                                                                                    |
| **Navigation** | Tabs, FileTabs, FullWidthTabs, Accordion, MultiAccordion, VerticalStepper, Pagination                                                                            |
| **Sidebar**    | SidebarNavigationItem, SidebarNavigationTitle, SidebarCollapsibleItem, SidebarCollapsibleTitle                                                                   |
| **Overlays**   | Dialog, Flyout, Popover, Tooltip, HoverCard, ConfirmationDialog                                                                                                  |
| **Actions**    | Button, ButtonGroup, IconButton, Dropdown, ContextMenu                                                                                                           |
| **Feedback**   | Alert, Toast, ToastProvider                                                                                                                                      |
| **Data**       | Table, Cards, DateDetails                                                                                                                                        |
| **Utilities**  | Spacer, Separator                                                                                                                                                |

### Sidebar Navigation Components

Click UI provides dedicated sidebar navigation components:

```typescript
import { SidebarNavigationItem } from '@clickhouse/click-ui'

<SidebarNavigationItem
  icon="database"
  label="SQL console"
  selected={isActive}
  onClick={() => setActive('sql')}
/>
```

These are preferred over custom styled buttons for navigation menus.

## Common Usage Patterns

### Pattern 1: Theme Switching

```typescript
import { ClickUIProvider, Switch, ThemeName } from '@clickhouse/click-ui'
import { useState } from 'react'

function App() {
  const [theme, setTheme] = useState<ThemeName>('dark')

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <ClickUIProvider theme={theme}>
      <Switch
        checked={theme === 'dark'}
        onCheckedChange={toggleTheme}
        label="Dark mode"
      />
      {/* Rest of app */}
    </ClickUIProvider>
  )
}
```

### Pattern 2: Form Components

```typescript
import { TextField, NumberField, Select, Button, Container } from '@clickhouse/click-ui'
import { useState } from 'react'

function Form() {
  const [username, setUsername] = useState('')
  const [age, setAge] = useState('')
  const [country, setCountry] = useState('')

  return (
    <Container orientation="vertical" gap="md">
      <TextField
        label="Username"
        placeholder="Enter username"
        value={username}
        onChange={setUsername}
      />
      <NumberField
        label="Age"
        min={0}
        max={120}
        value={age}
        onChange={setAge}
      />
      <Select
        label="Country"
        options={countries}
        value={country}
        onSelect={setCountry}
      />
      <Button label="Submit" type="primary" onClick={handleSubmit} />
    </Container>
  )
}
```

### Pattern 3: Dialog/Modal

```typescript
import { Dialog, Button } from '@clickhouse/click-ui'
import { useState } from 'react'

function MyComponent() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button label="Open Dialog" onClick={() => setOpen(true)} />
      <Dialog open={open} onOpenChange={setOpen}>
        <Dialog.Content title="My Dialog" onClose={() => setOpen(false)}>
          <p>Dialog content goes here</p>
          <Button label="Close" onClick={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog>
    </>
  )
}
```

### Pattern 4: Data Tables

Tables in Click UI are sophisticated. Always check:
https://clickhouse.design/click-ui/table

Basic table usage requires understanding:

- Column definitions
- Data binding
- Sorting/filtering
- Pagination
- Custom renderers

### Pattern 5: Icon and Logo Usage

Click UI includes comprehensive icon and logo libraries.

**Icons (165 total)**:

- Reference: https://clickhouse.design/click-ui/iconLibrary
- AI Quick Reference: https://clickhouse.design/click-ui/ai-quick-reference (complete list)
- Icons use **hyphens** in names (e.g., `check-in-circle`, `arrow-down`)
- Common icons: `check`, `cross`, `warning`, `info-in-circle`, `arrow-down`, `chevron-down`, `search`, `filter`, `gear`, `user`, `calendar`, `clock`, `bell`, `home`, `database`, `table`, `download`, `upload`, `trash`, `edit`, `pencil`, `plus`, `minus`

```typescript
import { Icon } from '@clickhouse/click-ui'

<Icon name="check-in-circle" size="md" state="success" />
<Icon name="arrow-down" size="sm" />
<Icon name="info-in-circle" size="lg" state="info" />
```

**Logos (58 total)**:

- Reference: https://clickhouse.design/click-ui/logoLibrary
- AI Quick Reference: https://clickhouse.design/click-ui/ai-quick-reference (complete list)
- Logos use **underscores** in names (e.g., `digital_ocean`, `aws_s3`)
- Common logos: `clickhouse`, `aws`, `gcp`, `azure`, `github`, `google`, `mysql`, `postgres`, `kafka`, `snowflake`, `databricks`, `mongodb`, `python`, `nodejs`, `rust`, `golang`

```typescript
import { Logo } from '@clickhouse/click-ui'

<Logo name="clickhouse" size="md" theme="light" />
<Logo name="digital_ocean" size="lg" />
<Logo name="aws_s3" size="md" theme="dark" />
```

**Critical**: Icon names use hyphens; Logo names use underscores. This is a common source of errors.

**Verified working icon names** (discovered through testing):

- Navigation: `chevron-down`, `chevron-right`, `chevron-left`, `arrow-right`, `arrow-left`
- Actions: `plus`, `refresh`, `gear`, `eye`, `plug`, `sparkle`
- Data: `database`, `table`, `lightening` (note: not "lightning")
- UI: `clock`, `info-in-circle`, `building`, `user`

**Icon names that DON'T work** (common mistakes):

- `terminal`, `code`, `file`, `squares`, `chart`, `export`, `message`, `question-mark`, `backup`

## State Management Patterns

All Click UI components are **controlled components** - they require external state management. See the AI Quick Reference for complete examples: https://clickhouse.design/click-ui/ai-quick-reference

### Form State Pattern

```typescript
const [formData, setFormData] = useState({
  name: '',
  email: '',
  age: ''
})

// Update single field
<TextField
  value={formData.name}
  onChange={(value) => setFormData({ ...formData, name: value })}
/>

// Update multiple fields
const handleChange = (field: string, value: string) => {
  setFormData({ ...formData, [field]: value })
}
```

### Dialog State Pattern

```typescript
const [open, setOpen] = useState(false)

// Open dialog
<Button label="Open" onClick={() => setOpen(true)} />

// Close dialog
<Dialog open={open} onOpenChange={setOpen}>
  <Dialog.Content onClose={() => setOpen(false)}>
    <Button label="Close" onClick={() => setOpen(false)} />
  </Dialog.Content>
</Dialog>
```

### Table Selection Pattern

```typescript
const [selectedIds, setSelectedIds] = useState<Array<string | number>>([])

<Table
  headers={headers}
  rows={rows}
  isSelectable={true}
  selectedIds={selectedIds}
  onSelect={(selectedItems) => {
    setSelectedIds(selectedItems.map(item => item.item.id))
  }}
/>
```

### Pagination State Pattern

```typescript
const [currentPage, setCurrentPage] = useState(1)
const [pageSize, setPageSize] = useState(10)
const totalPages = Math.ceil(totalItems / pageSize)

<Pagination
  currentPage={currentPage}
  totalPages={totalPages}
  onChange={setCurrentPage}
  pageSize={pageSize}
  onPageSizeChange={setPageSize}
/>
```

### Validation Pattern

```typescript
const [errors, setErrors] = useState<Record<string, string>>({})

const validate = () => {
  const newErrors: Record<string, string> = {}

  if (!formData.name.trim()) {
    newErrors.name = 'Name is required'
  }

  if (!formData.email.trim()) {
    newErrors.email = 'Email is required'
  } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
    newErrors.email = 'Email is invalid'
  }

  setErrors(newErrors)
  return Object.keys(newErrors).length === 0
}

<TextField
  value={formData.name}
  onChange={(value) => {
    setFormData({ ...formData, name: value })
    setErrors({ ...errors, name: '' }) // Clear error on change
  }}
  error={!!errors.name}
  errorText={errors.name}
/>
```

## Common Errors to Avoid

These are the most frequent mistakes when using Click UI. The AI Quick Reference page has the definitive list: https://clickhouse.design/click-ui/ai-quick-reference

### ❌ Error 1: Button with children instead of label prop

```typescript
// WRONG
<Button onClick={handleClick}>Click me</Button>

// CORRECT
<Button label="Click me" onClick={handleClick} />
```

### ❌ Error 2: Hardcoded spacing instead of tokens

```typescript
// WRONG
<Container gap="20px" padding="16px">

// CORRECT
<Container gap="md" padding="lg">
```

Available tokens: `none`, `xxs`, `xs`, `sm`, `md`, `lg`, `xl`, `xxl`

### ❌ Error 3: Uncontrolled form inputs

```typescript
// WRONG - missing value/onChange
<TextField placeholder="Enter text" />

// CORRECT - controlled component
const [value, setValue] = useState('')
<TextField value={value} onChange={setValue} placeholder="Enter text" />
```

### ❌ Error 4: Dialog without controlled state

```typescript
// WRONG
<Dialog defaultOpen={true}>

// CORRECT
const [open, setOpen] = useState(false)
<Dialog open={open} onOpenChange={setOpen}>
```

### ❌ Error 5: Wrong Table props

```typescript
// WRONG - incorrect prop names
<Table data={users} columns={columns} />

// CORRECT - uses headers/rows
<Table headers={headers} rows={rows} />
```

### ❌ Error 6: Wrong Tabs sub-component names

```typescript
// WRONG - Tabs.List doesn't exist
<Tabs value={tab} onValueChange={setTab}>
  <Tabs.List>
    <Tabs.Trigger value="one">Tab 1</Tabs.Trigger>
  </Tabs.List>
</Tabs>

// CORRECT - use TriggersList
<Tabs value={tab} onValueChange={setTab}>
  <Tabs.TriggersList>
    <Tabs.Trigger value="one">Tab 1</Tabs.Trigger>
  </Tabs.TriggersList>
</Tabs>
```

### ❌ Error 7: Wrong Avatar prop name

```typescript
// WRONG - label doesn't exist
<Avatar label="JD" />

// CORRECT - use text
<Avatar text="JD" />
```

### ❌ Error 8: Panel hasBorder expects boolean

```typescript
// WRONG - string values don't work
<Panel hasBorder="all" />
<Panel hasBorder="bottom" />

// CORRECT - boolean, then use style for specific sides
<Panel hasBorder />
<Panel hasBorder style={{ borderTop: 0, borderLeft: 0, borderRight: 0 }} />
```

### ❌ Error 9: Badge for status indicators

```typescript
// Instead of custom status dots, use Badge with state
<Badge text="" state="success" />  // Green dot
<Badge text="" state="danger" />   // Red dot
<Badge text="" state="warning" />  // Yellow dot
```

### ❌ Error 10: Missing Label for accessibility

```typescript
// WRONG
<TextField value={value} onChange={setValue} />

// CORRECT
<TextField value={value} onChange={setValue} label="Field name" />
```

## Critical: Avoid Custom CSS

**NEVER write custom CSS or styled-components unless absolutely necessary.** Click UI provides components for almost every use case. When you must customize:

### Hierarchy of Approaches (Best to Worst)

1. **Use existing Click UI components** - Check if a component already exists
2. **Use component props** - Most components have extensive prop options
3. **Extend with styled-components** - Only for adding theme-aware styles
4. **Inline styles** - Only for one-off positioning tweaks
5. **Custom CSS** - Last resort, avoid if possible

### ❌ Common Mistake: Rebuilding Existing Components

```typescript
// WRONG - Don't rebuild what Click UI provides
const CustomDropdown = styled.div`
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  /* ... 50 more lines of CSS ... */
`;

// CORRECT - Use the Select component
<Select value={value} onSelect={setValue}>
  <Select.Item value="option1">Option 1</Select.Item>
  <Select.Item value="option2">Option 2</Select.Item>
</Select>
```

### When Extending is Necessary

If you must extend, use styled-components to add theme-aware styles:

```typescript
import { Container } from '@clickhouse/click-ui'
import styled from 'styled-components'

// CORRECT - Extend with theme tokens
const SidebarContainer = styled(Container)`
  background: ${({ theme }) => theme.global.color.background.default};
  border-right: 1px solid ${({ theme }) => theme.global.color.stroke.default};
`

// If flex properties aren't working, you may need to add them explicitly
const FlexContainer = styled(Container)`
  display: flex;
  flex-direction: column;
`
```

### Theme Token Reference

When extending components, use these theme tokens:

- `theme.global.color.background.default` - Main background
- `theme.global.color.background.muted` - Muted/secondary background
- `theme.global.color.stroke.default` - Borders
- `theme.click.sidebar.main.color.background.default` - Sidebar background

## Component Selection Guide

### For Dropdowns/Selectors

| Use Case              | Component                                                               |
| --------------------- | ----------------------------------------------------------------------- |
| Service/item selector | `Select` with `Select.Item`                                             |
| Database picker       | `Select` with icon prop                                                 |
| Organization switcher | `Select`                                                                |
| User menu             | `Dropdown` with `Dropdown.Trigger`, `Dropdown.Content`, `Dropdown.Item` |
| Context actions       | `ContextMenu`                                                           |

```typescript
// Service selector pattern
<Select value={selectedService} onSelect={setSelectedService}>
  <Select.Item value="service-1" icon="aws">
    My Service
  </Select.Item>
  <Separator size="sm" />
  <Select.Item value="all" icon="services">
    All services
  </Select.Item>
</Select>

// User menu pattern
<Dropdown>
  <Dropdown.Trigger>
    <Avatar text="JD" style={{ cursor: 'pointer' }} />
  </Dropdown.Trigger>
  <Dropdown.Content>
    <Dropdown.Item icon="user">Profile</Dropdown.Item>
    <Dropdown.Item icon="moon" onSelect={toggleTheme}>
      Dark theme
    </Dropdown.Item>
  </Dropdown.Content>
</Dropdown>
```

### For Promotional/Alert Banners

| Use Case                | Component                        |
| ----------------------- | -------------------------------- |
| Trial expiration notice | `CardPromotion`                  |
| Feature announcement    | `CardPromotion`                  |
| Warning banner          | `Alert`                          |
| Info callout            | `Panel` with appropriate styling |

```typescript
// Promotional banner
<CardPromotion
  label="Your trial will expire in 23 days"
  icon="clock"
  dismissible
/>
```

### For Navigation

| Use Case                  | Component                                           |
| ------------------------- | --------------------------------------------------- |
| Main nav items            | `SidebarNavigationItem` with `type="main"`          |
| Sub nav items             | `SidebarNavigationItem`                             |
| Action buttons in sidebar | `Button` with `type="secondary"` and `align="left"` |
| Tabs                      | `Tabs` with `Tabs.TriggersList` and `Tabs.Trigger`  |

```typescript
// Navigation items
<SidebarNavigationItem
  type="main"
  icon="database"
  label="SQL Console"
  selected={activeNav === 'sql'}
  onClick={() => setActiveNav('sql')}
/>

// Action buttons (like Connect, Ask AI)
<Button
  type="secondary"
  iconLeft="arrow-right"
  align="left"
  label="Connect"
  fillWidth
/>
```

### For Layout

| Use Case       | Component                                        |
| -------------- | ------------------------------------------------ |
| Flex container | `Container` with `orientation`, `gap`, `padding` |
| Panel/card     | `Panel` with `color`, `padding`, `hasBorder`     |
| Spacing        | `Spacer` with `size`                             |
| Divider        | `Separator` with `size`                          |

```typescript
// Layout with proper spacing
<Container orientation="vertical" gap="md" padding="lg">
  <Container orientation="horizontal" justifyContent="space-between">
    <Title type="h4">Page Title</Title>
    <Button type="primary" label="Action" />
  </Container>
  <Separator size="sm" />
  <Container grow="1" fillHeight>
    {/* Content */}
  </Container>
</Container>
```

## Container Props Reference

The `Container` component is fundamental. Key props:

| Prop             | Values                                                                           | Description                |
| ---------------- | -------------------------------------------------------------------------------- | -------------------------- |
| `orientation`    | `"horizontal"` \| `"vertical"`                                                   | Flex direction             |
| `gap`            | `"none"` \| `"xxs"` \| `"xs"` \| `"sm"` \| `"md"` \| `"lg"` \| `"xl"` \| `"xxl"` | Gap between children       |
| `padding`        | Same as gap                                                                      | Padding                    |
| `justifyContent` | `"start"` \| `"end"` \| `"center"` \| `"space-between"` \| `"space-around"`      | Main axis alignment        |
| `alignItems`     | `"start"` \| `"end"` \| `"center"` \| `"stretch"`                                | Cross axis alignment       |
| `fillHeight`     | `boolean`                                                                        | Fill parent height         |
| `fillWidth`      | `boolean`                                                                        | Fill parent width          |
| `grow`           | `"0"` \| `"1"`                                                                   | Flex grow                  |
| `overflow`       | `"hidden"` \| `"auto"` \| `"visible"`                                            | Overflow behavior          |
| `isResponsive`   | `boolean`                                                                        | Enable responsive behavior |
| `maxWidth`       | `string`                                                                         | Maximum width              |

## Tabs Component Structure

Tabs require specific sub-components:

```typescript
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <Tabs.TriggersList>
    <Tabs.Trigger value="tables">Tables</Tabs.Trigger>
    <Tabs.Trigger value="queries">Queries</Tabs.Trigger>
  </Tabs.TriggersList>

  <Tabs.Content value="tables">
    {/* Tables content */}
  </Tabs.Content>

  <Tabs.Content value="queries">
    {/* Queries content */}
  </Tabs.Content>
</Tabs>
```

For styled tabs (like in sidebars), extend the components:

```typescript
const TabsStyled = styled(Tabs)`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const TabsTriggersList = styled(Tabs.TriggersList)`
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 50px;
`

const TabContent = styled(Tabs.Content)`
  display: flex;
  flex-direction: column;
  &[data-state='active'] {
    flex: 1;
    overflow: hidden auto;
  }
`
```

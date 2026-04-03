/**
 * Example file showing common Click UI mistakes that the linter catches
 * Run: eslint test-examples.tsx
 */

import { Button, Icon, Logo, Container, Table, Dialog, TextField, Select, DatePicker } from '@clickhouse/click-ui';
// ❌ ERROR: Missing CSS import
// Should include: import '@clickhouse/click-ui/cui.css';

// ❌ ERROR: Not wrapped in ClickUIProvider
function App() {
  return (
    <div>
      {/* ❌ ERROR: Button requires label prop, not children */}
      <Button>Click me</Button>
      
      {/* ✅ CORRECT */}
      <Button label="Click me" />

      {/* ❌ ERROR: Icon name uses underscores (should use hyphens) */}
      <Icon name="check_circle" />
      
      {/* ❌ WARNING: Icon name doesn't exist */}
      <Icon name="nonexistent-icon" />
      
      {/* ✅ CORRECT */}
      <Icon name="check-in-circle" />

      {/* ❌ ERROR: Logo name uses hyphens (should use underscores) */}
      <Logo name="digital-ocean" />
      
      {/* ✅ CORRECT */}
      <Logo name="digital_ocean" />

      {/* ❌ ERROR: Container missing orientation */}
      <Container>
        <div>Content</div>
      </Container>
      
      {/* ✅ CORRECT */}
      <Container orientation="vertical">
        <div>Content</div>
      </Container>

      {/* ❌ ERROR: Table using wrong props */}
      <Table data={[]} columns={[]} />
      
      {/* ✅ CORRECT */}
      <Table
        headers={[{ label: 'Name' }]}
        rows={[{ id: 1, items: [{ label: 'John' }] }]}
      />

      {/* ❌ ERROR: Dialog not using controlled state */}
      <Dialog defaultOpen={true}>
        <Dialog.Content title="Hello">Content</Dialog.Content>
      </Dialog>
      
      {/* ✅ CORRECT - but needs useState */}
      {/* <Dialog open={open} onOpenChange={setOpen}>
        <Dialog.Content title="Hello">Content</Dialog.Content>
      </Dialog> */}

      {/* ❌ ERROR: TextField not controlled */}
      <TextField label="Name" />
      
      {/* ✅ CORRECT - but needs useState */}
      {/* <TextField label="Name" value={name} onChange={setName} /> */}

      {/* ❌ ERROR: Select missing required props */}
      <Select label="Country" />
      
      {/* ✅ CORRECT - but needs useState and options */}
      {/* <Select
        label="Country"
        value={country}
        onSelect={setCountry}
        options={[{ label: 'USA', value: 'us' }]}
      /> */}

      {/* ❌ ERROR: DatePicker not controlled */}
      <DatePicker />
      
      {/* ✅ CORRECT - but needs useState */}
      {/* <DatePicker date={date} onSelectDate={setDate} /> */}

      {/* ❌ WARNING: Invalid theme value */}
      {/* <ClickUIProvider theme="blue"> */}
      
      {/* ❌ WARNING: Invalid spacing token */}
      <Container orientation="horizontal" gap="large">
        <div>Content</div>
      </Container>
      
      {/* ❌ WARNING: Invalid icon size */}
      <Icon name="check" size="medium" />
      
      {/* ❌ WARNING: Invalid button type */}
      <Button label="Click" type="default" />
    </div>
  );
}

export default App;

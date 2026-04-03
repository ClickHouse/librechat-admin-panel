/**
 * Example file showing correct Click UI usage
 * This file should pass all linter rules
 */

import '@clickhouse/click-ui/cui.css';
import { 
  ClickUIProvider,
  Button, 
  Icon, 
  Logo, 
  Container, 
  Table, 
  Dialog,
  TextField, 
  Select, 
  DatePicker,
  ThemeName
} from '@clickhouse/click-ui';
import { useState } from 'react';

function App() {
  const [theme, setTheme] = useState<ThemeName>('dark');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [date, setDate] = useState<Date>();

  const countries = [
    { label: 'USA', value: 'us' },
    { label: 'UK', value: 'uk' },
    { label: 'Canada', value: 'ca' }
  ];

  const tableHeaders = [
    { label: 'Name', isSortable: true },
    { label: 'Email' },
    { label: 'Role' }
  ];

  const tableRows = [
    { 
      id: 1, 
      items: [
        { label: 'John Doe' },
        { label: 'john@example.com' },
        { label: 'Admin' }
      ]
    },
    { 
      id: 2, 
      items: [
        { label: 'Jane Smith' },
        { label: 'jane@example.com' },
        { label: 'User' }
      ]
    }
  ];

  return (
    <ClickUIProvider theme={theme}>
      <Container orientation="vertical" gap="lg" padding="md">
        {/* Buttons */}
        <Container orientation="horizontal" gap="sm">
          <Button label="Primary" type="primary" />
          <Button label="Secondary" type="secondary" />
          <Button label="Danger" type="danger" />
          <Button label="With Icon" iconLeft="check" />
        </Container>

        {/* Icons */}
        <Container orientation="horizontal" gap="sm">
          <Icon name="check-in-circle" size="md" />
          <Icon name="arrow-down" size="lg" />
          <Icon name="info-in-circle" size="sm" />
          <Icon name="warning" />
        </Container>

        {/* Logos */}
        <Container orientation="horizontal" gap="sm">
          <Logo name="clickhouse" />
          <Logo name="digital_ocean" />
          <Logo name="aws_s3" />
          <Logo name="google_bigquery" />
        </Container>

        {/* Form Components */}
        <Container orientation="vertical" gap="md">
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
          />

          <Select
            label="Country"
            value={country}
            onSelect={setCountry}
            options={countries}
          />

          <DatePicker
            date={date}
            onSelectDate={setDate}
            placeholder="Select a date"
          />
        </Container>

        {/* Table */}
        <Table
          headers={tableHeaders}
          rows={tableRows}
          pageSize={10}
        />

        {/* Dialog */}
        <Button 
          label="Open Dialog" 
          onClick={() => setDialogOpen(true)} 
        />
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Content title="Example Dialog">
            <Container orientation="vertical" gap="md">
              <p>This is a properly configured dialog.</p>
              <Button 
                label="Close" 
                onClick={() => setDialogOpen(false)} 
              />
            </Container>
          </Dialog.Content>
        </Dialog>
      </Container>
    </ClickUIProvider>
  );
}

export default App;

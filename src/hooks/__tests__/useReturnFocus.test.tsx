import { describe, expect, it } from 'vitest';
import { useRef, useState } from 'react';
import { Dialog } from '@clickhouse/click-ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useReturnFocus } from '../useReturnFocus';

function Harness({ showTrigger }: { showTrigger: boolean }) {
  const [open, setOpen] = useState(false);
  const fallbackRef = useRef<HTMLDivElement>(null);
  const returnFocus = useReturnFocus(open, fallbackRef);
  return (
    <div>
      {showTrigger && (
        <button type="button" onClick={() => setOpen(true)}>
          open dialog
        </button>
      )}
      <div ref={fallbackRef} tabIndex={-1} data-testid="fallback" />
      <Dialog open={open} onOpenChange={setOpen}>
        <Dialog.Content
          title="Test dialog"
          showClose
          onClose={() => setOpen(false)}
          onCloseAutoFocus={returnFocus}
        >
          <button type="button">inside</button>
        </Dialog.Content>
      </Dialog>
    </div>
  );
}

async function openDialog(trigger: HTMLElement): Promise<HTMLElement> {
  trigger.focus();
  fireEvent.click(trigger);
  return screen.findByRole('dialog');
}

describe('useReturnFocus', () => {
  it('returns focus to the trigger when the dialog closes via Escape', async () => {
    render(<Harness showTrigger />);
    const trigger = screen.getByRole('button', { name: 'open dialog' });
    const dialog = await openDialog(trigger);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('returns focus to the trigger when the dialog closes via the close button', async () => {
    render(<Harness showTrigger />);
    const trigger = screen.getByRole('button', { name: 'open dialog' });
    const dialog = await openDialog(trigger);
    const closeButton = within(dialog)
      .getAllByRole('button')
      .find((button) => button.textContent !== 'inside');
    expect(closeButton).toBeDefined();
    fireEvent.click(closeButton!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('focuses the fallback when the trigger unmounted before close', async () => {
    const { rerender } = render(<Harness showTrigger />);
    const trigger = screen.getByRole('button', { name: 'open dialog' });
    const dialog = await openDialog(trigger);
    rerender(<Harness showTrigger={false} />);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('fallback')).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Hovercard } from './Hovercard';

describe('Hovercard', () => {
  it('renders a focusable trigger button with the given accessible name', () => {
    render(
      <Hovercard label="More info" trigger={<span>icon</span>}>
        Body text
      </Hovercard>,
    );
    const trigger = screen.getByRole('button', { name: 'More info' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not render card content until opened', () => {
    render(
      <Hovercard label="More info" trigger={<span>icon</span>}>
        Body text
      </Hovercard>,
    );
    expect(screen.queryByText('Body text')).not.toBeInTheDocument();
  });

  it('reveals the heading and content when the trigger is activated', async () => {
    render(
      <Hovercard label="More info" heading="Reset to default" trigger={<span>icon</span>}>
        Body text
      </Hovercard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More info' }));
    expect(await screen.findByText('Body text')).toBeInTheDocument();
    expect(screen.getByText('Reset to default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More info' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

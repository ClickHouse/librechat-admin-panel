import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Restores focus to the element that was focused when a controlled dialog
 * opened. Our dialogs render no Radix `Dialog.Trigger`, so Radix's default
 * `onCloseAutoFocus` finds a null `triggerRef` and focus falls to
 * `document.body`. Pass the returned callback as `onCloseAutoFocus` on
 * `Dialog.Content`.
 */
export function useReturnFocus(
  open: boolean,
  fallbackRef?: RefObject<HTMLElement | null>,
): (event: Event) => void {
  const capturedRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  /** Captured during render: by effect time Radix's FocusScope has already moved focus into the dialog. */
  if (open && !wasOpenRef.current && typeof document !== 'undefined') {
    capturedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;
  return useCallback(
    (event: Event) => {
      event.preventDefault();
      const captured = capturedRef.current;
      if (captured && captured !== document.body && document.contains(captured)) {
        captured.focus();
        return;
      }
      fallbackRef?.current?.focus();
    },
    [fallbackRef],
  );
}

import * as Ariakit from '@ariakit/react';
import type * as t from '@/types';
import { cn } from '@/utils';

/**
 * Accessible, click-ui-styled hovercard built on `@ariakit/react`.
 *
 * The trigger is a single focusable button that combines Ariakit's
 * `HovercardAnchor` (reveals the card on hover) and `HovercardDisclosure`
 * (reveals it on keyboard focus / click and exposes `aria-expanded`), so the
 * card is reachable by both pointer and keyboard users.
 */
export function Hovercard({
  trigger,
  children,
  label,
  heading,
  placement = 'bottom',
  gutter = 8,
  triggerClassName,
  className,
}: t.HovercardProps) {
  return (
    <Ariakit.HovercardProvider placement={placement} showTimeout={150} hideTimeout={200}>
      <Ariakit.HovercardAnchor
        render={
          <Ariakit.HovercardDisclosure
            render={
              <button
                type="button"
                aria-label={label}
                className={cn(
                  'inline-flex shrink-0 cursor-help items-center justify-center rounded-full text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default) focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--cui-color-outline)',
                  triggerClassName,
                )}
              />
            }
          />
        }
      >
        {trigger}
      </Ariakit.HovercardAnchor>
      <Ariakit.Hovercard
        portal
        gutter={gutter}
        unmountOnHide
        className={cn(
          'z-(--z-command) flex w-72 max-w-[90vw] flex-col gap-1.5 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) p-3 text-sm leading-relaxed text-(--cui-color-text-muted) shadow-lg focus-visible:outline-none',
          className,
        )}
      >
        {heading && (
          <Ariakit.HovercardHeading className="text-sm font-semibold text-(--cui-color-text-default)">
            {heading}
          </Ariakit.HovercardHeading>
        )}
        {children}
      </Ariakit.Hovercard>
    </Ariakit.HovercardProvider>
  );
}

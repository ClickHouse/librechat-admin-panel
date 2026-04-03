import { PasswordField } from '@clickhouse/click-ui';
import { forwardRef, useEffect, useRef } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { useLocalize } from '@/hooks';

type PasswordInputProps = ComponentPropsWithoutRef<typeof PasswordField>;

/**
 * Wraps click-ui PasswordField to:
 * - Add a visible focus ring on the show/hide toggle (upstream strips outline)
 * - Label the toggle button for screen readers ("Show password" / "Hide password")
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>((props, ref) => {
  const localize = useLocalize();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const updateLabel = () => {
      const input = wrapper.querySelector('input');
      const button = wrapper.querySelector('button');
      if (!input || !button) return;
      const visible = input.type === 'text';
      button.setAttribute(
        'aria-label',
        visible ? localize('com_auth_hide_password') : localize('com_auth_show_password'),
      );
    };

    updateLabel();

    const input = wrapper.querySelector('input');
    if (!input) return;

    const observer = new MutationObserver(updateLabel);
    observer.observe(input, { attributes: true, attributeFilter: ['type'] });
    return () => observer.disconnect();
  }, [localize]);

  return (
    <div ref={wrapperRef} className="password-field-a11y w-full">
      {/* eslint-disable-next-line click-ui/form-controlled-components -- value/onChange passed via ...props */}
      <PasswordField ref={ref} {...props} />
    </div>
  );
});

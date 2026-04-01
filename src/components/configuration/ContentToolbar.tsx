import { Icon } from '@clickhouse/click-ui';
import { useState, useCallback } from 'react';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

const BTN =
  'flex cursor-pointer items-center gap-1 rounded border-none bg-transparent px-1.5 py-0.5 text-xs text-(--cui-color-text-muted) transition-colors hover:bg-(--cui-color-background-hover) hover:text-(--cui-color-text-default)';

function clickAccordionTrigger(item: Element) {
  const trigger = item.querySelector<HTMLButtonElement>(':scope > button');
  if (trigger) {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
}

function expandTopLevelAccordions(container: HTMLElement) {
  const roots = container.querySelectorAll('[data-top-level-accordion]');
  for (const root of roots) {
    for (const item of root.querySelectorAll(':scope > [data-state="closed"]')) {
      clickAccordionTrigger(item);
    }
  }
}

function collapseTopLevelAccordions(container: HTMLElement) {
  const roots = container.querySelectorAll('[data-top-level-accordion]');
  for (const root of roots) {
    for (const item of root.querySelectorAll(':scope > [data-state="open"]')) {
      clickAccordionTrigger(item);
    }
  }
}

export function ContentToolbar({
  scrollContainer,
  showConfiguredOnly,
  onShowConfiguredOnlyChange,
  showConfiguredToggle,
}: t.ContentToolbarProps) {
  const localize = useLocalize();
  const [collapsed, setCollapsed] = useState(false);

  const handleExpandAll = useCallback(() => {
    if (!scrollContainer) return;
    expandTopLevelAccordions(scrollContainer);
  }, [scrollContainer]);

  const handleCollapseAll = useCallback(() => {
    if (!scrollContainer) return;
    collapseTopLevelAccordions(scrollContainer);
    scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollContainer]);

  return (
    <div className="pointer-events-auto mt-2 mr-3 inline-flex items-center rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-panel)/90 shadow-sm backdrop-blur-sm">
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title={localize('com_config_show_toolbar')}
          className="flex cursor-pointer items-center border-none bg-transparent px-2.5 py-1.5 text-(--cui-color-text-muted) transition-colors hover:text-(--cui-color-text-default)"
        >
          <Icon name="gear" size="sm" />
        </button>
      ) : (
        <div className="flex items-center gap-1 px-1.5 py-1">
          <button
            type="button"
            onClick={handleExpandAll}
            title={localize('com_config_expand_all')}
            className={BTN}
          >
            <Icon name="chevron-down" size="xs" />
            <span className="hidden sm:inline">{localize('com_config_expand_all')}</span>
          </button>
          <span className="text-xs text-(--cui-color-text-disabled)">/</span>
          <button
            type="button"
            onClick={handleCollapseAll}
            title={localize('com_config_collapse_all')}
            className={BTN}
          >
            <Icon name="chevron-right" size="xs" />
            <span className="hidden sm:inline">{localize('com_config_collapse_all')}</span>
          </button>
          {showConfiguredToggle && (
            <>
              <span className="mx-0.5 h-3.5 w-px bg-(--cui-color-stroke-default)" />
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-(--cui-color-text-muted) transition-colors select-none hover:bg-(--cui-color-background-hover) has-focus-visible:outline-1 has-focus-visible:outline-(--cui-color-outline)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onShowConfiguredOnlyChange(!showConfiguredOnly);
                }}
              >
                <input
                  type="checkbox"
                  checked={showConfiguredOnly}
                  onChange={(e) => onShowConfiguredOnlyChange(e.target.checked)}
                  className="accent-(--cui-color-accent) focus-visible:outline-none"
                />
                <span className="hidden sm:inline">
                  {localize('com_config_show_configured_only')}
                </span>
              </label>
            </>
          )}
          <span className="mx-0.5 h-3.5 w-px bg-(--cui-color-stroke-default)" />
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title={localize('com_config_minimize')}
            className={BTN}
          >
            <Icon name="cross" size="xs" />
          </button>
        </div>
      )}
    </div>
  );
}

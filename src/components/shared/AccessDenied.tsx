import { Icon } from '@clickhouse/click-ui';
import { useLocalize } from '@/hooks';
import { getLibreChatUrl } from '@/server/utils/url';
import { OrganizationSwitcher } from './OrganizationSwitcher';

export function AccessDenied() {
  const localize = useLocalize();

  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-(--cui-color-background-secondary)">
        <span aria-hidden="true" className="text-(--cui-color-text-muted)">
          <Icon name="lock" size="md" />
        </span>
      </div>
      <h2 className="text-xl font-semibold text-(--cui-color-title-default)">
        {localize('com_access_denied_title')}
      </h2>
      <p className="max-w-md text-center text-sm text-(--cui-color-text-muted)">
        {localize('com_access_denied_description')}
      </p>
      <OrganizationSwitcher />
      <a
        href={getLibreChatUrl()}
        className="mt-2 rounded-lg border border-(--cui-color-stroke-default) bg-transparent px-4 py-2 text-sm font-medium text-(--cui-color-text-default) no-underline transition-colors hover:bg-(--cui-color-background-hover)"
      >
        {localize('com_admin_return_to_librechat')}
      </a>
    </div>
  );
}

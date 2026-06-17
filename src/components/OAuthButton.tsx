import { Button, Logo } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { OAUTH_PROVIDERS } from '@/constants';
import { useLocalize } from '@/hooks';

interface OAuthButtonProps {
  provider: t.ResolvedProvider;
  isPending: boolean;
  disabled: boolean;
  onClick: () => void;
}

function renderGlyph(provider: t.ResolvedProvider, def: t.OAuthProviderDef): React.ReactNode {
  if (provider.imageUrl) {
    return <img src={provider.imageUrl} alt="" aria-hidden="true" width={20} height={20} />;
  }
  if (def.logo) {
    return <Logo name={def.logo} size="sm" />;
  }
  return null;
}

export function OAuthButton({ provider, isPending, disabled, onClick }: OAuthButtonProps) {
  const localize = useLocalize();
  const def = OAUTH_PROVIDERS.find((p) => p.id === provider.id);
  if (!def) return null;

  const label = provider.label ?? localize(def.defaultLabelKey);
  const buttonText = isPending ? localize('com_auth_sso_redirecting') : label;
  const glyph = renderGlyph(provider, def);

  if (!glyph) {
    return (
      <Button label={buttonText} type="secondary" onClick={onClick} disabled={disabled} fillWidth />
    );
  }

  return (
    // eslint-disable-next-line click-ui/button-requires-label -- OAuth glyph composition needs children
    <Button type="secondary" onClick={onClick} disabled={disabled} fillWidth>
      <span className="inline-flex items-center gap-2">
        {glyph}
        {buttonText}
      </span>
    </Button>
  );
}

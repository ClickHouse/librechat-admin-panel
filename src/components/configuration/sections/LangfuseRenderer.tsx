import { useState } from 'react';
import { Button, Switch, TextField } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { PasswordInput } from '@/components/PasswordInput';
import { testLangfuseConnectionFn } from '@/server';
import { useLocalize } from '@/hooks';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';

function asString(value: t.ConfigValue): string {
  return typeof value === 'string' ? value : '';
}

export function LangfuseRenderer(props: t.FieldRendererProps) {
  const { parentPath, parentValue, getValue, onChange, disabled } = props;
  const localize = useLocalize();

  const stored: Record<string, t.ConfigValue> =
    parentValue && typeof parentValue === 'object' && !Array.isArray(parentValue)
      ? (parentValue as Record<string, t.ConfigValue>)
      : {};

  const enabled = getValue(`${parentPath}.enabled`, stored.enabled ?? false) === true;
  const baseUrl = asString(getValue(`${parentPath}.baseUrl`, stored.baseUrl ?? ''));
  const publicKey = asString(getValue(`${parentPath}.publicKey`, stored.publicKey ?? ''));
  const fingerprint = asString(stored.secretKeyFingerprint ?? '');
  const configured = fingerprint !== '';

  const [secret, setSecret] = useState('');
  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');

  const canTest = !disabled && baseUrl !== '' && publicKey !== '' && secret !== '';

  const handleTest = async () => {
    setTestState('testing');
    setTestMessage('');
    try {
      const result = await testLangfuseConnectionFn({
        data: { baseUrl, publicKey, secretKey: secret },
      });
      setTestState(result.success ? 'ok' : 'fail');
      setTestMessage(
        result.success
          ? localize('com_config_langfuse_test_ok')
          : (result.message ?? localize('com_config_langfuse_test_fail')),
      );
    } catch {
      setTestState('fail');
      setTestMessage(localize('com_config_langfuse_test_fail'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Switch
        checked={enabled}
        disabled={disabled}
        label={localize('com_config_langfuse_enabled')}
        onCheckedChange={(value) => onChange(`${parentPath}.enabled`, value)}
      />
      <TextField
        label={localize('com_config_langfuse_base_url')}
        value={baseUrl}
        disabled={disabled}
        placeholder="https://cloud.langfuse.com"
        onChange={(value) => onChange(`${parentPath}.baseUrl`, value)}
      />
      <TextField
        label={localize('com_config_langfuse_public_key')}
        value={publicKey}
        disabled={disabled}
        placeholder="pk-lf-..."
        onChange={(value) => onChange(`${parentPath}.publicKey`, value)}
      />
      <PasswordInput
        label={localize('com_config_langfuse_secret_key')}
        value={secret}
        disabled={disabled}
        placeholder={configured ? localize('com_config_langfuse_secret_set') : 'sk-lf-...'}
        onChange={(value) => {
          setSecret(value);
          onChange(`${parentPath}.secretKey`, value);
        }}
      />
      {configured && (
        <span className="text-xs">
          {localize('com_config_langfuse_fingerprint')} <code>{fingerprint}</code>
        </span>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="secondary"
          label={localize('com_config_langfuse_test')}
          disabled={!canTest || testState === 'testing'}
          onClick={handleTest}
        />
        {testMessage !== '' && <span className="text-xs">{testMessage}</span>}
      </div>
    </div>
  );
}

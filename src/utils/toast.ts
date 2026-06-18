import { createToast } from '@clickhouse/click-ui';

export const notifySuccess = (title: string): void => createToast({ type: 'success', title });

export const notifyError = (title: string): void => createToast({ type: 'danger', title });

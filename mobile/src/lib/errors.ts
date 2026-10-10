import { ApiError } from './api';
import type { Translate } from './i18n';

/** A message the shopkeeper can understand, in the app language where we have one. */
export function errorText(e: unknown, t: Translate): string {
  if (e instanceof ApiError) {
    if (e.isNetwork) return t('err.network');
    switch (e.code) {
      case 'RATE_LIMITED':
        return t('err.rateLimited');
      case 'REMINDER_TOO_SOON':
        return t('err.reminderTooSoon');
      case 'BILL_HAS_ISSUES':
        return t('err.answers');
    }
    // Backend messages are English; better than nothing for validation errors.
    if (e.status >= 400 && e.status < 500 && e.message) return e.message;
  }
  return t('err.generic');
}

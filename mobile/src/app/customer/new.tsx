import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Banner, Button, Chip, Field, Row, s } from '../../components/ui';
import { ApiError, post } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { isValidMobile } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { Customer } from '../../lib/types';

export default function NewCustomer() {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (phone.trim() && !isValidMobile(phone)) return setError(t('cu.badPhone'));
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ customer: Customer }>('/customers', {
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim(), messagingConsent: consent } : {}),
      });
      router.replace(`/customer/${r.customer.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t('cu.phoneExists') : errorText(e, t));
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      {error ? <Banner text={error} /> : null}
      <Field testID="new-name" label={t('cu.name')} value={name} onChangeText={setName} placeholder={t('cu.namePh')} autoFocus />
      <Field testID="new-phone" label={t('cu.phoneOpt')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      {phone.trim() ? (
        <>
          <Text style={[s.text, { fontSize: 13, marginBottom: 6 }]}>{t('cu.consentText')}</Text>
          <Row style={{ marginBottom: 12 }}>
            <Chip label={t('cu.consentGive')} active={consent} onPress={() => setConsent(true)} />
            <Chip label={t('no')} active={!consent} onPress={() => setConsent(false)} />
          </Row>
        </>
      ) : null}
      <Button testID="new-submit" title={t('cu.addBtn')} onPress={submit} busy={busy} disabled={!name.trim()} />
    </ScrollView>
  );
}

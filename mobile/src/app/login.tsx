import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, C, Chip, Field, Row, s } from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { isValidMobile } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import type { Lang, Store, User } from '../lib/types';

const LANGS: { lang: Lang; label: string }[] = [
  { lang: 'hinglish', label: 'Hinglish' },
  { lang: 'hi', label: 'हिंदी' },
  { lang: 'en', label: 'English' },
];

export default function Login() {
  const { t, lang, setLang } = useI18n();
  const { signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    if (!isValidMobile(phone)) return setError(t('ob.badPhone'));
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ devCode?: string }>('POST', '/auth/otp/request', { phone }, { auth: false });
      setDevCode(res.devCode ?? null);
      setStep('code');
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) return setError(t('ob.badCode'));
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string; refreshToken: string; user: User; store: Store | null }>(
        'POST',
        '/auth/otp/verify',
        { phone, code, deviceName: `${Platform.OS} app` },
        { auth: false },
      );
      await signIn(res);
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: C.greenDark }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800', textAlign: 'center' }}>{t('app.name')}</Text>
          <Text style={{ color: C.headerSub, fontSize: 15, textAlign: 'center', marginTop: 6, marginBottom: 20 }}>{t('ob.pitch')}</Text>

          <View style={[s.card, { padding: 18 }]}>
            <Row style={{ flexWrap: 'wrap', marginBottom: 8 }}>
              {LANGS.map((l) => (
                <Chip key={l.lang} label={l.label} active={lang === l.lang} onPress={() => setLang(l.lang)} testID={`lang-${l.lang}`} />
              ))}
            </Row>

            {error ? <Banner text={error} /> : null}

            {step === 'phone' ? (
              <>
                <Field
                  testID="phone"
                  label={t('ob.phone')}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  placeholder="98765 43210"
                  maxLength={16}
                  onSubmitEditing={requestCode}
                />
                <Button testID="send-code" title={t('ob.sendCode')} onPress={requestCode} busy={busy} />
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>{t('ob.terms')}</Text>
              </>
            ) : (
              <>
                <Text style={[s.text, { marginBottom: 10 }]}>{t('ob.codeSent', { phone })}</Text>
                {devCode ? <Banner kind="info" text={`${t('ob.devCode')} ${devCode}`} /> : null}
                <Field
                  testID="code"
                  label={t('ob.code')}
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  onSubmitEditing={verify}
                />
                <Button testID="verify" title={t('ob.checkCode')} onPress={verify} busy={busy} />
                <Row style={{ justifyContent: 'space-between', marginTop: 8 }}>
                  <Button
                    kind="ghost"
                    small
                    title={t('ob.changeNumber')}
                    onPress={() => {
                      setStep('phone');
                      setCode('');
                      setError(null);
                    }}
                  />
                  <Button kind="ghost" small title={t('ob.resend')} onPress={requestCode} disabled={busy} />
                </Row>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { confirmAction } from '../../components/BillCard';
import { Banner, Button, C, Card, Chip, Row, s } from '../../components/ui';
import { patch, put } from '../../lib/api';
import { API_URL } from '../../lib/config';
import { errorText } from '../../lib/errors';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import type { Lang, Store } from '../../lib/types';

export default function Shop() {
  const { t } = useI18n();
  const { store, user, setStore, signOut } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!store) return null;

  const save = async (key: string, fn: () => Promise<{ store: Store }>) => {
    setBusy(key);
    setError(null);
    try {
      setStore((await fn()).store);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(null);
    }
  };

  const setPrefs = (language: Lang, replyStyle: Store['replyStyle']) =>
    save(`pref-${language}-${replyStyle}`, () => put('/store/preferences', { language, replyStyle }));

  const rows: [string, string][] = [
    [t('ob.shopName'), store.name],
    [t('ob.owner'), store.ownerName],
    [t('ob.city'), [store.city, store.pincode].filter(Boolean).join(' · ')],
    [t('sh.mobile'), user?.phone ?? ''],
    [t('sh.gst'), store.gstin ? `${store.gstin} · ${store.gstScheme ?? ''}` : store.pan ? t('sh.panOnly', { pan: store.pan }) : t('sh.gstNone')],
    [t('sh.summaryTime'), store.summaryTime],
  ];

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      {error ? <Banner text={error} /> : null}
      <Card>
        <Text style={s.h2}>{t('sh.details')}</Text>
        {rows.map(([k, v]) => (
          <Row key={k} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={{ color: C.muted }}>{k}</Text>
            <Text style={[s.text, { flexShrink: 1, textAlign: 'right' }]}>{v}</Text>
          </Row>
        ))}
      </Card>

      <Card>
        <Text style={s.h2}>{t('sh.appLang')}</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {(
            [
              ['hinglish', 'Hinglish'],
              ['hi', 'हिंदी'],
              ['en', 'English'],
            ] as [Lang, string][]
          ).map(([l, label]) => (
            <Chip key={l} testID={`shop-lang-${l}`} label={label} active={store.language === l} onPress={() => setPrefs(l, store.replyStyle)} />
          ))}
        </Row>
        <Text style={[s.h2, { marginTop: 8 }]}>{t('sh.reply')}</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          <Chip label={t('sh.voiceText')} active={store.replyStyle === 'voice_text'} onPress={() => setPrefs(store.language, 'voice_text')} />
          <Chip label={t('sh.textOnly')} active={store.replyStyle === 'text'} onPress={() => setPrefs(store.language, 'text')} />
        </Row>
      </Card>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.text, { fontWeight: '700' }]}>{t('sh.credit')}</Text>
            <Text style={{ color: C.muted }}>{store.givesCredit ? t('sh.creditYes') : t('sh.creditNo')}</Text>
          </View>
          <Button
            small
            kind="secondary"
            busy={busy === 'credit'}
            title={store.givesCredit ? t('sh.creditOff') : t('sh.creditOn')}
            onPress={() => save('credit', () => patch('/store', { givesCredit: !store.givesCredit }))}
          />
        </Row>
      </Card>

      <Card>
        <Text style={[s.text, { fontWeight: '700' }]}>{t('learn.title')}</Text>
        <Text style={{ color: C.muted, marginBottom: 8 }}>{t('learn.sub')}</Text>
        <Button testID="open-learned" small kind="secondary" title={t('chat.open')} onPress={() => router.push('/learned')} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <Button
        kind="danger"
        title={t('sh.signOut')}
        onPress={() => confirmAction(t('sh.signOutAsk'), t('yes'), t('no'), () => void signOut())}
        style={{ marginTop: 8 }}
      />
      <Text style={{ color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 16 }}>
        {t('sh.server')}: {API_URL}
      </Text>
    </ScrollView>
  );
}

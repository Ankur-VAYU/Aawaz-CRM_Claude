import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { confirmAction } from '../components/BillCard';
import { Banner, Button, C, Card, Loading, Row, s } from '../components/ui';
import { del, get, patch } from '../lib/api';
import { errorText } from '../lib/errors';
import { dateTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import type { Store } from '../lib/types';

interface LearnedNames {
  items: { id: string; name: string; aliases: string[] }[];
  customers: { id: string; name: string; aliases: string[] }[];
}
interface VoiceLog {
  optedIn: boolean;
  retentionDays: number;
  data: { id: string; text: string; outcome: 'not_understood' | 'needs_input' | 'corrected'; createdAt: string }[];
}

export default function Learned() {
  const { t, lang } = useI18n();
  const { store, setStore } = useSession();
  const [names, setNames] = useState<LearnedNames | null>(null);
  const [log, setLog] = useState<VoiceLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchAll = () => Promise.all([get<LearnedNames>('/assistant/learned'), get<VoiceLog>('/assistant/voice-log')]);
  const show = ([n, l]: [LearnedNames, VoiceLog]) => {
    setNames(n);
    setLog(l);
  };
  const load = async () => show(await fetchAll());

  useEffect(() => {
    let live = true;
    fetchAll().then(
      (r) => live && show(r),
      (e) => live && setError(errorText(e, t)),
    );
    return () => {
      live = false;
    };
  }, [t]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  if (!names || !log || !store) return error ? <Banner text={error} /> : <Loading />;

  const rows = [
    ...names.items.flatMap((i) => i.aliases.map((a) => ({ kind: 'item' as const, id: i.id, name: i.name, alias: a }))),
    ...names.customers.flatMap((c) => c.aliases.map((a) => ({ kind: 'customer' as const, id: c.id, name: c.name, alias: a }))),
  ];

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={{ color: C.muted, marginBottom: 12 }}>{t('learn.sub')}</Text>
      {error ? <Banner text={error} /> : null}

      <Card>
        <Text style={s.h2}>{t('learn.names')}</Text>
        {rows.length === 0 ? <Text style={{ color: C.muted }}>{t('learn.none')}</Text> : null}
        {rows.map((r) => (
          <Row key={`${r.kind}-${r.id}-${r.alias}`} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={[s.text, { flex: 1 }]}>
              “{r.alias}” → {r.name}
            </Text>
            <Button small kind="ghost" title={t('learn.forget')} disabled={busy} onPress={() => act(() => del('/assistant/learned', { kind: r.kind, id: r.id, alias: r.alias }))} />
          </Row>
        ))}
      </Card>

      <Card>
        <Text style={s.h2}>{t('log.title')}</Text>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.text, { fontWeight: '600' }]}>{t('log.optin')}</Text>
            <Text style={{ color: C.muted, fontSize: 13 }}>{t('log.optinSub')}</Text>
          </View>
        </Row>
        <Row style={{ justifyContent: 'space-between', marginVertical: 8 }}>
          <Text style={{ color: store.voiceLogOptIn ? C.greenDark : C.muted, fontWeight: '700' }}>{store.voiceLogOptIn ? t('log.on') : t('log.off')}</Text>
          <Button
            testID="voicelog-toggle"
            small
            kind="secondary"
            busy={busy}
            title={store.voiceLogOptIn ? t('log.turnOff') : t('log.turnOn')}
            onPress={() =>
              act(async () => {
                const r = await patch<{ store: Store }>('/store', { voiceLogOptIn: !store.voiceLogOptIn });
                setStore(r.store);
              })
            }
          />
        </Row>
        {log.data.length === 0 ? <Text style={{ color: C.muted }}>{t('log.empty')}</Text> : null}
        {log.data.map((e) => (
          <View key={e.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
            <Text style={s.text}>“{e.text}”</Text>
            <Text style={{ color: C.muted, fontSize: 12 }}>
              {t(`log.${e.outcome}`)} · {dateTime(e.createdAt, lang)}
            </Text>
          </View>
        ))}
        {log.data.length ? (
          <Button
            small
            kind="danger"
            title={t('log.clear')}
            style={{ marginTop: 8, alignSelf: 'flex-start' }}
            onPress={() => confirmAction(t('log.clear'), t('yes'), t('no'), () => void act(() => del('/assistant/voice-log')))}
          />
        ) : null}
      </Card>
    </ScrollView>
  );
}

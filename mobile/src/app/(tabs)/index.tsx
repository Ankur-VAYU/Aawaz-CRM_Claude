import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { BillCard } from '../../components/BillCard';
import { StockInCard } from '../../components/StockInCard';
import { Banner, Button, C, Chip, Row, s } from '../../components/ui';
import { ApiError, newClientId, post } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { qtyLabel, rupees } from '../../lib/format';
import { speechLocale, useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import type { AssistantResponse, Customer } from '../../lib/types';
import { speak, useVoice } from '../../lib/voice';

type Msg =
  | { id: string; from: 'me'; text: string; source: 'voice' | 'text'; clientId: string; failed?: string; sending?: boolean }
  | { id: string; from: 'bot'; res: AssistantResponse }
  | { id: string; from: 'welcome' };

// Sent as Hinglish whatever the app language: the assistant understands these in every language setting.
const QUICK = [
  { label: 'chat.summary', text: 'aaj ka hisaab' },
  { label: 'chat.lowStock', text: 'kaunsa stock kam hai' },
  { label: 'chat.customers', text: 'grahak list dikhao' },
] as const;

export default function Chat() {
  const { t, lang } = useI18n();
  const { store } = useSession();
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 'welcome', from: 'welcome' }]);
  const [text, setText] = useState('');
  const list = useRef<FlatList<Msg>>(null);
  const locale = speechLocale(lang);
  const speakReplies = store?.replyStyle === 'voice_text';

  const say = useCallback((reply: string) => speakReplies && speak(reply, locale), [speakReplies, locale]);

  const sendMsg = useCallback(
    async (msg: Extract<Msg, { from: 'me' }>) => {
      setMsgs((m) => m.map((x) => (x.id === msg.id ? { ...msg, sending: true, failed: undefined } : x)));
      try {
        // The clientId makes a retry safe: the backend never creates the same bill or payment twice.
        const res = await post<AssistantResponse>('/assistant/message', { text: msg.text, source: msg.source, clientId: msg.clientId });
        setMsgs((m) => [...m.map((x) => (x.id === msg.id ? { ...msg, sending: false } : x)), { id: `${msg.id}-r`, from: 'bot', res }]);
        if (res.reply.speak) say(res.reply.text);
      } catch (e) {
        const failed = e instanceof ApiError || e instanceof Error ? errorText(e, t) : t('err.generic');
        setMsgs((m) => m.map((x) => (x.id === msg.id ? { ...msg, sending: false, failed } : x)));
      }
    },
    [say, t],
  );

  const submit = useCallback(
    (raw: string, source: 'voice' | 'text') => {
      const value = raw.trim();
      if (!value) return;
      const clientId = newClientId();
      const msg: Extract<Msg, { from: 'me' }> = { id: clientId, from: 'me', text: value, source, clientId, sending: true };
      setMsgs((m) => [...m, msg]);
      void sendMsg(msg);
    },
    [sendMsg],
  );

  const voice = useVoice(locale, (heard) => submit(heard, 'voice'));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.chat }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        ref={list}
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 4 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <Message msg={item} onRetry={sendMsg} onSay={say} />}
      />

      <View style={{ paddingHorizontal: 8, paddingTop: 6, backgroundColor: C.chat }}>
        {voice.error ? (
          <Pressable onPress={voice.clearError}>
            <Banner text={t(voice.error)} />
          </Pressable>
        ) : null}
        {voice.listening ? (
          <View testID="listening" style={[s.card, { marginBottom: 6, backgroundColor: C.mine }]}>
            <Text style={{ color: C.greenDark, fontWeight: '700' }}>{t('listening')}</Text>
            {voice.interim ? <Text style={s.text}>{voice.interim}</Text> : null}
          </View>
        ) : (
          <Row style={{ flexWrap: 'nowrap', overflow: 'hidden' }}>
            {QUICK.map((q) => (
              <Chip key={q.label} label={t(q.label)} onPress={() => submit(q.text, 'text')} />
            ))}
          </Row>
        )}
      </View>

      <Row style={{ padding: 8, backgroundColor: C.chat, alignItems: 'flex-end' }}>
        <TextInput
          testID="chat-input"
          value={text}
          onChangeText={setText}
          placeholder={t('placeholder')}
          placeholderTextColor={C.muted}
          multiline
          style={[s.input, { flex: 1, borderRadius: 22, maxHeight: 120 }]}
          onSubmitEditing={() => {
            submit(text, 'text');
            setText('');
          }}
          blurOnSubmit={false}
          submitBehavior="submit"
        />
        {text.trim() ? (
          <RoundButton
            testID="chat-send"
            icon="send"
            label={t('send')}
            onPress={() => {
              submit(text, 'text');
              setText('');
            }}
          />
        ) : (
          <RoundButton
            testID="mic"
            icon={voice.listening ? 'stop' : 'mic'}
            label={voice.listening ? t('v.stop') : t('listening')}
            onPress={voice.listening ? voice.stop : () => void voice.start()}
            big
          />
        )}
      </Row>
    </KeyboardAvoidingView>
  );
}

function RoundButton({ icon, label, onPress, big, testID }: { icon: 'send' | 'mic' | 'stop'; label: string; onPress: () => void; big?: boolean; testID?: string }) {
  const size = big ? 56 : 48;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: C.green,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Ionicons name={icon} size={big ? 28 : 22} color="#fff" />
    </Pressable>
  );
}

function Bubble({ mine, children }: { mine?: boolean; children: React.ReactNode }) {
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '88%',
        backgroundColor: mine ? C.mine : '#fff',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 8,
      }}
    >
      {children}
    </View>
  );
}

function Message({ msg, onRetry, onSay }: { msg: Msg; onRetry: (m: Extract<Msg, { from: 'me' }>) => void; onSay: (text: string) => void }) {
  const { t } = useI18n();
  if (msg.from === 'welcome') {
    return (
      <Bubble>
        <Text style={[s.text, { fontWeight: '700' }]}>{t('welcome.1')}</Text>
        <Text style={[s.text, { marginTop: 4 }]}>{t('welcome.2')}</Text>
        {(['chat.example1', 'chat.example2', 'chat.example3'] as const).map((k) => (
          <Text key={k} style={[s.text, { color: C.greenDark, marginTop: 4 }]}>
            “{t(k)}”
          </Text>
        ))}
      </Bubble>
    );
  }
  if (msg.from === 'me') {
    return (
      <View>
        <Bubble mine>
          <Text style={s.text}>
            {msg.source === 'voice' ? '🎤 ' : ''}
            {msg.text}
          </Text>
          {msg.sending ? <Text style={{ color: C.muted, fontSize: 12 }}>{t('loading')}</Text> : null}
        </Bubble>
        {msg.failed ? (
          <View style={{ alignSelf: 'flex-end', maxWidth: '88%' }}>
            <Banner text={msg.failed} />
            <Button small kind="secondary" title={t('retry')} onPress={() => onRetry(msg)} style={{ alignSelf: 'flex-end', marginBottom: 8 }} />
          </View>
        ) : null}
      </View>
    );
  }
  const r = msg.res;
  return (
    <View>
      <Bubble>
        <Text testID="bot-reply" style={s.text}>
          {r.reply.text}
        </Text>
      </Bubble>
      {r.bill ? <BillCard initial={r.bill} onSay={onSay} /> : null}
      {r.stockIn ? <StockInCard preview={r.stockIn} /> : null}
      {r.customer ? <CustomerLink c={r.customer} /> : null}
      {r.needsInput?.options?.length ? (
        <View style={s.card}>
          <Text style={s.h2}>{t('chat.chooseCustomer')}</Text>
          {r.needsInput.options.map((c) => (
            <CustomerLink key={c.id} c={c} flat />
          ))}
        </View>
      ) : null}
      {r.customers?.length ? (
        <View style={s.card}>
          {r.customers.map((c) => (
            <CustomerLink key={c.id} c={c} flat />
          ))}
        </View>
      ) : null}
      {r.summary ? <SummaryCard summary={r.summary} /> : null}
      {r.intent === 'low_stock' && r.items?.length ? (
        <View style={s.card}>
          <Text style={s.h2}>{t('low.title')}</Text>
          {r.items.map((i) => (
            <Row key={i.id} style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
              <Text style={s.text}>{i.displayName}</Text>
              <Text style={{ color: C.danger }}>{t('low.left', { n: qtyLabel(i.stock), l: i.stockLabel ?? '' })}</Text>
            </Row>
          ))}
          <Button small kind="secondary" title={t('low.btn')} onPress={() => router.push('/receive')} style={{ marginTop: 8 }} />
        </View>
      ) : null}
    </View>
  );
}

function CustomerLink({ c, flat }: { c: Customer; flat?: boolean }) {
  const { t } = useI18n();
  return (
    <Pressable onPress={() => router.push(`/customer/${c.id}`)} style={flat ? { paddingVertical: 6 } : s.card}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <View style={[s.avatar, { width: 34, height: 34 }]}>
            <Text style={s.avatarText}>{c.initials}</Text>
          </View>
          <Text style={[s.text, { fontWeight: '600' }]}>{c.name}</Text>
        </Row>
        <Text style={{ fontWeight: '700', color: c.balance > 0 ? C.udhaarInk : C.greenDark }}>
          {c.balance > 0 ? rupees(c.balance) : t('kh.clear')}
        </Text>
      </Row>
    </Pressable>
  );
}

function SummaryCard({ summary }: { summary: NonNullable<AssistantResponse['summary']> }) {
  const { t } = useI18n();
  const rows: [string, string][] = [
    [t('sum.bills', { n: summary.sales.bills }), rupees(summary.sales.total)],
    [t('sum.paid'), rupees(summary.sales.cashAndUpi)],
    [t('sum.given'), rupees(summary.sales.udhaarGiven)],
    [t('sum.back'), rupees(summary.udhaarRecovered)],
    [t('sum.new'), String(summary.newCustomers)],
  ];
  return (
    <View style={s.card}>
      <Text style={s.h2}>{t('sum.title', { d: summary.date })}</Text>
      {rows.map(([k, v]) => (
        <Row key={k} style={{ justifyContent: 'space-between', paddingVertical: 2 }}>
          <Text style={[s.text, { color: C.muted }]}>{k}</Text>
          <Text style={[s.text, { fontWeight: '700' }]}>{v}</Text>
        </Row>
      ))}
      {summary.topDues.length ? (
        <>
          <Text style={[s.label, { marginTop: 8 }]}>{t('sum.top')}</Text>
          {summary.topDues.map((d) => (
            <Row key={d.id} style={{ justifyContent: 'space-between' }}>
              <Text style={s.text}>{d.name}</Text>
              <Text style={{ color: C.udhaarInk, fontWeight: '700' }}>{rupees(d.balance)}</Text>
            </Row>
          ))}
        </>
      ) : null}
    </View>
  );
}

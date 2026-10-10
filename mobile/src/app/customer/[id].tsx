import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Share, Text, View } from 'react-native';
import { confirmAction } from '../../components/BillCard';
import { Banner, Button, C, Card, Chip, Field, Loading, Row, s } from '../../components/ui';
import { ApiError, get, newClientId, patch, post } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { dateTime, parseRupees, rupees, shortDate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { Customer, LedgerEntry } from '../../lib/types';

interface Detail {
  customer: Customer;
  khata: { since: string; entries: number; balance: number };
  shareLink: string;
}

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useI18n();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const fetchAll = useCallback(
    () => Promise.all([get<Detail>(`/customers/${id}`), get<{ data: LedgerEntry[] }>(`/customers/${id}/ledger?limit=100`)]),
    [id],
  );
  const show = ([d, l]: [Detail, { data: LedgerEntry[] }]) => {
    setDetail(d);
    setLedger(l.data);
  };
  const load = async () => {
    try {
      show(await fetchAll());
    } catch (e) {
      setError(errorText(e, t));
    }
  };

  useEffect(() => {
    let live = true;
    fetchAll().then(
      (r) => live && show(r),
      (e) => live && setError(errorText(e, t)),
    );
    return () => {
      live = false;
    };
  }, [fetchAll, t]);

  const reversed = useMemo(() => new Set(ledger.filter((e) => e.reversesEntryId).map((e) => e.reversesEntryId)), [ledger]);

  if (!detail) return error ? <Banner text={error} /> : <Loading />;
  const c = detail.customer;

  const act = async (key: string, fn: () => Promise<string | null>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NO_CONSENT') setError(t('rm.noConsent', { name: c.name }));
      else if (e instanceof ApiError && e.code === 'OPTED_OUT') setError(t('cu.optedOut'));
      else setError(errorText(e, t));
    } finally {
      setBusy(null);
    }
  };

  const remind = () => {
    if (c.balance <= 0) return setError(t('rm.nothing', { name: c.name }));
    if (!c.phone) return setError(t('rm.noPhone', { name: c.name }));
    void act('remind', async () => {
      const r = await post<{ reply: string }>(`/customers/${c.id}/reminders`);
      return r.reply;
    });
  };

  const undo = (entry: LedgerEntry) =>
    confirmAction(t('cu.undoAsk'), t('yes'), t('no'), () =>
      void act(`undo-${entry.id}`, async () => {
        await post(`/customers/${c.id}/ledger/${entry.id}/reverse`, {});
        return t('cu.reversed');
      }),
    );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Row style={{ marginBottom: 12 }}>
          <View style={[s.avatar, { width: 52, height: 52, borderRadius: 26 }]}>
            <Text style={[s.avatarText, { fontSize: 18 }]}>{c.initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.h1}>{c.name}</Text>
            <Text style={{ color: C.muted }}>
              {c.phone ?? t('cu.noPhone')} · {t('cu.since2', { d: shortDate(c.createdAt, lang) })}
            </Text>
          </View>
        </Row>

        {c.deletionRequestedAt ? <Banner kind="info" text={t('cu.deletion')} /> : null}
        {error ? <Banner text={error} /> : null}
        {notice ? <Banner kind="ok" text={notice} /> : null}

        <Card>
          <Text style={{ color: C.muted }}>{t('kh.due')}</Text>
          <Text testID="balance" style={{ fontSize: 30, fontWeight: '800', color: c.balance > 0 ? C.udhaarInk : C.greenDark }}>
            {c.balance > 0 ? rupees(c.balance) : t('kh.clear')}
          </Text>
          <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={{ color: C.muted, fontSize: 13 }}>
              {t('cu.bought')}: {rupees(c.totalPurchases)}
            </Text>
            <Text style={{ color: C.muted, fontSize: 13 }}>
              {t('cu.paid')}: {rupees(c.totalPaid)}
            </Text>
          </Row>
          <Row style={{ marginTop: 12 }}>
            <Button testID="pay-open" title={t('kh.paid')} onPress={() => setPayOpen((v) => !v)} style={{ flex: 1 }} />
            <Button kind="secondary" title={t('kh.remind')} onPress={remind} busy={busy === 'remind'} style={{ flex: 1 }} />
          </Row>
        </Card>

        {payOpen ? (
          <PaymentForm
            customerId={c.id}
            onDone={(msg) => {
              setPayOpen(false);
              setNotice(msg);
              void load();
            }}
          />
        ) : null}

        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: '700' }]}>{t('cu.consent')}</Text>
              <Text style={{ color: C.muted, fontSize: 13 }}>
                {c.messagesOptedOut
                  ? t('cu.optedOut')
                  : !c.phone
                    ? t('cu.consentNoPhone')
                    : c.messagingConsent
                      ? t('cu.consentOn')
                      : t('cu.consentOff')}
              </Text>
            </View>
            <Button small kind="secondary" title={t('cu.edit')} onPress={() => setEditOpen((v) => !v)} />
          </Row>
          {editOpen ? (
            <EditForm
              customer={c}
              onDone={(msg) => {
                setEditOpen(false);
                setNotice(msg);
                void load();
              }}
            />
          ) : null}
        </Card>

        <Button small kind="ghost" title={`🔗 ${t('cu.share')}`} onPress={() => void Share.share({ message: detail.shareLink })} style={{ alignSelf: 'flex-start' }} />

        <Text style={[s.h2, { marginTop: 8 }]}>{t('cu.tx', { n: detail.khata.entries })}</Text>
        {ledger.length === 0 ? <Text style={{ color: C.muted }}>{t('cu.noTx')}</Text> : null}
        {ledger.map((e) => (
          <View key={e.id} style={[s.card, { paddingVertical: 10 }]}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.text, { fontWeight: '600' }]}>{entryLabel(e, t)}</Text>
                <Text style={{ color: C.muted, fontSize: 12 }}>
                  {dateTime(e.createdAt, lang)} · {t('cu.balanceAfter', { x: rupees(e.balanceAfter) })}
                </Text>
                {e.note ? <Text style={{ color: C.muted, fontSize: 12 }}>{e.note}</Text> : null}
              </View>
              <Text style={{ fontWeight: '800', color: e.amount > 0 ? C.udhaarInk : C.greenDark }}>
                {e.amount > 0 ? '+' : ''}
                {rupees(e.amount)}
              </Text>
            </Row>
            {e.type === 'payment' && !reversed.has(e.id) ? (
              <Button small kind="ghost" title={t('cu.undo')} onPress={() => undo(e)} busy={busy === `undo-${e.id}`} style={{ alignSelf: 'flex-end' }} />
            ) : null}
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function entryLabel(e: LedgerEntry, t: ReturnType<typeof useI18n>['t']) {
  const method = e.method === 'upi' ? t('m.upi') : t('m.cash');
  switch (e.type) {
    case 'bill':
      return t('lg.bill', { no: e.invoiceNumber ?? e.billNumber ?? '', n: e.itemCount ?? 0 });
    case 'payment':
      return t('lg.payment', { m: method });
    case 'payment_reversed':
      return t('lg.reversed');
    case 'bill_cancelled':
      return t('lg.cancelled');
  }
}

function PaymentForm({ customerId, onDone }: { customerId: string; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'upi'>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per payment: tapping again after a timeout cannot record it twice.
  const clientId = useRef(newClientId());

  const submit = async () => {
    const a = parseRupees(amount);
    if (a === null || a <= 0) return setError(t('ni.needPrice'));
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ reply: string }>(`/customers/${customerId}/payments`, {
        amount: a,
        method,
        note: note.trim() || undefined,
        clientId: clientId.current,
      });
      clientId.current = newClientId();
      onDone(r.reply);
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  return (
    <Card>
      {error ? <Banner text={error} /> : null}
      <Field testID="pay-amount" label={t('cu.payAmt')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus />
      <Text style={s.label}>{t('cu.payHow')}</Text>
      <Row style={{ marginBottom: 8 }}>
        <Chip label={t('m.cash')} active={method === 'cash'} onPress={() => setMethod('cash')} />
        <Chip label={t('m.upi')} active={method === 'upi'} onPress={() => setMethod('upi')} />
      </Row>
      <Field label={t('cu.note')} value={note} onChangeText={setNote} placeholder={t('cu.notePh')} maxLength={200} />
      <Button testID="pay-submit" title={t('cu.paySubmit')} onPress={submit} busy={busy} />
    </Card>
  );
}

function EditForm({ customer, onDone }: { customer: Customer; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [consent, setConsent] = useState(customer.messagingConsent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const hasPhone = phone.trim().length > 0;
      await patch(`/customers/${customer.id}`, {
        name: name.trim(),
        phone: hasPhone ? phone.trim() : null,
        messagingConsent: hasPhone && consent,
      });
      const msg =
        consent && hasPhone && !customer.messagingConsent
          ? t('cu.consentSaved')
          : !consent && customer.messagingConsent
            ? t('cu.consentWithdrawn')
            : t('cu.saved');
      onDone(msg);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t('cu.phoneExists') : errorText(e, t));
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 12 }}>
      {error ? <Banner text={error} /> : null}
      <Field label={t('cu.name')} value={name} onChangeText={setName} />
      <Field label={t('cu.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Text style={[s.text, { fontSize: 13, marginBottom: 6 }]}>{t('cu.consentText')}</Text>
      <Row style={{ marginBottom: 8 }}>
        <Chip label={t('cu.consentGive')} active={consent} onPress={() => setConsent(true)} />
        <Chip label={t('no')} active={!consent} onPress={() => setConsent(false)} />
      </Row>
      <Button title={t('cu.save')} onPress={submit} busy={busy} disabled={!name.trim()} />
    </View>
  );
}

import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { patch, post } from '../lib/api';
import { errorText } from '../lib/errors';
import { parseRupees, qtyLabel, rupees } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useSession } from '../lib/session';
import type { Bill, BillIssue, ConfirmResult, Learned, PaymentMode } from '../lib/types';
import { Banner, Button, C, Chip, Field, Row, s } from './ui';

/** Asks before a destructive action. Alert has no buttons on web, so use window.confirm there. */
export function confirmAction(title: string, yes: string, no: string, run: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(title)) run();
    return;
  }
  Alert.alert(title, undefined, [
    { text: no, style: 'cancel' },
    { text: yes, style: 'destructive', onPress: run },
  ]);
}

export function BillCard({ initial, onSay }: { initial: Bill; onSay?: (text: string) => void }) {
  const { t } = useI18n();
  const { store } = useSession();
  const [bill, setBill] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [done, setDone] = useState<ConfirmResult | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(null);
    }
  };

  const resolve = (issue: BillIssue, body: Record<string, unknown>) =>
    run(issue.id, async () => {
      const r = await post<{ bill: Bill; learned: Learned | null }>(`/bills/${bill.id}/resolve`, { issueId: issue.id, ...body });
      setBill(r.bill);
      if (r.learned) setNotes((n) => [...n, t('learn.done', { heard: r.learned!.heard, name: r.learned!.name })]);
    });

  const setMode = (mode: PaymentMode) =>
    run(`mode-${mode}`, async () => {
      const r = await patch<{ bill: Bill }>(`/bills/${bill.id}`, { paymentMode: mode });
      setBill(r.bill);
    });

  const confirm = () =>
    run('confirm', async () => {
      const r = await post<ConfirmResult>(`/bills/${bill.id}/confirm`);
      setBill(r.bill);
      setDone(r);
      onSay?.([r.reply.title, ...r.reply.lines].join(' '));
    });

  const cancel = () =>
    confirmAction(t('bill.cancelAsk'), t('bill.cancelYes'), t('bill.cancelNo'), () =>
      run('cancel', async () => {
        const r = await post<{ bill: Bill }>(`/bills/${bill.id}/cancel`);
        setBill(r.bill);
      }),
    );

  const draft = bill.status === 'draft';
  const modeLabel = { udhaar: t('mode.udhaar'), cash: t('mode.cash'), upi: t('mode.upi') }[bill.paymentMode];

  return (
    <View testID="bill-card" style={[s.card, { padding: 0, overflow: 'hidden' }]}>
      <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ color: C.muted, fontSize: 13, fontWeight: '600' }}>
            {draft ? t('bill.check') : bill.status === 'confirmed' ? `${t('bill.done')} · ${bill.invoiceNumber ?? ''}` : t('bill.cancelled')}
          </Text>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: 8,
              color: bill.paymentMode === 'udhaar' ? C.udhaarInk : C.greenDark,
              backgroundColor: bill.paymentMode === 'udhaar' ? C.udhaarBg : C.mine,
            }}
          >
            {modeLabel}
          </Text>
        </Row>
        {bill.customer ? (
          <Text style={[s.text, { marginTop: 4, fontWeight: '700' }]}>
            {t('bill.customer')}: {bill.customer.name}
          </Text>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 14, paddingVertical: 8 }}>
        {bill.items.map((l) => (
          <Row key={l.id} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={[s.text, { flex: 1 }]}>
              {l.name}
              {l.sizeLabel ? ` ${l.sizeLabel}` : ''} × {qtyLabel(l.quantity)}
            </Text>
            <Text style={[s.text, { fontWeight: '600' }]}>{rupees(l.amount)}</Text>
          </Row>
        ))}
      </View>

      {draft && bill.issues.map((issue) => <IssueBox key={issue.id} issue={issue} udhaar={bill.paymentMode === 'udhaar'} busy={busy === issue.id} onResolve={(b) => resolve(issue, b)} />)}

      <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={[s.text, { color: C.muted }]}>{t('bill.total', { n: bill.itemCount })}</Text>
          <Text testID="bill-total" style={{ fontSize: 20, fontWeight: '800', color: C.ink }}>
            {rupees(bill.total)}
          </Text>
        </Row>
        {bill.status === 'confirmed' && bill.paymentMode === 'udhaar' && bill.paidCash + bill.paidUpi > 0 ? (
          <Text style={[s.text, { color: C.muted, fontSize: 13 }]}>
            {t('bill.paidNow', { m: rupees(bill.paidCash + bill.paidUpi) })} · {t('bill.onCredit')} {rupees(bill.creditAmount)}
          </Text>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
        {notes.map((n) => (
          <Banner key={n} kind="ok" text={n} />
        ))}
        {error ? <Banner text={error} /> : null}
        {done ? (
          <View>
            {done.reply.lines.map((l) => (
              <Text key={l} style={[s.text, { fontSize: 14, marginBottom: 2 }]}>
                ✓ {l}
              </Text>
            ))}
          </View>
        ) : null}

        {draft ? (
          <>
            <Row style={{ flexWrap: 'wrap', marginBottom: 4 }}>
              {(['cash', 'upi', ...(store?.givesCredit ? (['udhaar'] as const) : [])] as PaymentMode[]).map((m) => (
                <Chip key={m} label={{ udhaar: t('mode.udhaar'), cash: t('mode.cash'), upi: t('mode.upi') }[m]} active={bill.paymentMode === m} onPress={() => setMode(m)} />
              ))}
            </Row>
            {bill.issues.length ? (
              <Text style={{ color: C.udhaarInk, fontSize: 13, marginBottom: 8 }}>{t('bill.answerFirst', { n: bill.issues.length })}</Text>
            ) : null}
            <Row>
              <Button testID="bill-cancel" kind="danger" title={t('bill.cancel')} onPress={cancel} busy={busy === 'cancel'} style={{ flex: 1 }} />
              <Button
                testID="bill-confirm"
                title={t('bill.confirm')}
                onPress={confirm}
                busy={busy === 'confirm'}
                disabled={!bill.canConfirm || busy !== null}
                style={{ flex: 2 }}
              />
            </Row>
          </>
        ) : bill.status === 'confirmed' ? (
          <Button kind="ghost" small title={t('bill.cancel')} onPress={cancel} busy={busy === 'cancel'} style={{ alignSelf: 'flex-end' }} />
        ) : null}
      </View>
    </View>
  );
}

function IssueBox({
  issue,
  udhaar,
  busy,
  onResolve,
}: {
  issue: BillIssue;
  udhaar: boolean;
  busy: boolean;
  onResolve: (body: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const [price, setPrice] = useState('');
  const [newName, setNewName] = useState(issue.name ?? '');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const name = issue.name ?? issue.raw ?? '';
  const isCustomer = issue.kind.startsWith('customer_');

  const title =
    issue.kind === 'price_missing' && issue.autoAdded
      ? t('issue.autoAdded', { name })
      : t(`issue.${issue.kind}`, { name });

  const submitPrice = (extra: Record<string, unknown>) => {
    const p = parseRupees(price);
    if (p === null || p <= 0) return setErr(t('ni.needPrice'));
    setErr(null);
    onResolve({ unitPrice: p, ...extra });
  };

  return (
    <View testID={`issue-${issue.kind}`} style={{ backgroundColor: C.askBg, marginHorizontal: 10, marginBottom: 8, borderRadius: 10, padding: 10 }}>
      <Text style={[s.text, { fontWeight: '700', marginBottom: 4 }]}>{title}</Text>
      {issue.spoken && issue.spoken !== name ? (
        <Text style={{ color: C.muted, fontSize: 13, marginBottom: 6 }}>
          {t('heard')}: “{issue.spoken}”
        </Text>
      ) : null}
      {err ? <Text style={s.error}>{err}</Text> : null}

      {issue.options.length ? (
        <>
          {issue.kind === 'not_found' ? <Text style={{ color: C.muted, fontSize: 13 }}>{t('issue.orPick')}</Text> : null}
          {isCustomer && issue.kind !== 'customer_ambiguous' ? <Text style={{ color: C.muted, fontSize: 13 }}>{t('issue.orCustomer')}</Text> : null}
          <Row style={{ flexWrap: 'wrap', marginTop: 4 }}>
            {issue.options.map((o) => (
              <Chip
                key={o.itemId ?? o.customerId ?? o.label}
                label={o.amount ? `${o.label} · ${rupees(o.amount)}` : o.label}
                onPress={() => onResolve(o.customerId ? { customerId: o.customerId } : { itemId: o.itemId })}
              />
            ))}
          </Row>
        </>
      ) : null}

      {issue.kind === 'price_missing' ? (
        <Row style={{ alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field testID="price-input" label={t('ni.price')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
          </View>
          <Button testID="price-submit" small title={t('kh.save')} busy={busy} onPress={() => submitPrice({ savePrice: true })} style={{ marginBottom: 12 }} />
        </Row>
      ) : null}

      {issue.kind === 'not_found' ? (
        <View>
          <Field label={t('cu.name')} value={newName} onChangeText={setNewName} />
          <Row style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label={t('ni.price')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
            </View>
            <Button small title={t('ni.addToBill')} busy={busy} onPress={() => submitPrice({ name: newName.trim() || name })} style={{ marginBottom: 12 }} />
          </Row>
        </View>
      ) : null}

      {issue.kind === 'customer_unknown' || issue.kind === 'customer_required' ? (
        <View style={{ marginTop: 4 }}>
          <Field label={t('cu.name')} value={newName} onChangeText={setNewName} placeholder={t('cu.namePh')} />
          <Field label={t('bill.newCustomerPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Button
            testID="new-customer"
            small
            kind="secondary"
            busy={busy}
            title={t('issue.newCustomer', { name: newName.trim() || '…' })}
            disabled={!newName.trim()}
            onPress={() => onResolve({ newCustomer: { name: newName.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) } })}
          />
        </View>
      ) : null}

      <Row style={{ justifyContent: 'flex-end', marginTop: 4 }}>
        {isCustomer ? (
          issue.kind !== 'customer_required' && !udhaar ? <Button kind="ghost" small title={t('issue.noName')} onPress={() => onResolve({ remove: true })} /> : null
        ) : (
          <Button kind="ghost" small title={t('remove')} onPress={() => onResolve({ remove: true })} />
        )}
      </Row>
    </View>
  );
}

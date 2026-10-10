import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { newClientId, post } from '../lib/api';
import { errorText } from '../lib/errors';
import { qtyLabel } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { StockInPreview } from '../lib/types';
import { Banner, Button, C, Chip, Row, s } from './ui';

type Line = { itemId: string; quantity: number } | { name: string; unit: 'kg' | 'l' | 'pc'; quantity: number };

/** "Maal aaya" heard in the chat: nothing changes until the shopkeeper taps "Add to stock". */
export function StockInCard({ preview }: { preview: StockInPreview }) {
  const { t } = useI18n();
  // For each unmatched line: the chosen option index, 'new' for the suggested new item, or null to skip.
  const [choice, setChoice] = useState<(number | 'new' | null)[]>(preview.unmatched.map((u) => (u.newItem ? 'new' : null)));
  const [state, setState] = useState<'open' | 'busy' | 'done' | 'cancelled'>('open');
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef(newClientId());

  const lines: Line[] = [
    ...preview.matched.map((m) => ({ itemId: m.itemId, quantity: m.quantity })),
    ...preview.unmatched.flatMap((u, i): Line[] => {
      const c = choice[i];
      if (c === 'new' && u.newItem) return [u.newItem];
      if (typeof c === 'number') {
        const o = u.options[c];
        if (o?.itemId) return [{ itemId: o.itemId, quantity: o.quantity ?? 1 }];
      }
      return [];
    }),
  ];

  const submit = async () => {
    setState('busy');
    setError(null);
    try {
      // The same clientId makes a retry after a lost response safe (stock is added once).
      await post('/items/receive', { supplier: preview.supplier, clientId: clientId.current, lines });
      setState('done');
    } catch (e) {
      setError(errorText(e, t));
      setState('open');
    }
  };

  return (
    <View testID="stockin-card" style={s.card}>
      <Text style={{ color: C.muted, fontSize: 13, fontWeight: '600' }}>
        {t('si.eyebrow')}
        {preview.supplier ? ` · ${preview.supplier}` : ''} · {t('si.items', { n: lines.length })}
      </Text>
      {preview.matched.map((m) => (
        <Row key={m.itemId} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
          <Text style={[s.text, { flex: 1 }]}>{m.displayName}</Text>
          <Text style={[s.text, { fontWeight: '700' }]}>+{qtyLabel(m.quantity)}</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>{t('si.now', { s: qtyLabel(m.stock) })}</Text>
        </Row>
      ))}
      {preview.unmatched.map((u, i) => (
        <View key={`${u.raw}-${i}`} style={{ backgroundColor: C.askBg, borderRadius: 10, padding: 10, marginTop: 6 }}>
          <Text style={[s.text, { fontWeight: '700' }]}>“{u.raw}”</Text>
          <Text style={{ color: C.muted, fontSize: 13, marginBottom: 4 }}>{t('si.notFound')}</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {u.newItem ? (
              <Chip
                label={`${t('si.new')}: ${u.newItem.name} +${qtyLabel(u.newItem.quantity)}`}
                active={choice[i] === 'new'}
                onPress={() => setChoice((c) => c.map((x, j) => (j === i ? 'new' : x)))}
              />
            ) : null}
            {u.options.map((o, k) => (
              <Chip key={o.itemId ?? o.label} label={o.label} active={choice[i] === k} onPress={() => setChoice((c) => c.map((x, j) => (j === i ? k : x)))} />
            ))}
            <Chip label={t('remove')} active={choice[i] === null} onPress={() => setChoice((c) => c.map((x, j) => (j === i ? null : x)))} />
          </Row>
        </View>
      ))}
      {error ? <Banner text={error} /> : null}
      {state === 'done' ? (
        <Banner kind="ok" text={t('si.added')} />
      ) : state === 'cancelled' ? (
        <Text style={{ color: C.muted, marginTop: 8 }}>{t('si.cancelled')}</Text>
      ) : (
        <Row style={{ marginTop: 10 }}>
          <Button kind="danger" title={t('bill.cancel')} onPress={() => setState('cancelled')} style={{ flex: 1 }} disabled={state === 'busy'} />
          <Button testID="stockin-confirm" title={t('si.add')} onPress={submit} busy={state === 'busy'} disabled={!lines.length} style={{ flex: 2 }} />
        </Row>
      )}
    </View>
  );
}

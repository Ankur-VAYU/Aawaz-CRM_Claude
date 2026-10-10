import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Banner, Button, C, Chip, Field, Loading, Row, s } from '../components/ui';
import { get, newClientId, post } from '../lib/api';
import { errorText } from '../lib/errors';
import { parseQty, parseRupees } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { Item } from '../lib/types';

interface Line {
  key: number;
  query: string;
  itemId: string | null;
  qty: string;
  cost: string;
}

export default function Receive() {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[] | null>(null);
  const [supplier, setSupplier] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: 1, query: '', itemId: null, qty: '', cost: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(1);
  // Same key on retry: the backend adds this delivery to stock only once.
  const clientId = useRef(newClientId());

  useEffect(() => {
    get<{ data: Item[] }>('/items')
      .then((r) => setItems(r.data))
      .catch((e) => setError(errorText(e, t)));
  }, [t]);

  if (!items) return error ? <Banner text={error} /> : <Loading />;

  const update = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const submit = async () => {
    const ready = lines.filter((l) => l.itemId && l.qty.trim());
    if (!ready.length || ready.some((l) => parseQty(l.qty) === null) || ready.some((l) => l.cost.trim() && parseRupees(l.cost) === null)) {
      return setError(t('rv.err'));
    }
    setBusy(true);
    setError(null);
    try {
      await post('/items/receive', {
        supplier: supplier.trim() || null,
        clientId: clientId.current,
        lines: ready.map((l) => ({ itemId: l.itemId, quantity: parseQty(l.qty), costPrice: l.cost.trim() ? parseRupees(l.cost) : null })),
      });
      router.back();
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={{ color: C.muted, marginBottom: 12 }}>{t('rv.sub')}</Text>
      {error ? <Banner text={error} /> : null}
      <Field label={t('rv.supplier')} value={supplier} onChangeText={setSupplier} placeholder={t('rv.supplierPh')} />
      {lines.map((l) => {
        const chosen = items.find((i) => i.id === l.itemId);
        const q = l.query.trim().toLowerCase();
        const matches = q ? items.filter((i) => i.displayName.toLowerCase().includes(q)).slice(0, 6) : [];
        return (
          <View key={l.key} style={s.card}>
            {chosen ? (
              <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={[s.text, { fontWeight: '700' }]}>{chosen.displayName}</Text>
                <Button small kind="ghost" title={t('cu.edit')} onPress={() => update(l.key, { itemId: null })} />
              </Row>
            ) : (
              <>
                <Field testID="rv-item" label={t('rv.item')} value={l.query} onChangeText={(v) => update(l.key, { query: v })} placeholder={t('st.search')} />
                <Row style={{ flexWrap: 'wrap' }}>
                  {matches.map((i) => (
                    <Chip key={i.id} label={i.displayName} onPress={() => update(l.key, { itemId: i.id, query: i.displayName })} />
                  ))}
                </Row>
              </>
            )}
            <Row>
              <View style={{ flex: 1 }}>
                <Field testID="rv-qty" label={t('rv.qty')} value={l.qty} onChangeText={(v) => update(l.key, { qty: v })} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field label={`${t('rv.cost')} (${t('rv.opt')})`} value={l.cost} onChangeText={(v) => update(l.key, { cost: v })} keyboardType="decimal-pad" />
              </View>
            </Row>
          </View>
        );
      })}
      <Button
        kind="secondary"
        title={t('rv.more')}
        onPress={() => {
          seq.current += 1;
          const key = seq.current;
          setLines((ls) => [...ls, { key, query: '', itemId: null, qty: '', cost: '' }]);
        }}
        style={{ marginBottom: 12 }}
      />
      <Button testID="rv-submit" title={t('si.add')} onPress={submit} busy={busy} />
    </ScrollView>
  );
}

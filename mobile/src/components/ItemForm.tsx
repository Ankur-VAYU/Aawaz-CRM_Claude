import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import { parseRupees, qtyLabel } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { Item, Unit } from '../lib/types';
import { Banner, Button, Chip, Field, Row, s } from './ui';

const UNITS: Unit[] = ['kg', 'g', 'l', 'ml', 'pc'];

export interface ItemValues {
  name: string;
  unit: Unit;
  unitSize: number;
  price: number | null;
  stock: number;
  lowStockThreshold: number;
  gstRate: number | null;
  hsnCode: string | null;
}

/** Add / edit an item. Prices are in rupees here; the backend stores paise. */
export function ItemForm({
  item,
  submitLabel,
  onSubmit,
  extra,
}: {
  item?: Item;
  submitLabel: string;
  onSubmit: (v: ItemValues) => Promise<void>;
  extra?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [f, setF] = useState({
    name: item?.name ?? '',
    unit: item?.unit ?? ('kg' as Unit),
    unitSize: item ? String(item.unitSize) : '1',
    price: item?.price != null ? String(item.price / 100) : '',
    stock: item ? qtyLabel(item.stock) : '0',
    low: item ? qtyLabel(item.lowStockThreshold) : '5',
    gst: item?.gstRate != null ? String(item.gstRate) : '',
    hsn: item?.hsnCode ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const num = (v: string) => (v.trim() === '' ? NaN : Number(v.replace(',', '.')));

  const submit = async () => {
    const price = f.price.trim() ? parseRupees(f.price) : null;
    if (f.price.trim() && price === null) return setError(t('ni.needPrice'));
    const unitSize = num(f.unitSize);
    const stock = num(f.stock);
    const low = num(f.low);
    const gstRate = f.gst.trim() ? num(f.gst) : null;
    if (!(unitSize > 0) || !(stock >= 0) || !(low >= 0) || (gstRate !== null && !(gstRate >= 0 && gstRate <= 40))) {
      return setError(t('err.generic'));
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: f.name.trim(),
        unit: f.unit,
        unitSize,
        price,
        stock,
        lowStockThreshold: low,
        gstRate,
        hsnCode: f.hsn.trim() || null,
      });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t('ni.exists') : errorText(e, t));
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      {error ? <Banner text={error} /> : null}
      <Field testID="item-name" label={t('cu.name')} value={f.name} onChangeText={set('name')} placeholder={t('ni.namePh')} />
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 80 }}>
          <Field label={t('ni.size')} value={f.unitSize} onChangeText={set('unitSize')} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>{t('ni.unit')}</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {UNITS.map((u) => (
              <Chip key={u} label={t(`u.${u}`)} active={f.unit === u} onPress={() => set('unit')(u)} />
            ))}
          </Row>
        </View>
      </Row>
      <Field testID="item-price" label={t('ni.price')} value={f.price} onChangeText={set('price')} keyboardType="decimal-pad" />
      <Row>
        <View style={{ flex: 1 }}>
          <Field testID="item-stock" label={t('ni.stock')} value={f.stock} onChangeText={set('stock')} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={t('st.lowAt')} value={f.low} onChangeText={set('low')} keyboardType="decimal-pad" />
        </View>
      </Row>
      <Row>
        <View style={{ flex: 1 }}>
          <Field label={t('st.gstRate')} value={f.gst} onChangeText={set('gst')} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={t('st.hsn')} value={f.hsn} onChangeText={set('hsn')} keyboardType="number-pad" maxLength={8} />
        </View>
      </Row>
      <Button testID="item-submit" title={submitLabel} onPress={submit} busy={busy} disabled={!f.name.trim()} />
      {extra}
    </ScrollView>
  );
}

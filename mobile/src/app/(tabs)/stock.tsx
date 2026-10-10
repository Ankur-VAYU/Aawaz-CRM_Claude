import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Banner, Button, C, Row, s } from '../../components/ui';
import { get } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { qtyLabel, rupees } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { Item } from '../../lib/types';

export default function Stock() {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[] | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await get<{ data: Item[] }>('/items');
      setItems(r.data);
      setError(null);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // The whole catalogue is small (a kirana shop has hundreds of items), so search on the phone.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!items) return [];
    if (!q) return items;
    return items.filter((i) => i.displayName.toLowerCase().includes(q) || i.aliases.some((a) => a.includes(q)));
  }, [items, search]);
  const low = items?.filter((i) => i.stock <= i.lowStockThreshold).length ?? 0;

  return (
    <View style={s.screen}>
      <View style={{ padding: 12, backgroundColor: '#fff' }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={s.h2}>{t('st.title', { n: items?.length ?? 0 })}</Text>
          <Text style={{ color: low ? C.danger : C.greenDark, fontWeight: '600' }}>{low ? t('st.low', { n: low }) : t('st.ok')}</Text>
        </Row>
        <TextInput value={search} onChangeText={setSearch} placeholder={t('st.search')} placeholderTextColor={C.muted} style={s.input} />
      </View>
      {error ? (
        <View style={{ padding: 12 }}>
          <Banner text={error} />
        </View>
      ) : null}
      <FlatList
        data={shown}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
        ListFooterComponent={<Text style={{ color: C.muted, fontSize: 13, padding: 16 }}>{t('st.tip')}</Text>}
        renderItem={({ item: i }) => {
          const isLow = i.stock <= i.lowStockThreshold;
          return (
            <Pressable testID={`item-${i.displayName}`} onPress={() => router.push(`/item/${i.id}`)} style={s.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={[s.text, { fontWeight: '700' }]}>{i.displayName}</Text>
                <Text style={{ color: i.price === null ? C.danger : C.muted, fontSize: 13 }}>{i.price === null ? t('st.noPrice') : rupees(i.price)}</Text>
              </View>
              <Text style={{ fontWeight: '800', color: isLow ? C.danger : C.ink }}>
                {qtyLabel(i.stock)} {i.stockLabel ?? ''}
              </Text>
            </Pressable>
          );
        }}
      />
      <Row style={{ padding: 12 }}>
        <Button testID="receive" title={t('st.receive')} onPress={() => router.push('/receive')} style={{ flex: 1 }} />
        <Button testID="new-item" kind="secondary" title={t('st.newItem')} onPress={() => router.push('/item/new')} style={{ flex: 1 }} />
      </Row>
    </View>
  );
}

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Banner, Button, C, Chip, Row, s } from '../../components/ui';
import { get, qs } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { rupees, shortDate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import type { Customer } from '../../lib/types';

type Filter = 'all' | 'dues' | 'inactive';
interface ListResponse {
  data: Customer[];
  counts: Record<Filter, number>;
  totalDues: number;
  pagination: { page: number; totalPages: number };
}

export default function Customers() {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const [query, setQuery] = useState('');

  // Search after the shopkeeper stops typing.
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(
    async (page = 1) => {
      // Ignore responses to older requests (typing fast in search, switching filters).
      const mine = ++seq.current;
      setLoading(true);
      try {
        const r = await get<ListResponse>(`/customers${qs({ filter, search: query, limit: 50, page })}`);
        if (mine === seq.current) {
          setData((prev) => (page > 1 && prev ? { ...r, data: [...prev.data, ...r.data] } : r));
          setError(null);
        }
      } catch (e) {
        if (mine === seq.current) setError(errorText(e, t));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [filter, query, t],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );



  return (
    <View style={s.screen}>
      <View style={{ padding: 12, backgroundColor: '#fff' }}>
        {data ? (
          <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.h2}>{t('cu.titleShort', { n: data.counts.all })}</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: C.muted, fontSize: 12 }}>{t('cu.dues')}</Text>
              <Text testID="total-dues" style={{ color: C.udhaarInk, fontWeight: '800', fontSize: 18 }}>
                {rupees(data.totalDues)}
              </Text>
            </View>
          </Row>
        ) : null}
        <TextInput
          testID="customer-search"
          value={search}
          onChangeText={setSearch}
          placeholder={t('cu.search')}
          placeholderTextColor={C.muted}
          style={[s.input, { marginBottom: 8 }]}
        />
        <Row style={{ flexWrap: 'wrap' }}>
          {(['all', 'dues', 'inactive'] as Filter[]).map((f) => (
            <Chip key={f} label={`${t(`f.${f}`)}${data ? ` · ${data.counts[f]}` : ''}`} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </Row>
      </View>
      {error ? (
        <View style={{ padding: 12 }}>
          <Banner text={error} />
        </View>
      ) : null}
      <FlatList
        data={data?.data ?? []}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (!loading && data && data.pagination.page < data.pagination.totalPages) void load(data.pagination.page + 1);
        }}
        ListEmptyComponent={!loading && data ? <Text style={{ textAlign: 'center', color: C.muted, padding: 24 }}>{t('cu.none')}</Text> : null}
        renderItem={({ item: c }) => (
          <Pressable testID={`customer-${c.name}`} onPress={() => router.push(`/customer/${c.id}`)} style={s.listRow}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{c.initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.text, { fontWeight: '700' }]}>{c.name}</Text>
              <Text style={{ color: C.muted, fontSize: 13 }}>
                {c.lastPurchaseAt ? t('cu.last', { d: shortDate(c.lastPurchaseAt, lang) }) : (c.phone ?? t('cu.noPhone'))}
              </Text>
            </View>
            <Text style={{ fontWeight: '800', color: c.balance > 0 ? C.udhaarInk : C.greenDark }}>
              {c.balance > 0 ? rupees(c.balance) : c.balance < 0 ? rupees(c.balance) : '✓'}
            </Text>
          </Pressable>
        )}
      />
      <View style={{ padding: 12 }}>
        <Button testID="add-customer" title={t('cu.add')} onPress={() => router.push('/customer/new')} />
      </View>
    </View>
  );
}

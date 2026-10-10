import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { confirmAction } from '../../components/BillCard';
import { ItemForm } from '../../components/ItemForm';
import { Banner, Button, Loading } from '../../components/ui';
import { del, get, patch, post } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { useI18n } from '../../lib/i18n';
import type { Item } from '../../lib/types';

export default function EditItem() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<{ item: Item }>(`/items/${id}`)
      .then((r) => setItem(r.item))
      .catch((e) => setError(errorText(e, t)));
  }, [id, t]);

  if (!item) return error ? <Banner text={error} /> : <Loading />;

  return (
    <ItemForm
      item={item}
      submitLabel={t('cu.save')}
      onSubmit={async ({ stock, ...v }) => {
        await patch(`/items/${item.id}`, v);
        // Stock changes are sent as a difference so a bill confirmed meanwhile on another phone is not overwritten.
        const delta = Math.round((stock - item.stock) * 1000) / 1000;
        if (delta !== 0) await post(`/items/${item.id}/stock`, { delta });
        router.back();
      }}
      extra={
        <>
          {error ? <Banner text={error} /> : null}
          <Button
          kind="danger"
          title={t('st.remove')}
          style={{ marginTop: 24 }}
          onPress={() =>
            confirmAction(t('st.removeAsk'), t('yes'), t('no'), () => {
              del(`/items/${item.id}`)
                .then(() => router.back())
                .catch((e) => setError(errorText(e, t)));
            })
          }
          />
        </>
      }
    />
  );
}

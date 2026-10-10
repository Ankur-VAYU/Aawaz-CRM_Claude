import { router } from 'expo-router';
import { ItemForm } from '../../components/ItemForm';
import { post } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

export default function NewItem() {
  const { t } = useI18n();
  return (
    <ItemForm
      submitLabel={t('ni.add')}
      onSubmit={async (v) => {
        await post('/items', { ...v, price: v.price });
        router.back();
      }}
    />
  );
}

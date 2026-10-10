import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { C } from '../../components/ui';
import { useI18n } from '../../lib/i18n';
import { useSession } from '../../lib/session';

type IconName = keyof typeof Ionicons.glyphMap;
const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

export default function TabsLayout() {
  const { t } = useI18n();
  const { store } = useSession();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.greenDark },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: C.greenDark,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tab.chat'), headerTitle: store?.name ?? t('app.name'), tabBarIcon: icon('mic') }} />
      <Tabs.Screen name="customers" options={{ title: t('tab.customers'), tabBarIcon: icon('people') }} />
      <Tabs.Screen name="stock" options={{ title: t('tab.stock'), tabBarIcon: icon('cube') }} />
      <Tabs.Screen name="shop" options={{ title: t('tab.shop'), tabBarIcon: icon('storefront') }} />
    </Tabs>
  );
}

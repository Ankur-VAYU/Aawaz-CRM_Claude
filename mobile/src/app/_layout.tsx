import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, C, Loading } from '../components/ui';
import { I18nProvider, useI18n } from '../lib/i18n';
import { SessionProvider, useSession } from '../lib/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <SessionProvider>
          <StatusBar style="light" />
          <Navigator />
        </SessionProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

function Navigator() {
  const { status, store, reload } = useSession();
  const { t } = useI18n();
  const ready = status === 'ready';
  const onboarded = ready && store !== null && store.onboardedAt !== null;

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: C.greenDark },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: C.page },
        }}
      >
        <Stack.Protected guard={!ready}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={ready && !onboarded}>
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={onboarded}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="customer/[id]" options={{ title: t('cu.back') }} />
          <Stack.Screen name="customer/new" options={{ title: t('cu.new'), presentation: 'modal' }} />
          <Stack.Screen name="item/[id]" options={{ title: t('st.edit'), presentation: 'modal' }} />
          <Stack.Screen name="item/new" options={{ title: t('ni.title'), presentation: 'modal' }} />
          <Stack.Screen name="receive" options={{ title: t('st.receive'), presentation: 'modal' }} />
          <Stack.Screen name="learned" options={{ title: t('learn.title') }} />
        </Stack.Protected>
      </Stack>
      {status === 'loading' || status === 'offline' ? (
        <View style={[StyleSheet.absoluteFill, styles.cover]}>
          {status === 'loading' ? (
            <Loading />
          ) : (
            <View style={{ padding: 24, gap: 16 }}>
              <Text style={{ fontSize: 16, color: C.ink, textAlign: 'center' }}>{t('err.network')}</Text>
              <Button title={t('retry')} onPress={() => void reload()} />
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { backgroundColor: C.page, alignItems: 'center', justifyContent: 'center' },
});

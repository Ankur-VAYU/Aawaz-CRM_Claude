import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, C, Chip, Field, Loading, Row, s } from '../components/ui';
import { get, post, put } from '../lib/api';
import { errorText } from '../lib/errors';
import { parseRupees } from '../lib/format';
import { useI18n, type TKey } from '../lib/i18n';
import { useSession } from '../lib/session';
import type { Lang, Store, Unit } from '../lib/types';

type Step = 'shop' | 'gst' | 'language' | 'items';
const STEPS: Step[] = ['shop', 'gst', 'language', 'items'];
const STEP_LABEL: Record<Step, TKey> = { shop: 'ob.s.shop', gst: 'ob.s.gst', language: 'ob.s.lang', items: 'ob.s.items' };

interface OnboardingStatus {
  store: Store;
  onboarding: { steps: { language: boolean; items: boolean } };
}

export default function Onboarding() {
  const { t } = useI18n();
  const { store, signOut } = useSession();
  const [step, setStep] = useState<Step | null>(store ? null : 'shop');

  // Resume where the shopkeeper left off.
  useEffect(() => {
    if (!store) return;
    get<OnboardingStatus>('/store')
      .then((r) => setStep(!r.onboarding.steps.language ? 'gst' : 'items'))
      .catch(() => setStep('gst'));
  }, [store]);

  if (!step) return <Loading />;
  const n = STEPS.indexOf(step) + 2; // step 1 was the phone number

  return (
    <SafeAreaView style={s.screen}>
      <View style={{ backgroundColor: C.greenDark, padding: 16 }}>
        <Text style={{ color: C.headerSub, fontSize: 13 }}>{t('ob.step', { n })}</Text>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>{t(STEP_LABEL[step])}</Text>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
          {step === 'shop' && <ShopStep onDone={() => setStep('gst')} />}
          {step === 'gst' && <GstStep onDone={() => setStep('language')} />}
          {step === 'language' && <LanguageStep onDone={() => setStep('items')} />}
          {step === 'items' && <ItemsStep />}
          <Button kind="ghost" small title={t('sh.signOut')} onPress={() => void signOut()} style={{ marginTop: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ShopStep({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { setStore } = useSession();
  const [f, setF] = useState({ name: '', ownerName: '', city: '', pincode: '' });
  const [givesCredit, setGivesCredit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!f.name.trim() || !f.ownerName.trim() || !f.city.trim()) return setError(t('err.generic'));
    if (f.pincode && !/^[1-9]\d{5}$/.test(f.pincode)) return setError(t('ob.badPin'));
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ store: Store }>('/store', {
        name: f.name.trim(),
        ownerName: f.ownerName.trim(),
        city: f.city.trim(),
        pincode: f.pincode || undefined,
        givesCredit,
      });
      setStore(r.store);
      onDone();
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  const missing = !f.name.trim() || !f.ownerName.trim() || !f.city.trim();
  return (
    <View>
      <Text style={[s.text, { marginBottom: 12 }]}>{t('ob.shopAsk')}</Text>
      {error ? <Banner text={error} /> : null}
      <Field testID="shop-name" label={t('ob.shopName')} value={f.name} onChangeText={set('name')} placeholder="Sharma Kirana Store" />
      <Field testID="owner-name" label={t('ob.owner')} value={f.ownerName} onChangeText={set('ownerName')} />
      <Field testID="city" label={t('ob.city')} value={f.city} onChangeText={set('city')} />
      <Field testID="pincode" label={t('ob.pin')} value={f.pincode} onChangeText={set('pincode')} keyboardType="number-pad" maxLength={6} />
      <Text style={s.label}>{t('ob.creditQ')}</Text>
      <Row style={{ marginBottom: 12 }}>
        <Chip label={t('sh.creditYes')} active={givesCredit} onPress={() => setGivesCredit(true)} />
        <Chip label={t('sh.creditNo')} active={!givesCredit} onPress={() => setGivesCredit(false)} />
      </Row>
      <Button testID="shop-next" title={t('ob.yesNext')} onPress={submit} busy={busy} disabled={missing} />
    </View>
  );
}

function GstStep({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { setStore } = useSession();
  const [mode, setMode] = useState<'gst' | 'pan' | null>(null);
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [scheme, setScheme] = useState<'regular' | 'composition'>('regular');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (mode === 'gst' && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin.trim().toUpperCase())) {
      return setError(t('ob.badGstin'));
    }
    if (mode === 'pan' && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.trim().toUpperCase())) return setError(t('ob.badPan'));
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'gst' ? { gstin: gstin.trim(), gstScheme: scheme } : { pan: pan.trim() };
      const r = await put<{ store: Store }>('/store/tax', body);
      setStore(r.store);
      onDone();
    } catch (e) {
      // The server checks the GSTIN checksum too.
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={[s.text, { marginBottom: 4 }]}>{t('ob.gstAsk')}</Text>
      <Text style={[s.text, { color: C.muted, fontSize: 13, marginBottom: 12 }]}>{t('ob.gstOptional')}</Text>
      {error ? <Banner text={error} /> : null}
      <Row style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        <Chip label={t('ob.hasGst')} active={mode === 'gst'} onPress={() => setMode('gst')} />
        <Chip label={t('ob.panOnly')} active={mode === 'pan'} onPress={() => setMode('pan')} />
      </Row>
      {mode === 'gst' && (
        <>
          <Field label={t('ob.gstin')} value={gstin} onChangeText={setGstin} autoCapitalize="characters" maxLength={15} />
          <Text style={s.label}>{t('ob.scheme')}</Text>
          <Row style={{ flexWrap: 'wrap', marginBottom: 8 }}>
            <Chip label={t('ob.regular')} active={scheme === 'regular'} onPress={() => setScheme('regular')} />
            <Chip label={t('ob.composition')} active={scheme === 'composition'} onPress={() => setScheme('composition')} />
          </Row>
        </>
      )}
      {mode === 'pan' && <Field label={t('ob.pan')} value={pan} onChangeText={setPan} autoCapitalize="characters" maxLength={10} />}
      {mode ? <Text style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>{t('ob.safe')}</Text> : null}
      {mode ? <Button title={t('ob.next')} onPress={submit} busy={busy} style={{ marginBottom: 8 }} /> : null}
      <Button testID="gst-skip" kind="secondary" title={t('ob.notNow')} onPress={onDone} />
    </View>
  );
}

function LanguageStep({ onDone }: { onDone: () => void }) {
  const { t, lang: current } = useI18n();
  const { setStore } = useSession();
  const [lang, setLang] = useState<Lang>(current);
  const [replyStyle, setReplyStyle] = useState<'voice_text' | 'text'>('voice_text');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await put<{ store: Store }>('/store/preferences', { language: lang, replyStyle });
      setStore(r.store);
      onDone();
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  const options: { v: Lang; title: string; sub: TKey }[] = [
    { v: 'hinglish', title: 'Hinglish', sub: 'ob.hinglishSub' },
    { v: 'hi', title: 'हिंदी', sub: 'ob.hiSub' },
    { v: 'en', title: 'English', sub: 'ob.enSub' },
  ];
  return (
    <View>
      {error ? <Banner text={error} /> : null}
      <Text style={s.h2}>{t('ob.langAsk')}</Text>
      {options.map((o) => (
        <Choice key={o.v} testID={`ob-lang-${o.v}`} title={o.title} sub={t(o.sub)} active={lang === o.v} onPress={() => setLang(o.v)} />
      ))}
      <Text style={[s.h2, { marginTop: 12 }]}>{t('ob.replyAsk')}</Text>
      <Choice title={t('sh.voiceText')} sub={t('ob.voiceTextSub')} active={replyStyle === 'voice_text'} onPress={() => setReplyStyle('voice_text')} />
      <Choice title={t('sh.textOnly')} sub={t('ob.textSub')} active={replyStyle === 'text'} onPress={() => setReplyStyle('text')} />
      <Button testID="lang-next" title={t('ob.next')} onPress={submit} busy={busy} style={{ marginTop: 8 }} />
    </View>
  );
}

function Choice({ title, sub, active, onPress, testID }: { title: string; sub: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Button
      testID={testID}
      kind={active ? 'primary' : 'secondary'}
      title={`${active ? '✓ ' : ''}${title} — ${sub}`}
      onPress={onPress}
      style={{ marginBottom: 8, alignItems: 'flex-start' }}
    />
  );
}

interface DraftItem {
  key: number;
  name: string;
  unit: Unit;
  unitSize: string;
  price: string;
}

// Common kirana items as a starting point. Prices are left empty: each shop sets its own.
const SAMPLE: [string, Unit, number][] = [
  ['Atta', 'kg', 5],
  ['Toor dal', 'kg', 1],
  ['Sarson tel', 'l', 1],
  ['Moong dal', 'kg', 1],
  ['Chawal', 'kg', 1],
  ['Cheeni', 'kg', 1],
  ['Namak', 'pc', 1],
];
const UNITS: Unit[] = ['kg', 'g', 'l', 'ml', 'pc'];

function ItemsStep() {
  const { t } = useI18n();
  const { setStore } = useSession();
  const [rows, setRows] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const add = (name = '', unit: Unit = 'kg', size = 1) => {
    seq.current += 1;
    const key = seq.current;
    setRows((r) => [...r, { key, name, unit, unitSize: String(size), price: '' }]);
  };
  const update = (key: number, patch: Partial<DraftItem>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const finish = async () => {
    const filled = rows.filter((r) => r.name.trim());
    if (!filled.length) return setError(t('rv.err'));
    // An empty price is fine (asked at the first bill); a typed one must be a valid amount.
    if (filled.some((r) => r.price.trim() && parseRupees(r.price) === null)) return setError(t('ni.needPrice'));
    const items = filled.map((r) => ({
      name: r.name.trim(),
      unit: r.unit,
      unitSize: Number(r.unitSize) > 0 ? Number(r.unitSize) : 1,
      price: r.price.trim() ? parseRupees(r.price) : null,
    }));
    setBusy(true);
    setError(null);
    try {
      await post('/items/bulk', { items });
      const r = await post<{ store: Store }>('/store/onboarding/complete');
      setStore(r.store);
    } catch (e) {
      setError(errorText(e, t));
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={[s.text, { marginBottom: 12 }]}>{t('ob.itemsAppSub')}</Text>
      {error ? <Banner text={error} /> : null}
      <Row style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        <Chip
          testID="sample-items"
          label={t('ob.sample')}
          onPress={() => {
            const have = new Set(rows.map((r) => r.name.toLowerCase()));
            SAMPLE.filter(([n]) => !have.has(n.toLowerCase())).forEach(([n, u, z]) => add(n, u, z));
          }}
        />
        <Chip label={t('ob.addItem')} onPress={() => add()} />
      </Row>
      {rows.map((r) => (
        <View key={r.key} style={[s.card, { padding: 10 }]}>
          <Row>
            <View style={{ flex: 1 }}>
              <Field placeholder={t('ni.namePh')} value={r.name} onChangeText={(v) => update(r.key, { name: v })} />
            </View>
            <Button kind="ghost" small title="✕" onPress={() => setRows((x) => x.filter((y) => y.key !== r.key))} />
          </Row>
          <Row>
            <View style={{ width: 70 }}>
              <Field label={t('ni.size')} value={r.unitSize} keyboardType="decimal-pad" onChangeText={(v) => update(r.key, { unitSize: v })} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{t('ni.unit')}</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {UNITS.map((u) => (
                  <Chip key={u} label={t(`u.${u}`)} active={r.unit === u} onPress={() => update(r.key, { unit: u })} />
                ))}
              </Row>
            </View>
          </Row>
          <Field label={t('ob.price')} value={r.price} keyboardType="decimal-pad" onChangeText={(v) => update(r.key, { price: v })} />
        </View>
      ))}
      <Button testID="finish" title={t('ob.finish')} onPress={finish} busy={busy} disabled={!rows.some((r) => r.name.trim())} />
    </View>
  );
}

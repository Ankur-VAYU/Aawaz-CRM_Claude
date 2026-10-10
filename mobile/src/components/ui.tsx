import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

// Colours from the design (demo/template.html).
export const C = {
  greenDark: '#0B6E5F',
  green: '#128C4A',
  chat: '#EFE7DD',
  mine: '#D9FDD3',
  card: '#FFFFFF',
  ink: '#233D44',
  inkSoft: '#3B4A54',
  muted: '#5F6B72',
  line: '#EFE7DD',
  border: '#D1D7DB',
  udhaarBg: '#FCEFC7',
  udhaarInk: '#8A5A00',
  askBg: '#FFF6D6',
  page: '#F4F6F5',
  chip: '#E3ECEF',
  headerSub: '#D7F0EA',
  danger: '#B3261E',
};

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
  small,
  testID,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  testID?: string;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        kind === 'primary' && s.btnPrimary,
        kind === 'secondary' && s.btnSecondary,
        kind === 'danger' && s.btnDanger,
        kind === 'ghost' && s.btnGhost,
        (pressed || off) && { opacity: off ? 0.5 : 0.8 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === 'primary' ? '#fff' : C.green} />
      ) : (
        <Text
          style={[
            s.btnText,
            small && s.btnTextSmall,
            kind === 'primary' && { color: '#fff' },
            kind === 'danger' && { color: C.danger },
            (kind === 'secondary' || kind === 'ghost') && { color: C.greenDark },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({ label, error, style, ...props }: TextInputProps & { label?: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={C.muted} style={[s.input, error ? { borderColor: C.danger } : null, style]} {...props} />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={[s.chip, active && s.chipActive]}
    >
      <Text style={[s.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>;
}

export function T({ children, style, muted, bold }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean; bold?: boolean }) {
  return <Text style={[s.text, muted && { color: C.muted }, bold && { fontWeight: '700' }, style]}>{children}</Text>;
}

export function Banner({ text, kind = 'error' }: { text: string; kind?: 'error' | 'info' | 'ok' }) {
  const bg = kind === 'error' ? '#FDECEA' : kind === 'ok' ? C.mine : C.askBg;
  const fg = kind === 'error' ? C.danger : C.ink;
  return (
    <View accessibilityLiveRegion="polite" style={[s.banner, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 14 }}>{text}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <ActivityIndicator size="large" color={C.green} />
    </View>
  );
}

export const s = StyleSheet.create({
  text: { color: C.ink, fontSize: 15 },
  btn: { minHeight: 48, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18 },
  btnPrimary: { backgroundColor: C.green },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.green },
  btnDanger: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.danger },
  btnGhost: { backgroundColor: 'transparent' },
  btnText: { fontSize: 16, fontWeight: '700' },
  btnTextSmall: { fontSize: 14 },
  label: { color: C.inkSoft, fontSize: 13, marginBottom: 4, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: C.ink,
    backgroundColor: '#fff',
    minHeight: 46,
  },
  error: { color: C.danger, fontSize: 13, marginTop: 4 },
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  chip: {
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.chip,
    marginRight: 8,
    marginBottom: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: C.greenDark },
  chipText: { color: C.ink, fontSize: 14, fontWeight: '600' },
  banner: { borderRadius: 10, padding: 10, marginBottom: 12 },
  h1: { fontSize: 22, fontWeight: '700', color: C.ink, marginBottom: 8 },
  h2: { fontSize: 17, fontWeight: '700', color: C.ink, marginBottom: 8 },
  screen: { flex: 1, backgroundColor: C.page },
  pad: { padding: 16 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.greenDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '700' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
});

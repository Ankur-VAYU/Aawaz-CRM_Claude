# Aawaz — Android & iOS app

React Native app (Expo SDK 57, Expo Router, TypeScript) for the [Aawaz backend](../backend/README.md). One codebase builds the Android app now and the iPhone app later.

## What's in it

| Screen | What it does | Backend |
| --- | --- | --- |
| Login | Phone number + 6-digit OTP. Choose Hinglish / हिंदी / English | `/auth/otp/*` |
| Setup | Shop details → GST/PAN (optional) → language and reply style → first items | `/store`, `/store/tax`, `/store/preferences`, `/items/bulk`, `/store/onboarding/complete` |
| Baat (chat) | Speak or type. Bills come back as a card: answer the questions (size, price, new customer…), change cash/UPI/udhaar, confirm or cancel. "Maal aaya" shows a stock card to confirm. Balance, payments, reminders, today's summary, low stock | `/assistant/message`, `/bills/:id/*`, `/items/receive` |
| Grahak | Customers with dues/inactive filters and search. Customer page: khata, record payment, undo a wrong payment, WhatsApp reminder, phone and consent, share khata link | `/customers/*` |
| Stock | Items with low-stock warning; add, edit, remove items; "Maal aaya" form | `/items/*` |
| Dukaan | Shop details, app language, reply style, credit on/off, voice improvement (learned names, voice log opt-in), log out | `/store`, `/assistant/learned`, `/assistant/voice-log` |

Reliability:

- Every bill-creating message, payment and stock delivery carries a `clientId`, so a retry after a lost response is recorded once.
- Login tokens are kept in the phone's secure storage (Android Keystore / iOS Keychain). Token refresh runs one at a time, as the backend requires.
- Requests time out after 15 s with a clear "no internet" message and a retry button.

## Run it on your computer

1. Start the backend (see [backend/README.md](../backend/README.md)) with `OTP_DEV_ECHO=true` so the login code is shown in the app.
2. Install and start the app:

   ```bash
   cd mobile
   npm install
   npx expo start
   ```

3. Choose where to open it:
   - **Web browser** (`w`): quickest way to try the screens. Voice uses the browser's speech recognition (Chrome).
   - **Android emulator** (`a`): the app reaches your computer's backend at `10.0.2.2:3000` automatically.
   - **Real phone**: set your computer's Wi-Fi address first, e.g. `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000/api/v1 npx expo start`.

**Voice needs a development build, not Expo Go.** Speech recognition (`expo-speech-recognition`) is a native module that Expo Go doesn't include. Build once with `npx expo run:android` (needs Android Studio) or with EAS (below), then `npx expo start --dev-client`.

## Build an APK / Play Store app

With a free Expo account:

```bash
npm install -g eas-cli
eas login
eas build -p android --profile development  # APK with voice, for testing with `npx expo start --dev-client`
eas build -p android --profile preview      # installable APK for testing
eas build -p android --profile production   # .aab for the Play Store
```

Build profiles are in `eas.json`. The first build asks to link an Expo project. Set `EXPO_PUBLIC_API_URL` to your hosted backend (HTTPS) for preview and production builds, for example under `build.<profile>.env` in `eas.json`.

The Android package name is `in.aawaz.app` (in `app.json`). **Change it before the first Play Store upload** if you want a different one; it cannot be changed after publishing.

## Checks

```bash
npx tsc --noEmit   # types
npx expo lint      # lint
```

## Layout

```
src/app/            screens (Expo Router: each file is a route)
  _layout.tsx       providers + which screens show when (login / setup / main app)
  login.tsx, onboarding.tsx, receive.tsx, learned.tsx
  (tabs)/           Baat, Grahak, Stock, Dukaan
  customer/         customer page, new customer
  item/             new item, edit item
src/components/     BillCard, StockInCard, ItemForm, UI building blocks
src/lib/            api client, session, translations, voice, formatting
```

Translations are in `src/lib/strings.ts` (shared with the web demo) and `src/lib/i18n.tsx` (app-only text), as `[Hinglish, Hindi, English]`.

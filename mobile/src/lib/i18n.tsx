import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getItem, setItem } from './storage';
import { STRINGS } from './strings';
import type { Lang } from './types';

// Text used only by the app (not the web demo): [Hinglish, Hindi, English].
const APP_STRINGS = {
  'app.name': ['Aawaz', 'आवाज़', 'Aawaz'],
  'ob.devCode': ['Test mode: code hai', 'टेस्ट मोड: कोड है', 'Test mode: the code is'],
  'ob.codeSent': ['{phone} par code bheja', '{phone} पर कोड भेजा', 'Code sent to {phone}'],
  'ob.changeNumber': ['Number badlo', 'नंबर बदलें', 'Change number'],
  'ob.resend': ['Code dobara bhejo', 'कोड दोबारा भेजें', 'Resend code'],
  'ob.itemsAppSub': ['Bill banate waqt naye item apne-aap jud jaate hain. Chahein to abhi kuch jod lijiye.', 'बिल बनाते समय नए आइटम अपने-आप जुड़ जाते हैं। चाहें तो अभी कुछ जोड़ लीजिए।', 'New items are added automatically while billing. You can add some now if you like.'],
  'ob.skipItems': ['Baad mein jodenge', 'बाद में जोड़ेंगे', 'Add items later'],
  'err.network': ['Internet nahi mil raha. Net check karke phir koshish kijiye.', 'इंटरनेट नहीं मिल रहा। नेट जाँच कर फिर कोशिश कीजिए।', 'No internet connection. Check your network and try again.'],
  'err.generic': ['Kuch gadbad hui. Phir koshish kijiye.', 'कुछ गड़बड़ हुई। फिर कोशिश कीजिए।', 'Something went wrong. Please try again.'],
  'err.rateLimited': ['Bahut jaldi-jaldi. Thodi der baad koshish kijiye.', 'बहुत जल्दी-जल्दी। थोड़ी देर बाद कोशिश कीजिए।', 'Too many attempts. Please wait a little and try again.'],
  'err.reminderTooSoon': ['Aaj reminder pehle hi bheja ja chuka hai.', 'आज रिमाइंडर पहले ही भेजा जा चुका है।', 'A reminder was already sent in the last 24 hours.'],
  'v.unsupportedApp': ['Is phone par awaaz pehchan uplabdh nahi hai. Likh kar bhejiye.', 'इस फ़ोन पर आवाज़ पहचान उपलब्ध नहीं है। लिखकर भेजिए।', 'Speech recognition is not available on this phone. Please type instead.'],
  'v.blockedApp': ['Mic ki permission nahi mili. Phone ki Settings mein Aawaz ke liye microphone chalu kijiye.', 'माइक की अनुमति नहीं मिली। फ़ोन की सेटिंग्स में आवाज़ के लिए माइक्रोफ़ोन चालू कीजिए।', 'Microphone permission was not given. Allow the microphone for Aawaz in your phone settings.'],
  'v.stop': ['Bas', 'बस', 'Stop'],
  send: ['Bhejo', 'भेजें', 'Send'],
  retry: ['Phir se', 'फिर से', 'Retry'],
  loading: ['Ek second…', 'एक सेकंड…', 'One moment…'],
  'sh.signOut': ['Log out', 'लॉग आउट', 'Log out'],
  'sh.signOutAsk': ['Is phone se log out karein?', 'इस फ़ोन से लॉग आउट करें?', 'Log out from this phone?'],
  'sh.summaryTime': ['Roz ka hisaab (WhatsApp par)', 'रोज़ का हिसाब (WhatsApp पर)', 'Daily summary (on WhatsApp)'],
  'sh.details': ['Dukaan ki jaankari', 'दुकान की जानकारी', 'Shop details'],
  'sh.saved': ['Save ho gaya.', 'सेव हो गया।', 'Saved.'],
  'sh.gst': ['GST', 'GST', 'GST'],
  'sh.server': ['Server', 'सर्वर', 'Server'],
  'chat.summary': ['Aaj ka hisaab', 'आज का हिसाब', "Today's summary"],
  'chat.lowStock': ['Kam stock', 'कम स्टॉक', 'Low stock'],
  'chat.customers': ['Grahak', 'ग्राहक', 'Customers'],
  'chat.example1': ['Ramesh ko 5 kilo atta, 1 kilo toor dal udhaar mein likh do', 'रमेश को पाँच किलो आटा, एक किलो तूर दाल उधार में लिख दो', 'Ramesh 5 kg atta and 1 kg toor dal on credit'],
  'chat.example2': ['Ramesh ne 500 rupaye diye UPI se', 'रमेश ने पाँच सौ रुपये दिए UPI से', 'Ramesh paid 500 rupees by UPI'],
  'chat.example3': ['Maal aaya: 20 bag atta', 'माल आया: बीस बैग आटा', 'Received stock: 20 bags atta'],
  'chat.open': ['Kholo', 'खोलें', 'Open'],
  'chat.chooseCustomer': ['Kaun sa grahak?', 'कौन सा ग्राहक?', 'Which customer?'],
  'bill.newCustomerPhone': ['Mobile number (optional)', 'मोबाइल नंबर (ज़रूरी नहीं)', 'Mobile number (optional)'],
  'bill.qty': ['Kitna', 'कितना', 'Qty'],
  'bill.savePrice': ['Yeh daam yaad rakho', 'यह दाम याद रखो', 'Remember this price'],
  'bill.payMode': ['Bhugtaan', 'भुगतान', 'Payment'],
  'cu.since2': ['{d} se', '{d} से', 'Since {d}'],
  'cu.reminderQueued': ['Reminder bhej diya.', 'रिमाइंडर भेज दिया।', 'Reminder sent.'],
  'cu.share': ['Grahak ka khata link', 'ग्राहक का खाता लिंक', "Customer's account link"],
  'cu.deletion': ['Grahak ne apni jaankari hatane ko kaha hai. Baaki chukne ke baad hata di jaayegi.', 'ग्राहक ने अपनी जानकारी हटाने को कहा है। बाकी चुकने के बाद हटा दी जाएगी।', 'The customer asked to delete their details. They will be removed once nothing is due.'],
  'cu.optedOut': ['Grahak ne message band kiye hain', 'ग्राहक ने मैसेज बंद किए हैं', 'The customer has turned messages off'],
  'cu.undoAsk': ['Yeh entry hata dein? Khata pehle jaisa ho jaayega.', 'यह एंट्री हटा दें? खाता पहले जैसा हो जाएगा।', 'Undo this entry? The account goes back to how it was.'],
  'st.search': ['Item dhoondho', 'आइटम ढूँढें', 'Search items'],
  'st.edit': ['Item badlo', 'आइटम बदलें', 'Edit item'],
  'st.lowAt': ['Kam stock ki seema', 'कम स्टॉक की सीमा', 'Low stock alert at'],
  'st.remove': ['Item hatao', 'आइटम हटाएँ', 'Remove item'],
  'st.removeAsk': ['Yeh item list se hata dein? Purane bill waise hi rahenge.', 'यह आइटम सूची से हटा दें? पुराने बिल वैसे ही रहेंगे।', 'Remove this item from the list? Old bills stay as they are.'],
  'st.gstRate': ['GST %', 'GST %', 'GST %'],
  'st.hsn': ['HSN code', 'HSN कोड', 'HSN code'],
  yes: ['Haan', 'हाँ', 'Yes'],
  no: ['Nahi', 'नहीं', 'No'],
  close: ['Band karo', 'बंद करें', 'Close'],
} as const satisfies Record<string, readonly [string, string, string]>;

const ALL = { ...STRINGS, ...APP_STRINGS };
export type TKey = keyof typeof ALL;

const INDEX: Record<Lang, 0 | 1 | 2> = { hinglish: 0, hi: 1, en: 2 };
const LANG_KEY = 'aawaz.lang';

export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>) {
  const text: string = ALL[key][INDEX[lang]];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const Ctx = createContext<I18n | null>(null);

/** The app language. Before login it is the phone's saved choice; after login the shop's language wins. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('hinglish');

  useEffect(() => {
    getItem(LANG_KEY).then((v) => {
      if (v === 'hi' || v === 'en' || v === 'hinglish') setLangState(v);
    });
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    void setItem(LANG_KEY, next);
  }, []);

  const value = useMemo<I18n>(() => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

/** BCP-47 tag for speech recognition and text-to-speech. Hinglish is spoken Hindi, so it uses hi-IN. */
export function speechLocale(lang: Lang) {
  return lang === 'en' ? 'en-IN' : 'hi-IN';
}

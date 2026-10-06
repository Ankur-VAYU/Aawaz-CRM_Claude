# AwaazCRM web demo

A single-page demo of the shopkeeper's chat app, on sample data for Sharma Kirana Store. It runs
the backend's own parsing, matching, transliteration and reply code in the browser (bundled from
`backend/src`), so commands behave the way the server understands them. Data stays in the
browser; WhatsApp messages are shown as previews.

**Languages**: the whole app (screens, replies, WhatsApp previews, onboarding) is available in
हिंदी, Hinglish and English; pick one in the header or the Shop tab. Commands are understood in all
three (Hindi in Devanagari is transliterated before parsing).

**Voice**: the green mic uses the browser's speech recognition (Chrome on Android/desktop, Safari
on iPhone; needs internet and a page served over HTTPS). By default Hindi and Hinglish listen with
the Hindi recogniser (hi-IN) and English with Indian English (en-IN); this can be changed in the
Shop tab.

Rebuild after changing `template.html` or the backend code it uses:

```bash
cd backend && npm install && cd ..
node demo/build.mjs        # writes demo/index.html
```

# AwaazCRM web demo

A single-page demo of the shopkeeper's chat app, on sample data for Sharma Kirana Store. It runs
the backend's own parsing, matching, transliteration and reply code in the browser (bundled from
`backend/src`), so commands behave the way the server understands them. Data stays in the
browser; WhatsApp messages are shown as previews.

**Voice**: the green mic uses the browser's speech recognition (Chrome on Android/desktop, Safari
on iPhone; needs internet and a page served over HTTPS). Choose हिंदी (hi-IN, Devanagari is
transliterated) or Hinglish (en-IN) in the header.

Rebuild after changing `template.html` or the backend code it uses:

```bash
cd backend && npm install && cd ..
node demo/build.mjs        # writes demo/index.html
```

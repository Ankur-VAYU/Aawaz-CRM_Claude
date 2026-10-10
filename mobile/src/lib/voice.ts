import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useRef, useState } from 'react';
import type { TKey } from './i18n';

export type VoiceError = Extract<TKey, 'v.unsupportedApp' | 'v.blockedApp' | 'v.network' | 'v.nothing'>;

/**
 * Speech → text with the phone's recogniser (Google on Android, Apple on iOS; the browser when testing on web).
 * `onFinal` gets the transcript once the shopkeeper stops speaking.
 */
export function useVoice(locale: string, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<VoiceError | null>(null);
  const active = useRef(false);
  const delivered = useRef(false);
  const lastText = useRef('');

  const finish = useCallback(
    (text: string) => {
      if (delivered.current) return;
      delivered.current = true;
      setInterim('');
      const t = text.trim();
      if (t) onFinal(t);
      else setError('v.nothing');
    },
    [onFinal],
  );

  useSpeechRecognitionEvent('result', (e) => {
    if (!active.current) return;
    const text = e.results[0]?.transcript ?? '';
    lastText.current = text;
    if (e.isFinal) finish(text);
    else setInterim(text);
  });

  useSpeechRecognitionEvent('error', (e) => {
    if (!active.current) return;
    if (e.error === 'aborted') return;
    delivered.current = true;
    setInterim('');
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setError('v.blockedApp');
    else if (e.error === 'network') setError('v.network');
    else if (e.error === 'language-not-supported') setError('v.unsupportedApp');
    else setError('v.nothing');
  });

  useSpeechRecognitionEvent('end', () => {
    if (!active.current) return;
    active.current = false;
    setListening(false);
    // Some recognisers end without marking the last result final.
    finish(lastText.current);
  });

  const start = useCallback(async () => {
    setError(null);
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError('v.unsupportedApp');
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setError('v.blockedApp');
      return;
    }
    void Speech.stop();
    delivered.current = false;
    lastText.current = '';
    active.current = true;
    setListening(true);
    setInterim('');
    ExpoSpeechRecognitionModule.start({ lang: locale, interimResults: true, continuous: false, maxAlternatives: 1 });
  }, [locale]);

  const stop = useCallback(() => {
    if (active.current) ExpoSpeechRecognitionModule.stop();
  }, []);

  return { listening, interim, error, start, stop, clearError: () => setError(null) };
}

/** Reads a reply aloud (when the shop chose "voice + text"). */
export function speak(text: string, locale: string) {
  void Speech.stop();
  Speech.speak(text, { language: locale, rate: 1 });
}

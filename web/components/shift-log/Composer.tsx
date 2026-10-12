'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createShiftEntry } from '@/app/(app)/shift-log/actions';
import { Button, Card, Field, TextArea, Toast } from '@/components/ui';

/* Minimal Web Speech API typings (lib.dom does not include them). */
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechResult[];
}
interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Quick-log composer: typed note plus optional voice dictation. */
export default function Composer() {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<'success' | 'error' | 'info'>('info');
  const [supported, setSupported] = useState<boolean | null>(null);
  const [dictating, setDictating] = useState(false);
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const usedVoiceRef = useRef(false);

  useEffect(() => {
    setSupported(getRecognitionConstructor() !== null);
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* already stopped */
      }
    };
  }, []);

  function startDictation() {
    const Ctor = getRecognitionConstructor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }
      if (finalText) {
        usedVoiceRef.current = true;
        setBody((prev) => {
          const needsSpace = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n');
          return prev + (needsSpace ? ' ' : '') + finalText.trim();
        });
      }
      setInterim(interimText.trim());
    };
    recognition.onerror = () => {
      setDictating(false);
      setInterim('');
      setToast('Dictation stopped unexpectedly. Your typed text is kept.');
      setToastTone('error');
    };
    recognition.onend = () => {
      setDictating(false);
      setInterim('');
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      usedVoiceRef.current = true;
      setDictating(true);
    } catch {
      setDictating(false);
    }
  }

  function stopDictation() {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
    setDictating(false);
    setInterim('');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setToast(null);
    const result = await createShiftEntry({
      body,
      source: usedVoiceRef.current ? 'voice' : 'manual',
    });
    setBusy(false);
    if (!result.ok) {
      setToast(result.error);
      setToastTone('error');
      return;
    }
    setBody('');
    usedVoiceRef.current = false;
    setToast('Note logged.');
    setToastTone('success');
    router.refresh();
  }

  return (
    <Card style={{ marginBottom: 24 }}>
      <Toast message={toast} tone={toastTone} />
      <h2 className="section-title">Quick log</h2>
      <form onSubmit={onSubmit}>
        <Field label="Shift note" htmlFor="shift-note-body">
          <TextArea
            id="shift-note-body"
            rows={4}
            maxLength={4000}
            placeholder="What happened this shift? Anything the next manager should know."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        {dictating && interim && (
          <p role="status" style={{ color: 'var(--text2)', fontStyle: 'italic' }}>
            Hearing: {interim}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button type="submit" disabled={busy || body.trim().length === 0}>
            {busy ? 'Logging…' : 'Log note'}
          </Button>
          {supported !== false && (
            <Button
              type="button"
              variant="ghost"
              onClick={dictating ? stopDictation : startDictation}
              aria-label={dictating ? 'Stop dictating' : 'Dictate note by voice'}
            >
              {dictating ? 'Stop dictating' : 'Dictate'}
            </Button>
          )}
        </div>
        {supported === false && (
          <p style={{ color: 'var(--text2)', marginTop: 8 }}>
            Voice dictation is not supported in this browser. Type your note instead.
          </p>
        )}
      </form>
    </Card>
  );
}

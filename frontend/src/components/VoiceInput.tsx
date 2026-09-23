import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Upload, X } from 'lucide-react';
import { api, errorMessage } from '../api/client';
import { Button, ErrorBanner, Textarea } from './ui';

const MAX_BYTES = 10 * 1024 * 1024;
type Phase = 'idle' | 'permission' | 'recording' | 'transcribing';

export function VoiceInput({ disabled, remaining, onTranscript, onBusyChange }: {
  disabled?: boolean;
  remaining: number;
  onTranscript: (text: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const locked = useRef(false);
  const upload = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingSupported = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  function releaseMicrophone() {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  useEffect(() => {
    onBusyChange(phase !== 'idle');
  }, [phase, onBusyChange]);
  useEffect(() => () => {
    generation.current++;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    releaseMicrophone();
  }, []);

  async function transcribe(blob: Blob, filename: string, request: number) {
    if (request !== generation.current) return;
    setPhase('transcribing');
    try {
      if (!blob.size) throw new Error('Запись пустая. Попробуйте ещё раз.');
      if (blob.size > MAX_BYTES) throw new Error('Выберите запись размером до 10 МБ.');
      const result = await api.transcribeAudio(blob, filename);
      if (request === generation.current) setTranscript(result.text);
    } catch (reason) {
      if (request === generation.current) setError(reason instanceof Error ? reason.message : errorMessage(reason));
    } finally {
      if (request === generation.current) { setPhase('idle'); locked.current = false; }
    }
  }

  function cancel() {
    generation.current++;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    releaseMicrophone();
    locked.current = false;
    setPhase('idle');
  }

  async function start() {
    if (disabled || locked.current || !recordingSupported) return;
    locked.current = true;
    const request = ++generation.current;
    setError(null);
    setTranscript('');
    setSeconds(0);
    setPhase('permission');
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== generation.current) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone;
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('Этот браузер не поддерживает нужный формат записи. Загрузите аудиофайл.');
      const next = new MediaRecorder(microphone, { mimeType });
      recorder.current = next;
      const chunks: Blob[] = [];
      let size = 0;
      next.ondataavailable = event => {
        if (request !== generation.current || !event.data.size) return;
        chunks.push(event.data);
        size += event.data.size;
        if (size > MAX_BYTES) { cancel(); setError('Запись превысила 10 МБ. Запишите более короткое описание.'); }
      };
      next.onerror = () => {
        if (request !== generation.current) return;
        cancel(); setError('Не удалось записать звук. Проверьте микрофон.');
      };
      next.onstop = () => {
        if (request !== generation.current) return;
        releaseMicrophone();
        void transcribe(new Blob(chunks, { type: mimeType }), mimeType.includes('mp4') ? 'recording.mp4' : 'recording.webm', request);
      };
      next.start(1000);
      setPhase('recording');
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 120 && next.state === 'recording') next.stop();
      }, 1000);
    } catch (reason) {
      if (request !== generation.current) return;
      releaseMicrophone();
      locked.current = false;
      setPhase('idle');
      setError(reason instanceof DOMException && reason.name === 'NotAllowedError'
        ? 'Доступ к микрофону запрещён. Разрешите его в браузере или загрузите аудиофайл.'
        : reason instanceof Error ? reason.message : 'Не удалось открыть микрофон.');
    }
  }

  return <div className="stack" style={{ gap: 10 }}>
    <div className="form-actions">
      {phase === 'idle' && <Button variant="secondary" disabled={disabled || !recordingSupported} onClick={() => void start()}><Mic size={16} />Продиктовать описание</Button>}
      {phase === 'recording' && <Button variant="secondary" onClick={() => { if (recorder.current?.state === 'recording') recorder.current.stop(); }}><Square size={16} />Завершить и распознать · {seconds} с</Button>}
      {(phase === 'permission' || phase === 'recording') && <Button variant="ghost" onClick={cancel}><X size={16} />Отмена</Button>}
      {phase === 'transcribing' && <span role="status">Распознаём запись…</span>}
      <Button variant="ghost" disabled={disabled || phase !== 'idle'} onClick={() => upload.current?.click()}><Upload size={16} />Загрузить аудио</Button>
      <input ref={upload} type="file" hidden accept=".mp3,.mp4,.m4a,.wav,.webm,.mpeg,.mpga" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file || disabled || locked.current) return;
        locked.current = true; setError(null); setTranscript('');
        void transcribe(file, file.name, ++generation.current);
      }} />
    </div>
    <p className="muted text-small">До 2 минут записи или аудиофайл до 10 МБ. Аудио отправляется в OpenAI для распознавания. Проверьте текст перед добавлением.</p>
    {!recordingSupported && <p className="muted text-small">Запись микрофона недоступна. Откройте сайт через HTTPS или localhost либо загрузите аудио.</p>}
    {error && <ErrorBanner message={error} />}
    {transcript && <div className="stack">
      <Textarea label="Распознанное описание" value={transcript} onChange={event => setTranscript(event.target.value)} rows={5} disabled={disabled} error={transcript.trim().length > remaining ? 'Текст вместе с описанием превышает 8 000 символов. Сократите его.' : undefined} />
      <Button variant="secondary" disabled={disabled || !transcript.trim() || transcript.trim().length > remaining} onClick={() => { onTranscript(transcript.trim()); setTranscript(''); }}>Добавить в описание</Button>
    </div>}
  </div>;
}

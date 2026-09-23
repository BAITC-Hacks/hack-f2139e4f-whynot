import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Upload, X } from 'lucide-react';
import { api, errorMessage, USE_MOCKS } from '../api/client';
import { Button, ErrorBanner, Textarea } from './ui';
import './VoiceInput.css';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SECONDS = 120;
const ACCEPT = '.mp3,.mp4,.m4a,.mpeg,.mpga,.wav,.webm';
const AUDIO_EXTENSION = /\.(mp3|mp4|m4a|mpeg|mpga|wav|webm)$/i;
type Phase = 'idle' | 'permission' | 'recording' | 'transcribing';

function audioError(file: File) {
  if (!AUDIO_EXTENSION.test(file.name)) return 'Выберите аудио в формате MP3, MP4, M4A, MPEG, MPGA, WAV или WebM.';
  if (!file.size) return 'Аудиофайл пустой. Выберите другой файл или запишите голос ещё раз.';
  if (file.size > MAX_BYTES) return 'Размер аудио не должен превышать 10 МБ.';
  return null;
}

function recordingType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}

interface VoiceInputProps {
  actorId: string;
  disabled?: boolean;
  description: string;
  onDescriptionChange: (text: string) => void;
  onActivityChange: (busy: boolean) => void;
}

export function VoiceInput({ actorId, disabled, description, onDescriptionChange, onActivityChange }: VoiceInputProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);
  const locked = useRef(false);
  const operation = useRef(0);
  const recordingStarted = useRef(0);
  const mimeType = recordingType();
  const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!mimeType && window.isSecureContext;
  const isBusy = phase !== 'idle';
  const unavailable = disabled || USE_MOCKS;
  const mergedDescription = [description.trimEnd(), transcript?.trim()].filter(Boolean).join('\n\n');
  const exceedsDescription = mergedDescription.length > 8000;

  function clearTimers() {
    if (timer.current !== null) clearInterval(timer.current);
    if (deadline.current !== null) clearTimeout(deadline.current);
    timer.current = null;
    deadline.current = null;
  }

  function releaseCapture() {
    clearTimers();
    const current = recorder.current;
    recorder.current = null;
    if (current) {
      current.onstop = null;
      current.ondataavailable = null;
      current.onerror = null;
      if (current.state !== 'inactive') current.stop();
    }
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream.current = null;
  }

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      operation.current++;
      locked.current = false;
      releaseCapture();
    };
  }, []);

  useEffect(() => { onActivityChange(isBusy); }, [isBusy, onActivityChange]);

  function cancel() {
    const wasTranscribing = phase === 'transcribing';
    operation.current++;
    locked.current = false;
    releaseCapture();
    setPhase('idle');
    setNotice(wasTranscribing ? 'Ожидание отменено. Уже отправленное аудио может продолжать обрабатываться в OpenAI.' : 'Запись отменена. Аудио не отправлено.');
  }

  async function transcribe(audio: File, id: number) {
    if (!active.current || id !== operation.current) return;
    const invalid = audioError(audio);
    if (invalid) {
      setError(invalid);
      locked.current = false;
      setPhase('idle');
      return;
    }
    setPhase('transcribing');
    setError(null);
    setNotice('');
    try {
      const result = await api.transcribeAudio(actorId, audio);
      if (!active.current || id !== operation.current) return;
      if (!result.text.trim()) throw new Error('Не удалось распознать речь. Попробуйте другую запись или введите текст.');
      setTranscript(result.text);
      setFile(null);
      setNotice('Текст распознан. Проверьте его и добавьте к описанию.');
    } catch (reason) {
      if (active.current && id === operation.current) setError(errorMessage(reason));
    } finally {
      if (active.current && id === operation.current) { locked.current = false; setPhase('idle'); }
    }
  }

  function stopRecording() {
    const current = recorder.current;
    if (!current || current.state === 'inactive') return;
    clearTimers();
    setPhase('transcribing');
    current.stop();
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  }

  async function startRecording() {
    if (unavailable || locked.current || !canRecord) return;
    locked.current = true;
    const id = ++operation.current;
    setError(null);
    setNotice('');
    setFile(null);
    setElapsed(0);
    setPhase('permission');
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active.current || id !== operation.current) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream.current = acquired;
      const current = new MediaRecorder(acquired, { mimeType });
      recorder.current = current;
      const chunks: Blob[] = [];
      let bytes = 0;
      current.ondataavailable = event => {
        if (!active.current || id !== operation.current || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_BYTES) {
          operation.current++;
          releaseCapture();
          locked.current = false;
          setPhase('idle');
          setError('Запись превысила 10 МБ и не была отправлена. Запишите более короткий фрагмент.');
          return;
        }
        chunks.push(event.data);
      };
      current.onerror = () => {
        if (!active.current || id !== operation.current) return;
        operation.current++;
        releaseCapture();
        locked.current = false;
        setPhase('idle');
        setError('Запись прервалась. Попробуйте ещё раз, загрузите аудиофайл или введите текст.');
      };
      current.onstop = () => {
        if (!active.current || id !== operation.current) return;
        releaseCapture();
        const blob = new Blob(chunks, { type: mimeType });
        const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
        void transcribe(new File([blob], `recording.${extension}`, { type: mimeType }), id);
      };
      acquired.getAudioTracks().forEach(track => { track.onended = stopRecording; });
      current.start(1000);
      recordingStarted.current = Date.now();
      setPhase('recording');
      timer.current = setInterval(() => setElapsed(Math.min(MAX_SECONDS, Math.floor((Date.now() - recordingStarted.current) / 1000))), 250);
      deadline.current = setTimeout(stopRecording, MAX_SECONDS * 1000);
    } catch (reason) {
      if (!active.current || id !== operation.current) return;
      releaseCapture();
      locked.current = false;
      setPhase('idle');
      const denied = reason instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(reason.name);
      setError(denied ? 'Доступ к микрофону не разрешён. Разрешите его в браузере, загрузите аудиофайл или введите текст.' : 'Не удалось включить микрофон. Проверьте устройство, загрузите аудиофайл или введите текст.');
    }
  }

  function sendSelectedFile() {
    if (!file || unavailable || locked.current) return;
    locked.current = true;
    void transcribe(file, ++operation.current);
  }

  function appendTranscript() {
    if (unavailable || locked.current || !transcript?.trim() || exceedsDescription) return;
    onDescriptionChange(mergedDescription);
    setTranscript(null);
    setNotice('Распознанный текст добавлен к описанию. Его можно отредактировать выше.');
  }

  return <section className="voice-input" aria-labelledby="voice-input-title">
    <div className="voice-input-heading"><Mic size={18} aria-hidden="true" /><h3 id="voice-input-title">Рассказать голосом</h3></div>
    <p className="muted text-small">Аудио отправляется в OpenAI для распознавания. На сервере проекта постоянная копия не сохраняется. Запись — до 2 минут, файл — до 10 МБ.</p>
    {USE_MOCKS ? <p className="voice-input-note">Голосовой ввод недоступен в демонстрационном режиме. Введите описание текстом.</p> : <>
      <p className="muted text-small">После остановки или через 2 минуты запись отправится на распознавание. Текст можно исправить перед добавлением к описанию.</p>
      {!canRecord && <p className="voice-input-note">Запись с микрофона недоступна в этом браузере. Можно загрузить аудиофайл или ввести описание текстом. Для микрофона нужен HTTPS или localhost.</p>}
      <div className="form-actions">
        {phase === 'recording' ? <Button variant="secondary" onClick={stopRecording}><Square size={16} aria-hidden="true" />Остановить и распознать</Button> : <Button variant="secondary" disabled={unavailable || isBusy || !canRecord} loading={phase === 'permission'} onClick={() => void startRecording()}><Mic size={16} aria-hidden="true" />{phase === 'permission' ? 'Ждём разрешения' : 'Записать голос'}</Button>}
        <Button variant="secondary" disabled={unavailable || isBusy} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />Выбрать аудиофайл</Button>
        {isBusy && <Button variant="ghost" onClick={cancel}><X size={16} aria-hidden="true" />Отмена</Button>}
        <input ref={input} type="file" accept={ACCEPT} hidden disabled={unavailable || isBusy} onChange={event => {
          const selected = event.target.files?.[0];
          event.target.value = '';
          if (!selected || unavailable || locked.current) return;
          const invalid = audioError(selected);
          setError(invalid);
          setNotice('');
          setFile(invalid ? null : selected);
        }} />
      </div>
      {phase === 'recording' && <p className="voice-recording-status" role="status"><span aria-hidden="true" />Идёт запись: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} / 2:00</p>}
      {phase === 'transcribing' && <p className="muted text-small" role="status">Распознаём аудио… Описание пока не изменилось.</p>}
      {file && <div className="voice-file"><span>{file.name} · {(file.size / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ</span><Button size="sm" disabled={unavailable || isBusy} onClick={sendSelectedFile}>Распознать файл</Button></div>}
      <p className="muted text-small">Форматы: MP3, MP4, M4A, MPEG, MPGA, WAV, WebM.</p>
    </>}
    {error && <ErrorBanner message={error} />}
    {transcript !== null && <div className="voice-transcript"><Textarea label="Распознанный текст — можно исправить" value={transcript} onChange={event => setTranscript(event.target.value)} disabled={unavailable || isBusy} maxLength={8000} rows={5} error={exceedsDescription ? 'Вместе с описанием получится больше 8 000 символов. Сократите описание или распознанный текст.' : undefined} /><div className="form-actions"><Button disabled={unavailable || isBusy || !transcript?.trim() || exceedsDescription} onClick={appendTranscript}>Добавить к описанию</Button><Button variant="ghost" disabled={unavailable || isBusy} onClick={() => { setTranscript(null); setNotice('Распознанный текст удалён.'); }}>Удалить текст</Button></div></div>}
    {notice && <p className="voice-input-note" role="status">{notice}</p>}
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square } from 'lucide-react';
import { Modal } from '../components';
import type { NewCitizenRequest } from '../services/api';

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const maxRecordingBytes = 10 * 1024 * 1024;
const recordingMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const languageLocales: Record<string, string> = {
  English: 'en-IN', Telugu: 'te-IN', Hindi: 'hi-IN', Bengali: 'bn-IN', Tamil: 'ta-IN',
  Kannada: 'kn-IN', Malayalam: 'ml-IN', Marathi: 'mr-IN', Gujarati: 'gu-IN', Punjabi: 'pa-IN',
};

export function VoiceRequestModal({ onClose, onAdd }: {
  onClose: () => void;
  onAdd: (request: NewCitizenRequest, recording?: Blob) => Promise<void>;
}) {
  const [form, setForm] = useState<NewCitizenRequest>({ message: '', language: 'English', location: '', sector: 'Water & Sanitation', severity: 'Moderate', source: 'Web' });
  const [saving, setSaving] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState<Blob | null>(null);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [error, setError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (!recording) {
      setRecordingUrl('');
      return;
    }
    const url = URL.createObjectURL(recording);
    setRecordingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const update = (key: keyof NewCitizenRequest, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };
  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    else setRecordingActive(false);
  };

  const supportedRecordingMimeType = () => {
    if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
    return recordingMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  };

  const startRecording = async () => {
    if (recordingActive) {
      stopRecording();
      return;
    }
    stopListening();
    setError('');
    if (!window.isSecureContext) {
      setError('Microphone access requires HTTPS or http://localhost. Open CivicOS on a secure connection and try again.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not available in this browser. Try a current version of Chrome, Edge, or Safari.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = supportedRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      setRecording(null);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => setError('Recording failed. Check microphone permission and that no other app is using the microphone.');
      recorder.onstop = () => {
        const audio = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (!audio.size) setError('No audio was captured. Try recording again.');
        else if (audio.size > maxRecordingBytes) setError('Recording exceeds the 10 MB limit. Record a shorter message.');
        else setRecording(audio);
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecordingActive(false);
      };
      recorder.start();
      setRecordingActive(true);
      update('source', 'Voice');
    } catch (cause) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const denied = cause instanceof DOMException && cause.name === 'NotAllowedError';
      const unsupported = cause instanceof DOMException && (cause.name === 'NotSupportedError' || cause.name === 'NotReadableError');
      setError(denied ? 'Microphone permission was denied. Allow microphone access in browser settings, then try again.' : unsupported ? 'The microphone is unavailable or already in use by another app.' : 'Could not access the microphone. Check that a microphone is connected and try again.');
    }
  };

  const startDictation = () => {
    if (listening) {
      stopListening();
      return;
    }
    if (recordingActive) return;
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError('Speech-to-text is not supported in this browser. You can still record audio or type the request.');
      return;
    }
    setError('');
    const recognition = new Recognition();
    recognition.lang = languageLocales[form.language] || 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) transcript += result[0].transcript;
      }
      if (transcript.trim()) setForm((current) => ({ ...current, message: [current.message, transcript.trim()].filter(Boolean).join(' '), source: 'Voice' }));
    };
    recognition.onerror = (event) => {
      setListening(false);
      setError(event.error === 'not-allowed' ? 'Microphone permission was denied. Allow microphone access in browser settings, then try again.' : `Speech recognition error: ${event.error}. You can still enter the request as text.`);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError('Could not start speech input. Check microphone permission and try again.');
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (recordingActive) {
      setError('Stop the recording before saving the request.');
      return;
    }
    stopListening();
    setSaving(true);
    setError('');
    try {
      const request = { ...form, message: form.message.trim() || (recording ? 'Voice recording submitted.' : '') };
      await onAdd(request, recording || undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save request.');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    stopListening();
    stopRecording();
    onClose();
  };

  return <Modal onClose={close}><form className="request-form" onSubmit={submit}>
    <div className="eyebrow">CITIZEN REQUEST · SAVED TO SUPABASE</div>
    <h2>Add citizen request</h2>
    <label>Request<textarea required={!recording} minLength={recording ? undefined : 5} maxLength={4000} value={form.message} onChange={(event) => update('message', event.target.value)}/></label>
    <div className="microphone-actions">
      <button type="button" className="secondary" onClick={startRecording} disabled={saving || listening} aria-pressed={recordingActive}>{recordingActive ? <Square size={16}/> : <Mic size={16}/>} {recordingActive ? 'Stop recording' : 'Record audio'}</button>
      <button type="button" className="secondary" onClick={startDictation} disabled={saving || recordingActive} aria-pressed={listening}>{listening ? <MicOff size={16}/> : <Mic size={16}/>} {listening ? 'Stop dictation' : 'Speak to text'}</button>
    </div>
    {recordingActive && <p role="status">Recording audio… Select “Stop recording” when finished.</p>}
    {recordingUrl && <div className="recording-preview"><audio controls src={recordingUrl}/><button type="button" className="secondary" onClick={() => setRecording(null)}>Remove recording</button></div>}
    <p className="voice-note">Audio is saved with this request (10 MB maximum). Speech-to-text support varies by browser and language. This prototype has no sign-in; do not submit sensitive recordings.</p>
    <label>Location<input required value={form.location} onChange={(event) => update('location', event.target.value)}/></label>
    <p className="voice-note">Location is automatically sent to OpenStreetMap Nominatim to find map coordinates. Requests still save if a location cannot be found.</p>
    <label>Language<select value={form.language} onChange={(event) => update('language', event.target.value)}>{Object.keys(languageLocales).map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Sector<select value={form.sector} onChange={(event) => update('sector', event.target.value)}>{['Water & Sanitation','Transport & Roads','Healthcare','Education','Renewable Energy','Other'].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Severity<select value={form.severity} onChange={(event) => update('severity', event.target.value)}>{['Low','Moderate','High','Critical'].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Source<select value={form.source} onChange={(event) => update('source', event.target.value)}>{['Web','Voice','SMS','WhatsApp','Other'].map((value) => <option key={value}>{value}</option>)}</select></label>
    {error && <p role="alert">{error}</p>}
    <button className="primary" disabled={saving || recordingActive || listening}>{saving ? 'Saving…' : 'Save request'}</button>
  </form></Modal>;
}
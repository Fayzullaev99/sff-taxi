import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLive, useSos } from '../api/queries';
import { useRealtimeEvents } from '../api/realtime';
import {
  alarm,
  audioReady,
  notify,
  setTitleBadge,
  soundPreference,
  sosAlarm,
  unlockAudio,
} from '../lib/alert';
import { formatPhone } from '../lib/phone';
import { alarmKeys, freshKeys, needsDriver, placeLine } from '../lib/rides';

/** While an alarm stays unacknowledged it sounds again: SOS every 30 s, rides every minute. */
const REPEAT_SOS_MS = 30_000;
const REPEAT_RIDE_MS = 60_000;
/** A realtime event already sounded: the refetch that follows does not sound again. */
const SOUNDED_WINDOW_MS = 5000;

/**
 * Dispatchers must not miss a ride nobody took nor an SOS: each new one (from the realtime
 * event at once, or from the polls when the stream is down) sounds an alarm and raises a
 * browser notification; the alarm repeats until someone presses "Ko‘rdim". The tab title and
 * favicon carry the count.
 */
export function useDispatchAlarms() {
  const live = useLive(15_000);
  const sos = useSos(true);
  const navigate = useNavigate();
  const [soundOn, setSoundOn] = useState(soundPreference.get);
  const [audioUnlocked, setAudioUnlocked] = useState(audioReady);
  const [acknowledged, setAcknowledged] = useState(true);
  const seen = useRef<Set<string> | null>(null);
  const soundedAt = useRef(0);
  const soundRef = useRef(false);
  soundRef.current = soundOn && audioUnlocked;

  const waiting = (live.data?.rides ?? []).filter(needsDriver);
  const openSos = sos.data ?? [];
  const count = waiting.length + openSos.length;

  // the first click anywhere unlocks audio (browsers block sound until a gesture)
  useEffect(() => {
    if (audioUnlocked) return;
    const unlock = () => void unlockAudio().then(setAudioUnlocked);
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [audioUnlocked]);

  useRealtimeEvents((event) => {
    const isSos = event.type === 'sos';
    const noDriver = event.type === 'ride.attention' && event.reason === 'no_driver';
    if (!isSos && !noDriver) return;
    setAcknowledged(false);
    soundedAt.current = Date.now();
    if (soundRef.current) (isSos ? sosAlarm : alarm)();
  });

  useEffect(() => {
    if (!live.data || !sos.data) return;
    const keys = alarmKeys(live.data.rides, sos.data);
    const fresh = freshKeys(seen.current, keys);
    // alarms already open when the panel loaded are shown, not re-announced
    seen.current = new Set(keys);
    if (!fresh.length) return;
    setAcknowledged(false);
    const freshSos = sos.data.filter((s) => fresh.includes(`sos:${s.id}`));
    const freshRides = live.data.rides.filter((r) => fresh.includes(`ride:${r.id}`));
    if (soundRef.current && Date.now() - soundedAt.current > SOUNDED_WINDOW_MS) {
      (freshSos.length ? sosAlarm : alarm)();
    }
    for (const s of freshSos) {
      notify(
        `SOS: #${s.rideNumber} safari`,
        `${s.role === 'driver' ? 'Haydovchi' : 'Yo‘lovchi'} ${formatPhone(s.phone)}${
          s.note ? `: ${s.note}` : ''
        }`,
        `sos-${s.id}`,
        () => navigate('/sos'),
      );
    }
    for (const r of freshRides) {
      notify(
        `#${r.number}: haydovchi topilmadi`,
        `${placeLine(r.pickup)} — qo‘lda tayinlang`,
        `ride-${r.id}`,
        () => navigate(`/dispatch?ride=${r.id}`),
      );
    }
  }, [live.data, sos.data, navigate]);

  useEffect(() => {
    setTitleBadge(count, openSos.length ? 'SOS' : 'Diqqat');
  }, [count, openSos.length]);
  useEffect(() => () => setTitleBadge(0), []);

  // keep reminding while something waits and nobody said they saw it
  const hasSos = openSos.length > 0;
  useEffect(() => {
    if (acknowledged || !count || !soundOn || !audioUnlocked) return;
    const t = setInterval(hasSos ? sosAlarm : alarm, hasSos ? REPEAT_SOS_MS : REPEAT_RIDE_MS);
    return () => clearInterval(t);
  }, [acknowledged, count, hasSos, soundOn, audioUnlocked]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    soundPreference.set(next);
    if (next) void unlockAudio().then(setAudioUnlocked);
  };

  return {
    waiting,
    openSos,
    count,
    soundOn,
    audioUnlocked,
    toggleSound,
    acknowledged,
    acknowledge: () => setAcknowledged(true),
  };
}

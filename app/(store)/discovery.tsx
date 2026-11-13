'use client';
import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { PauseIcon, PlayIcon, PulseIcon } from '@/components/store/icons';
import { Wave } from '@/components/store/wave';
import { buttonVariants } from '@/components/ui/button';
import { downsamplePeaks, type TrackCard } from '@/lib/catalog';
import { cn } from '@/lib/utils';
import { Receipt } from './receipt';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function useMobile() {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia('(max-width: 900px)');
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia('(max-width: 900px)').matches,
    () => false,
  );
}

/**
 * Browse: the stage for the selected track, the results below it, the license receipt beside it. One audio element plays
 * the signed preview; the waveforms come from the track's own peaks. Slots (`rail`, `header`, `footer`, `chips`) are
 * server-rendered by the page so filters stay plain links.
 */
export function Discovery({ tracks, rail, chips, header, footer }: { tracks: TrackCard[]; rail: ReactNode; chips: ReactNode; header: ReactNode; footer: ReactNode }) {
  const mobile = useMobile();
  const audio = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const payRef = useRef<HTMLAnchorElement>(null);
  const [selId, setSelId] = useState<string | null>(tracks[0]?.id ?? null);
  const [loaded, setLoaded] = useState<string | null>(null); // the track the audio element holds
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [peaks, setPeaks] = useState<Record<string, number[]>>({});
  const [sheet, setSheet] = useState(false);
  const [miniShown, setMiniShown] = useState(false);
  const [audioError, setAudioError] = useState(false);

  const sel = useMemo(() => tracks.find((t) => t.id === selId) ?? null, [tracks, selId]);
  const duration = sel ? sel.durationMs / 1000 : 0;

  // Waveforms: fetched once per track, a few at a time; rows draw a flat line until theirs arrives.
  useEffect(() => {
    let live = true;
    (async () => {
      const queue = tracks.map((t) => t.id).filter((id) => !peaks[id]);
      for (let i = 0; i < queue.length && live; i += 6) {
        const got = await Promise.all(
          queue.slice(i, i + 6).map(async (id) => {
            try {
              const r = await fetch(`/api/tracks/${id}/waveform?n=120`);
              return r.ok ? ([id, ((await r.json()) as { peaks: number[] }).peaks] as const) : null;
            } catch {
              return null;
            }
          }),
        );
        if (live) setPeaks((p) => ({ ...p, ...Object.fromEntries(got.filter((g): g is readonly [string, number[]] => g !== null)) }));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- peaks is read to skip what is loaded, not a trigger
  }, [tracks]);

  // The clock: while playing, follow the audio element each frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (audio.current) setTime(audio.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const play = useCallback(async (id: string, at?: number) => {
    const el = audio.current;
    if (!el) return;
    setSelId(id);
    setAudioError(false);
    if (loaded !== id) {
      el.src = `/api/tracks/${id}/preview`;
      setLoaded(id);
      setTime(0);
    }
    if (at !== undefined) el.currentTime = at;
    try {
      await el.play();
    } catch {
      setPlaying(false);
      setAudioError(true);
    }
  }, [loaded]);

  const toggle = useCallback(
    (id?: string) => {
      const target = id ?? selId;
      if (!target) return;
      if (target === loaded && playing) audio.current?.pause();
      else void play(target);
    },
    [selId, loaded, playing, play],
  );

  const select = useCallback((id: string) => {
    if (id === selId) return;
    audio.current?.pause();
    setSelId(id);
    setLoaded(null);
    setTime(0);
  }, [selId]);

  const seek = useCallback(
    (id: string, seconds: number) => {
      if (id === loaded) {
        if (audio.current) audio.current.currentTime = seconds;
        setTime(seconds);
      } else void play(id, seconds);
    },
    [loaded, play],
  );

  // Keys: Space plays or pauses (not while typing), "/" jumps to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,select,textarea,button,a,[role=slider]')) return;
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [toggle]);

  // The floating mini player appears on narrow screens once the stage has scrolled away.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([en]) => setMiniShown(!en!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const license = () => {
    if (mobile) setSheet(true);
    else payRef.current?.focus();
  };
  const closeSheet = useCallback(() => setSheet(false), []);

  const isLoaded = sel?.id === loaded;
  const progress = duration && isLoaded ? Math.min(1, time / duration) : 0;
  const nowPlaying = !!sel && isLoaded && playing;
  const beat = sel?.bpm ? `${(60 / sel.bpm).toFixed(3)}s` : '0.65s';

  return (
    <div
      style={{ '--beat': beat } as React.CSSProperties}
      className="mx-auto grid max-w-[1440px] gap-x-8 gap-y-7 px-6 pt-6 pb-16 max-[900px]:flex max-[900px]:flex-col max-[900px]:gap-3.5 max-[900px]:px-4 max-[900px]:pt-3 max-[900px]:pb-[120px] min-[901px]:grid-cols-[minmax(0,1fr)_340px] min-[901px]:[grid-template-areas:'stage_receipt'_'results_receipt'] min-[1181px]:grid-cols-[220px_minmax(0,1fr)_360px] min-[1181px]:[grid-template-areas:'rail_stage_receipt'_'rail_results_receipt']"
    >
      <audio
        ref={audio}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onError={() => {
          setPlaying(false);
          setAudioError(true);
        }}
      />
      <aside aria-label="Filters" className="sticky top-[88px] flex flex-col gap-[26px] self-start [grid-area:rail] max-[1180px]:hidden">
        {rail}
      </aside>
      <div className="flex flex-col gap-3.5 min-[901px]:hidden">{chips}</div>

      {sel ? (
        <section
          ref={stageRef}
          aria-label="Selected track"
          className={cn(
            'relative overflow-hidden rounded-xl border bg-card p-6 [grid-area:stage] max-[900px]:p-4',
            '[background-image:radial-gradient(90%_120%_at_30%_120%,var(--stage-glow),transparent_60%)]',
            nowPlaying && 'is-playing',
          )}
        >
          <div className="flex flex-wrap items-end gap-5 max-[1366px]:items-start max-[1366px]:gap-y-4">
            <div className="min-w-0">
              <h2 className="text-[44px] leading-[0.98] font-bold tracking-[-0.045em] max-[1366px]:text-[40px] max-[1180px]:text-4xl max-[900px]:text-[30px] max-[900px]:tracking-[-0.04em]">
                <Link href={`/track/${sel.slug}`} className="hover:underline hover:underline-offset-4">
                  {sel.title}
                </Link>
              </h2>
              <p className="mt-2 text-[15px] text-fg-2 max-[900px]:mt-1.5 max-[900px]:text-sm">{[sel.primaryArtist, LANG[sel.language], sel.bpm ? `${sel.bpm} BPM` : null, ...sel.moods.slice(0, 2)].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex flex-none items-center gap-2 min-[901px]:ml-auto max-[1366px]:w-full max-[1366px]:[&>a:last-child]:ml-auto">
              <button
                type="button"
                aria-label={nowPlaying ? `Pause ${sel.title}` : `Play ${sel.title}`}
                aria-pressed={nowPlaying}
                onClick={() => toggle(sel.id)}
                className="grid size-14 flex-none place-items-center rounded-full bg-signal text-signal-foreground transition-transform duration-150 ease-out active:scale-[0.93]"
              >
                {nowPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
              </button>
              <Link href={`/track/${sel.slug}#similar`} className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
                <PulseIcon />
                Similar
              </Link>
              <button type="button" onClick={license} className={buttonVariants({ size: 'lg' })}>
                License
              </button>
            </div>
          </div>
          <Wave
            peaks={peaks[sel.id]}
            progress={progress}
            onSeek={(f) => seek(sel.id, f * duration)}
            slider={{ label: `Seek ${sel.title}`, valueNow: isLoaded ? time : 0, valueMax: duration, onStep: (d) => seek(sel.id, Math.min(duration, Math.max(0, (isLoaded ? time : 0) + d))) }}
            className="mt-[22px] mb-2 h-28 gap-[3px] max-[900px]:mt-3.5 max-[900px]:mb-1.5 max-[900px]:h-16 max-[900px]:gap-0.5 [&>i]:rounded-sm"
          />
          <div className="flex items-center gap-2 font-mono text-[13px] font-normal text-muted-foreground">
            <span aria-hidden className="beat-dot size-[7px] rounded-full bg-signal" />
            <span>{fmt(isLoaded ? time : 0)}</span>
            {audioError && <span role="alert" className="font-sans text-attention">The preview could not be played. Try again.</span>}
            <span className="ml-auto">{fmt(duration)}</span>
          </div>
        </section>
      ) : (
        <div className="rounded-xl border bg-card p-6 [grid-area:stage]">
          <p className="text-title">No tracks match these filters</p>
          <p className="mt-1 text-sm text-muted-foreground">Clear a filter or change the search to see more of the catalog.</p>
        </div>
      )}

      <main className="min-w-0 [grid-area:results]">
        {header}
        {tracks.length > 0 && (
          <>
            <div className="grid grid-cols-[44px_minmax(150px,1.1fr)_minmax(0,2fr)_64px_48px] gap-4 border-b px-3 pb-2 text-xs font-semibold text-muted-foreground max-[900px]:hidden">
              <span />
              <span>Track</span>
              <span>Preview</span>
              <span className="text-right">Tempo</span>
              <span className="text-right">Time</span>
            </div>
            <ol>
              {tracks.map((t) => (
                <Row
                  key={t.id}
                  track={t}
                  peaks={peaks[t.id]}
                  selected={t.id === selId}
                  playing={t.id === selId && nowPlaying}
                  progress={t.id === selId ? progress : 0}
                  mobile={mobile}
                  onSelect={select}
                  onToggle={toggle}
                  onSeek={seek}
                />
              ))}
            </ol>
          </>
        )}
        {footer}
      </main>

      <div className="[grid-area:receipt] min-[901px]:relative">
        <Receipt track={sel} open={sheet} onClose={closeSheet} mobile={mobile} payRef={payRef} />
      </div>

      {sel && (
        <div
          className={cn(
            'fixed inset-x-2 bottom-2.5 z-30 flex items-center gap-2.5 rounded-md border bg-popover p-2 shadow-[0_12px_28px_-10px_rgba(0,0,0,0.6)] transition-transform duration-300 min-[901px]:hidden',
            miniShown && !sheet ? 'translate-y-0' : 'translate-y-[140%]',
            nowPlaying && 'is-playing',
          )}
          aria-hidden={!(miniShown && !sheet)}
          inert={!(miniShown && !sheet)}
        >
          <div aria-hidden className="absolute inset-x-3 top-0 h-0.5 overflow-hidden rounded-sm bg-surface-3">
            <i className="absolute inset-y-0 left-0 bg-signal" style={{ width: `${progress * 100}%` }} />
          </div>
          <button
            type="button"
            aria-label={nowPlaying ? `Pause ${sel.title}` : `Play ${sel.title}`}
            onClick={() => toggle(sel.id)}
            className={cn('grid size-10 place-items-center rounded-full', nowPlaying ? 'bg-signal text-signal-foreground' : 'bg-secondary text-foreground')}
          >
            {nowPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className="min-w-0">
            <b className="block truncate text-sm font-semibold">{sel.title}</b>
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {fmt(isLoaded ? time : 0)} / {fmt(duration)}
            </span>
          </div>
          <button type="button" onClick={license} className={cn(buttonVariants(), 'ml-auto h-[38px]')}>
            License
          </button>
        </div>
      )}
    </div>
  );
}

const LANG: Record<TrackCard['language'], string> = { hindi: 'Hindi', punjabi: 'Punjabi', tamil: 'Tamil', english: 'English', instrumental: 'Instrumental' };

const Row = memo(function Row({
  track,
  peaks,
  selected,
  playing,
  progress,
  mobile,
  onSelect,
  onToggle,
  onSeek,
}: {
  track: TrackCard;
  peaks: number[] | undefined;
  selected: boolean;
  playing: boolean;
  progress: number;
  mobile: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onSeek: (id: string, seconds: number) => void;
}) {
  const bars = useMemo(() => (peaks ? downsamplePeaks(peaks, mobile ? 44 : 52) : undefined), [peaks, mobile]);
  const seconds = track.durationMs / 1000;
  return (
    <li
      className={cn(
        'group grid grid-cols-[44px_minmax(150px,1.1fr)_minmax(0,2fr)_64px_48px] items-center gap-4 rounded-md border-b px-3 py-2.5 transition-colors duration-150',
        'max-[900px]:grid-cols-[40px_minmax(0,1fr)_auto] max-[900px]:gap-x-3 max-[900px]:gap-y-1 max-[900px]:rounded-none max-[900px]:px-1',
        'hover:bg-card min-[901px]:data-[selected=true]:border-b-transparent min-[901px]:data-[selected=true]:bg-card',
        playing && 'is-playing',
      )}
      data-selected={selected}
    >
      <button
        type="button"
        aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`}
        onClick={() => onToggle(track.id)}
        className={cn('grid size-10 place-items-center rounded-full transition-[background-color,transform] duration-150 active:scale-[0.92]', playing ? 'bg-signal text-signal-foreground' : 'bg-secondary text-foreground hover:bg-accent')}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button type="button" onClick={() => onSelect(track.id)} aria-current={selected ? 'true' : undefined} className="min-w-0 text-left">
        <b className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{track.title}</b>
        <span className="block truncate text-[13px] font-medium text-muted-foreground">
          {track.primaryArtist} · {LANG[track.language]}
        </span>
      </button>
      <Wave
        peaks={bars}
        progress={progress}
        onSeek={(f) => onSeek(track.id, f * seconds)}
        className="h-7 max-[900px]:col-span-2 max-[900px]:col-start-2 max-[900px]:row-start-2 max-[900px]:h-5 [&:hover>i:not(.is-on)]:bg-muted-foreground/60"
      />
      <span className="text-right font-mono text-[13px] font-normal text-fg-2 max-[900px]:hidden">{track.bpm ?? '–'}</span>
      <span className="text-right font-mono text-[13px] font-normal text-fg-2 max-[900px]:col-start-3 max-[900px]:row-start-1 max-[900px]:self-start max-[900px]:pt-0.5">{fmt(seconds)}</span>
    </li>
  );
});

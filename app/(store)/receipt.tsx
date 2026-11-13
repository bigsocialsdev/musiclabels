'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { CloseIcon } from '@/components/store/icons';
import type { TrackCard } from '@/lib/catalog';
import { TIER_LABELS } from '@/lib/certificates';
import { GST_STATES, formatInr } from '@/lib/invoicing';
import type { ReceiptTier } from '@/lib/orders/server';
import { cn } from '@/lib/utils';
import { receiptAction } from './receipt-action';

const STATE_KEY = 'mrm.billingState';
const STATES = Object.entries(GST_STATES).sort((a, b) => a[1].localeCompare(b[1]));

const termsLine = (t: NonNullable<ReceiptTier['terms']>) =>
  [
    t.videoCap ? `${t.videoCap} video${t.videoCap > 1 ? 's' : ''}` : 'Any number of videos',
    `up to ${t.maxChannels} channel${t.maxChannels > 1 ? 's' : ''}`,
    t.termKind === 'perpetual' ? 'perpetual' : `${t.termMonths} months`,
  ].join(' · ');

// The remembered billing state lives in localStorage; read it as an external store so SSR and first paint agree.
let memoryState = '';
const stateListeners = new Set<() => void>();
const subscribeState = (l: () => void) => {
  stateListeners.add(l);
  return () => void stateListeners.delete(l);
};
const readState = () => {
  try {
    return localStorage.getItem(STATE_KEY) ?? memoryState;
  } catch {
    return memoryState;
  }
};

/**
 * The license receipt (DESIGN.md C): tier choice, the exact fee and GST lines for the billing state, and the total in the
 * button. Every amount comes from the server (`receiptAction`); the browser only chooses which of them to show.
 * On narrow screens it is a bottom sheet opened by the License button.
 */
export function Receipt({
  track,
  open,
  onClose,
  mobile,
  payRef,
}: {
  track: TrackCard | null;
  open: boolean;
  onClose: () => void;
  mobile: boolean;
  payRef: React.RefObject<HTMLAnchorElement | null>;
}) {
  const stateCode = useSyncExternalStore(subscribeState, readState, () => '');
  const [result, setResult] = useState<{ key: string; tiers: ReceiptTier[] } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const trackId = track?.id;
  const key = `${trackId}:${stateCode}`;
  useEffect(() => {
    if (!trackId) return;
    let live = true;
    receiptAction(trackId, stateCode || undefined).then((r) => live && setResult({ key, tiers: r ?? [] }));
    return () => {
      live = false;
    };
  }, [trackId, stateCode, key]);
  // Until the answer for this exact track and state arrives, show the loading state rather than a stale receipt.
  const tiers = result?.key === key ? result.tiers : null;

  useEffect(() => {
    if (open && mobile) closeRef.current?.focus();
  }, [open, mobile]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [open, onClose]);

  const available = tiers?.filter((t) => t.available) ?? [];
  const chosen = available.find((t) => t.tier === picked) ?? available[0] ?? null;
  const gst = chosen?.gst ?? null;

  const chooseState = (v: string) => {
    memoryState = v;
    try {
      localStorage.setItem(STATE_KEY, v);
    } catch {
      // storage can be blocked; the choice then lasts until reload
    }
    stateListeners.forEach((l) => l());
  };

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cn('fixed inset-0 z-[39] bg-black/55 transition-opacity duration-300 min-[901px]:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <section
        aria-label="License this track"
        {...(mobile && open ? { role: 'dialog', 'aria-modal': true } : {})}
        className={cn(
          'rounded-xl border bg-card p-[18px] pb-4',
          'min-[901px]:sticky min-[901px]:top-[88px] min-[901px]:self-start',
          'max-[900px]:fixed max-[900px]:inset-x-0 max-[900px]:bottom-0 max-[900px]:z-40 max-[900px]:max-h-[88vh] max-[900px]:overflow-auto max-[900px]:rounded-b-none max-[900px]:px-4 max-[900px]:pt-3 max-[900px]:pb-6 max-[900px]:transition-transform max-[900px]:duration-300',
          mobile && !open && 'max-[900px]:invisible max-[900px]:translate-y-[105%]',
        )}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-sm bg-surface-3 min-[901px]:hidden" />
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute top-2 right-2 grid size-10 place-items-center rounded-sm text-fg-2 hover:bg-secondary hover:text-foreground min-[901px]:hidden"
        >
          <CloseIcon />
        </button>
        <h2 className="pr-9 text-title">License {track ? `“${track.title}”` : ''}</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Pick how the video will be used. Prices exclude GST.</p>

        <div role="radiogroup" aria-label="License type" className="mt-3 mb-2 flex flex-col gap-1.5">
          {tiers === null && [0, 1, 2].map((i) => <div key={i} className="h-[58px] rounded-sm border bg-secondary/40" />)}
          {tiers?.map((t) => {
            const isChosen = chosen?.tier === t.tier;
            return (
              <label
                key={t.tier}
                className={cn(
                  'grid grid-cols-[16px_1fr_auto] items-start gap-2.5 rounded-sm border px-3 py-2.5 transition-colors',
                  t.available ? 'cursor-pointer hover:bg-secondary' : 'opacity-60',
                  isChosen && 'border-fg-4 bg-secondary',
                )}
              >
                <input type="radio" name="tier" value={t.tier} disabled={!t.available} checked={isChosen} onChange={() => setPicked(t.tier)} className="mt-0.5" />
                <span>
                  <b className="text-sm font-semibold">{TIER_LABELS[t.tier]}</b>
                  <small className="mt-px block text-xs text-muted-foreground">{t.available ? (t.terms ? termsLine(t.terms) : '') : 'Not offered for this track'}</small>
                </span>
                {t.available && <span className="font-mono text-[13px] font-medium">{formatInr(t.amountPaise!)}</span>}
              </label>
            );
          })}
        </div>

        {track && (
          <p className="flex items-center justify-between px-0.5 text-[13px] text-muted-foreground">
            <span>TV, OTT or cinema?</span>
            <Link href={`/enquiry/${track.slug}`} className="font-semibold text-foreground underline underline-offset-[3px]">
              Send an enquiry
            </Link>
          </p>
        )}

        <div className="mt-2.5 flex flex-col gap-1">
          <label htmlFor="billing-state" className="text-xs font-semibold text-muted-foreground">
            Billing state
          </label>
          <select
            id="billing-state"
            value={stateCode}
            onChange={(e) => chooseState(e.target.value)}
            className="h-[38px] rounded-sm border border-input bg-background px-3 text-sm outline-none focus-visible:border-fg-2"
          >
            <option value="">Choose your state</option>
            {STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {chosen && (
          <div aria-live="polite" className="mt-3 flex flex-col gap-[5px] border-t border-dashed border-input pt-2.5 text-[13px] text-fg-2">
            <Line label="License fee" paise={chosen.amountPaise!} />
            {gst?.intraState && (
              <>
                <Line label={`CGST ${gst.gstRateBps / 200}%`} paise={gst.cgstPaise} />
                <Line label={`SGST ${gst.gstRateBps / 200}%`} paise={gst.sgstPaise} />
              </>
            )}
            {gst && !gst.intraState && <Line label={`IGST ${gst.gstRateBps / 100}%`} paise={gst.igstPaise} />}
            {gst ? (
              <p className="mt-0.5 flex justify-between border-t pt-2 text-[15px] font-bold text-foreground">
                <span>Total</span>
                <span className="font-mono">{formatInr(gst.totalPaise)}</span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{stateCode ? 'GST is added at checkout.' : 'Choose your billing state to see the GST and the total.'}</p>
            )}
          </div>
        )}

        {track && chosen ? (
          <Link ref={payRef} href={`/checkout/${track.id}?tier=${chosen.tier}`} className={cn(buttonVariants({ size: 'lg' }), 'mt-3 h-[46px] w-full text-[15px]')}>
            {gst ? `License for ${formatInr(gst.totalPaise)}` : `License for ${formatInr(chosen.amountPaise!)} + GST`}
          </Link>
        ) : (
          tiers !== null && <p className="mt-3 text-sm text-muted-foreground">No license can be bought for this track right now.</p>
        )}
        <p className="mt-2.5 text-xs leading-normal text-muted-foreground">
          You get a license certificate with a public verify link and a GST invoice. If a claim appears on a registered channel, our clearance desk takes it up with the rightsholder.
        </p>
      </section>
    </>
  );
}

function Line({ label, paise }: { label: string; paise: number }) {
  return (
    <p className="flex justify-between">
      <span>{label}</span>
      <span className="font-mono">{formatInr(paise)}</span>
    </p>
  );
}

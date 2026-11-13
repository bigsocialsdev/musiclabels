'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { confirmPaymentAction, startCheckoutAction } from '../actions';

type Org = { id: string; legalName: string; buyerType: string };
type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayCtor = new (opts: Record<string, unknown>) => { open(): void };

const MESSAGES: Record<string, string> = {
  terms_not_accepted: 'Accept the current Terms of Service first.',
  rate_limited: 'Too many checkout attempts. Try again later.',
  client_name_agency_only: 'Only agency accounts can buy for a named client.',
  too_many_channels: 'Too many channels for this license.',
  platform_not_allowed: 'That platform is not covered by this license.',
  duplicate_channel: 'The same channel is listed twice.',
  payment_gateway_unavailable: 'Payments are unavailable right now. Try again in a minute.',
  checkout_expired: 'This checkout expired. Reload the page to start again.',
  invalid_signature: 'We could not confirm the payment. If money was taken, it will be matched automatically.',
  payment_failed: 'The payment failed. You were not charged.',
};
const explain = (issues: string[]) => issues.map((i) => MESSAGES[i] ?? 'This license cannot be bought right now.').join(' ');

function loadRazorpay(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(w.Razorpay!);
    s.onerror = () => reject(new Error('Could not load Razorpay Checkout'));
    document.body.appendChild(s);
  });
}

export function CheckoutForm(props: {
  trackId: string;
  trackTitle: string;
  tier: string;
  orgs: Org[];
  maxChannels: number;
  platforms: string[];
  states: [string, string][];
}) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [orgId, setOrgId] = useState(props.orgs[0]!.id);
  const [channels, setChannels] = useState([{ platform: props.platforms[0]!, handleOrUrl: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const org = props.orgs.find((o) => o.id === orgId)!;

  const submit = (form: FormData) =>
    start(async () => {
      setError(null);
      const res = await startCheckoutAction({
        orgId,
        trackId: props.trackId,
        tier: props.tier,
        licenseeName: form.get('licenseeName'),
        clientName: form.get('clientName') ?? undefined,
        channels: channels.filter((c) => c.handleOrUrl.trim()),
        billingStateCode: form.get('billingStateCode'),
        gstin: form.get('gstin'),
        idempotencyKey,
      });
      if (!res.ok) return setError(explain(res.issues));
      const { orderId, gatewayOrderId, keyId, amountPaise, status } = res.value;
      if (status !== 'awaiting_payment' || !gatewayOrderId) return router.push(`/orders/${orderId}`);
      const Razorpay = await loadRazorpay().catch((e: Error) => (setError(e.message), null));
      if (!Razorpay) return;
      new Razorpay({
        key: keyId,
        amount: amountPaise,
        currency: 'INR',
        order_id: gatewayOrderId,
        name: 'Music Rights Marketplace',
        description: props.trackTitle,
        handler: async (r: RazorpayResponse) => {
          const c = await confirmPaymentAction({ orgId, orderId, paymentId: r.razorpay_payment_id, gatewayOrderId: r.razorpay_order_id, signature: r.razorpay_signature });
          if (!c.ok) setError(explain([c.reason]));
          router.push(`/orders/${orderId}`);
        },
      }).open();
    });

  return (
    <form action={submit} className="mt-6 space-y-3">
      {props.orgs.length > 1 && (
        <label className="block">
          Buying for
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="mt-1 block w-full border p-2">
            {props.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.legalName}
              </option>
            ))}
          </select>
        </label>
      )}
      {org.buyerType === 'agency' && (
        <label className="block">
          Client name (the client becomes the licensee)
          <input name="clientName" maxLength={300} className="mt-1 block w-full border p-2" />
        </label>
      )}
      <label className="block">
        Licensee name
        <input name="licenseeName" maxLength={300} placeholder={org.legalName} className="mt-1 block w-full border p-2" />
      </label>
      <fieldset className="space-y-2">
        <legend>Channels (up to {props.maxChannels})</legend>
        {channels.map((c, i) => (
          <div key={i} className="flex gap-2">
            <select
              aria-label={`Channel ${i + 1} platform`}
              value={c.platform}
              onChange={(e) => setChannels(channels.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)))}
              className="border p-2"
            >
              {props.platforms.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <input
              aria-label={`Channel ${i + 1} handle or URL`}
              value={c.handleOrUrl}
              required={i === 0}
              maxLength={300}
              onChange={(e) => setChannels(channels.map((x, j) => (j === i ? { ...x, handleOrUrl: e.target.value } : x)))}
              className="flex-1 border p-2"
            />
          </div>
        ))}
        {channels.length < props.maxChannels && (
          <button type="button" className="text-sm underline" onClick={() => setChannels([...channels, { platform: props.platforms[0]!, handleOrUrl: '' }])}>
            Add a channel
          </button>
        )}
      </fieldset>
      <label className="block">
        Billing state
        <select name="billingStateCode" required defaultValue="" className="mt-1 block w-full border p-2">
          <option value="" disabled>
            Choose…
          </option>
          {props.states.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        GSTIN (optional, for a business invoice)
        <input name="gstin" maxLength={15} className="mt-1 block w-full border p-2 uppercase" />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required className="mt-1" /> I have read the license text and agree to it.
      </label>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <button disabled={pending} className="border px-4 py-2">
        {pending ? 'Working…' : 'Pay with Razorpay'}
      </button>
    </form>
  );
}

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LANGUAGES, PRICE_LEVELS } from '@/lib/catalog';

export type TrackDefaults = {
  title?: string;
  primaryArtist?: string;
  featuredArtists?: string[];
  composers?: string[];
  lyricists?: string[];
  genreId?: string | null;
  moodIds?: string[];
  language?: string;
  bpm?: number | null;
  explicit?: boolean;
  aiGeneratedDeclared?: boolean;
  organicSocial?: boolean;
  paidAds?: boolean;
  editsAllowed?: boolean;
  proposedPriceLevel?: string | null;
};

const selectClass = 'h-9 w-full rounded-md border bg-transparent px-3 text-sm';

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1" />
      <span>{label}</span>
    </label>
  );
}

/** Track details: used to create a track and to edit a draft. The catalog's zod schema validates. */
export function TrackForm({
  action,
  taxonomy,
  defaults = {},
  trackId,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  taxonomy: { genres: { id: string; name: string }[]; moods: { id: string; name: string }[] };
  defaults?: TrackDefaults;
  trackId?: string;
  submitLabel: string;
}) {
  const d = defaults;
  return (
    <form action={action} className="space-y-4">
      {trackId && <input type="hidden" name="trackId" value={trackId} />}
      <Field id="title" label="Title" required maxLength={200} defaultValue={d.title ?? ''} />
      <Field id="primaryArtist" label="Primary artist" required maxLength={200} defaultValue={d.primaryArtist ?? ''} />
      <Field id="featuredArtists" label="Featured artists (comma separated)" defaultValue={(d.featuredArtists ?? []).join(', ')} />
      <Field id="composers" label="Composers (comma separated)" defaultValue={(d.composers ?? []).join(', ')} />
      <Field id="lyricists" label="Lyricists (comma separated)" defaultValue={(d.lyricists ?? []).join(', ')} />
      <div className="grid gap-1.5">
        <Label htmlFor="language">Language</Label>
        <select id="language" name="language" defaultValue={d.language ?? 'hindi'} className={selectClass}>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l[0]!.toUpperCase() + l.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="genreId">Genre</Label>
        <select id="genreId" name="genreId" defaultValue={d.genreId ?? ''} className={selectClass}>
          <option value="">Not set</option>
          {taxonomy.genres.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      {taxonomy.moods.length > 0 && (
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">Moods (up to 5)</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {taxonomy.moods.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="moodIds" value={m.id} defaultChecked={d.moodIds?.includes(m.id)} />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Field id="bpm" label="BPM (optional)" type="number" min={30} max={300} defaultValue={d.bpm ?? ''} />
      <div className="grid gap-1.5">
        <Label htmlFor="proposedPriceLevel">Price level you suggest (our team sets the final one)</Label>
        <select id="proposedPriceLevel" name="proposedPriceLevel" defaultValue={d.proposedPriceLevel ?? ''} className={selectClass}>
          <option value="">No suggestion</option>
          {PRICE_LEVELS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">About the track</legend>
        <Check name="explicit" label="Contains explicit lyrics" defaultChecked={d.explicit ?? false} />
        <Check name="aiGeneratedDeclared" label="Made with AI tools" defaultChecked={d.aiGeneratedDeclared ?? false} />
        <Check name="organicSocial" label="Buyers may use it in organic social posts" defaultChecked={d.organicSocial ?? true} />
        <Check name="paidAds" label="Buyers may use it in paid ads" defaultChecked={d.paidAds ?? false} />
        <Check name="editsAllowed" label="Buyers may edit or remix it" defaultChecked={d.editsAllowed ?? false} />
      </fieldset>
      <Button type="submit">{submitLabel}</Button>
    </form>
  );
}

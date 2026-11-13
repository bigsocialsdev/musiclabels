import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Shared by the seller forms. */
export const selectClass = 'h-9 w-full rounded-md border bg-transparent px-3 text-sm';

export function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  );
}

export function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1" />
      <span>{label}</span>
    </label>
  );
}

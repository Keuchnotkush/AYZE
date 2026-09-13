import { ROLES, type RoleId } from "@/lib/roles";
import { cn } from "@/lib/cn";

type RoleSelectorProps = {
  value: RoleId | null;
  onChange: (value: RoleId) => void;
  className?: string;
  /** Restrict the choices shown (defaults to all four roles). */
  roles?: readonly RoleId[];
};

/** Picks one of the AYZE roles (all four by default). Selected role is outlined in olympic blue. */
export function RoleSelector({ value, onChange, className, roles }: RoleSelectorProps) {
  const options = roles ? ROLES.filter((role) => roles.includes(role.id)) : ROLES;
  return (
    <fieldset className={cn("flex flex-col gap-1.5", className)}>
      <legend className="mb-1.5 text-sm font-medium">I am a</legend>
      <div className="grid grid-cols-2 gap-2.5">
        {options.map((role) => {
          const selected = role.id === value;
          return (
            <label
              key={role.id}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-control border px-3.5 py-3 transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-olympic",
                selected
                  ? "border-olympic bg-olympic/15"
                  : "border-ink/25 hover:border-ink/50",
              )}
            >
              <input
                type="radio"
                name="role"
                value={role.id}
                checked={selected}
                onChange={() => onChange(role.id)}
                className="sr-only"
              />
              <span className="text-sm font-semibold">{role.label}</span>
              <span className="text-xs text-ink/60">{role.hint}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

import { useEffect, useRef, useState } from "react";
import { destinationFromInput } from "@/lib/relay/paths";

export function AddressBar({
  initial,
  onSubmit,
  submitLabel,
  autoFocus = false,
}: {
  initial?: string;
  onSubmit: (url: string) => void;
  submitLabel: string;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused.current && initial != null) setValue(initial);
  }, [initial]);

  return (
    <form
      className="rounded-lg bg-bg-elev p-2"
      onSubmit={(event) => {
        event.preventDefault();
        const raw = inputRef.current?.value ?? value;
        const destination = destinationFromInput(raw);
        if (!destination) {
          setError("Enter a search or a web address.");
          return;
        }
        setError(null);
        onSubmit(destination);
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="northline-address">
          Search or address
        </label>
        <input
          id="northline-address"
          ref={inputRef}
          name="q"
          value={value}
          autoFocus={autoFocus}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Search or paste an address"
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-3 text-fg outline-none placeholder:text-subtle"
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
          }}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
        />
        <button
          type="submit"
          className="press h-11 rounded-md bg-accent px-5 font-medium text-accent-fg"
        >
          {submitLabel}
        </button>
      </div>
      {error ? <p className="px-1 pt-2 text-sm text-muted">{error}</p> : null}
    </form>
  );
}

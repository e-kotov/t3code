import { useGT } from "gt-react";
import { SearchIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";

export function ScheduledTaskSearchField({
  query,
  onChange,
}: {
  readonly query: string;
  readonly onChange: (query: string) => void;
}) {
  const gt = useGT();
  const input = useRef<HTMLInputElement>(null);
  const label = gt("Search scheduled tasks");

  return (
    <div className="mb-2.5 px-3 sm:px-4">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon aria-hidden className="size-3.5" />
        </InputGroupAddon>
        <InputGroupInput
          ref={input}
          type="search"
          value={query}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !query) return;
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          }}
          placeholder={label}
          aria-label={label}
        />
        {query ? (
          <InputGroupAddon align="inline-end">
            <Button
              type="button"
              variant="ghost-muted"
              size="icon-xs"
              aria-label={gt("Clear search")}
              onClick={() => {
                onChange("");
                input.current?.focus();
              }}
            >
              <XIcon />
            </Button>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}

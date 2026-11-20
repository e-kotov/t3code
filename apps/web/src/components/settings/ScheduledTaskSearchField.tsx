import { useGT } from "gt-react";
import { SearchIcon, XIcon } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Switch } from "../ui/switch";

export function ScheduledTaskSearchField({
  query,
  onChange,
  includePrompts,
  onIncludePromptsChange,
}: {
  readonly query: string;
  readonly onChange: (query: string) => void;
  readonly includePrompts: boolean;
  readonly onIncludePromptsChange: (includePrompts: boolean) => void;
}) {
  const gt = useGT();
  const input = useRef<HTMLInputElement>(null);
  const promptLabelId = useId();
  const label = gt("Search scheduled tasks");

  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2 px-3 sm:px-4">
      <div className="min-w-0 flex-1 basis-48">
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
      <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs">
        <Switch
          size="sm"
          checked={includePrompts}
          onCheckedChange={onIncludePromptsChange}
          aria-labelledby={promptLabelId}
        />
        <span id={promptLabelId}>{gt("Search prompts too")}</span>
      </div>
    </div>
  );
}

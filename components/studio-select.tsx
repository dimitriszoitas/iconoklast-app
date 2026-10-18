"use client";

import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Select } from "radix-ui";
import "./studio-select.css";

export type StudioSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type StudioSelectProps = {
  id?: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly StudioSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
};

/** Shared field and menu styling, with Radix handling selection and focus. */
export function StudioSelect({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className = "",
  size = "md",
}: StudioSelectProps) {
  return (
    <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger
        id={id}
        type="button"
        aria-label={label}
        className={`studio-select-trigger ${className}`.trim()}
        data-size={size}
        onKeyDown={(event) => {
          // Leave Tab available to the surrounding dialog's focus trap.
          // All other keys belong to this field, not canvas editing shortcuts.
          if (event.key !== "Tab") event.stopPropagation();
        }}
      >
        <Select.Value className="studio-select-value" placeholder={placeholder} />
        <Select.Icon className="studio-select-chevron" asChild>
          <ChevronDown size={16} aria-hidden="true" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="studio-select-content"
          position="popper"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Select.ScrollUpButton className="studio-select-scroll">
            <ChevronUp size={16} aria-hidden="true" />
          </Select.ScrollUpButton>
          <Select.Viewport className="studio-select-viewport">
            {options.map((option) => (
              <Select.Item
                className="studio-select-option"
                key={option.value}
                value={option.value}
                textValue={option.label}
                disabled={option.disabled}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="studio-select-check">
                  <Check size={16} aria-hidden="true" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="studio-select-scroll">
            <ChevronDown size={16} aria-hidden="true" />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export default StudioSelect;

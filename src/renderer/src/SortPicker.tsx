import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import type { SortKey } from "../../shared/types";

export interface SortPickerOption {
  value: SortKey;
  label: string;
}

export interface SortPickerProps {
  value: SortKey;
  options: readonly SortPickerOption[];
  onChange: (value: SortKey) => void;
}

const optionHeight = 32;

export function SortPicker({ value, options, onChange }: SortPickerProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  const [position, setPosition] = useState({ left: 0, top: 0, width: 140 });
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const optionId = (index: number) => `${id}-option-${index}`;

  const close = (focus = true) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  };

  const openPicker = () => {
    setActive(selectedIndex);
    setOpen(true);
  };

  const choose = (next: SortKey) => {
    onChange(next);
    close();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(
        Math.max(130, trigger.width),
        180,
        window.innerWidth - 24,
      );
      const popupHeight = Math.min(
        options.length * optionHeight + 12,
        window.innerHeight - 24,
      );
      const below = window.innerHeight - trigger.bottom - 12;
      const above = trigger.top - 12;
      const flip = below < popupHeight && above > below;
      setPosition({
        width,
        left: Math.max(
          12,
          Math.min(trigger.left, window.innerWidth - width - 12),
        ),
        top: flip
          ? Math.max(12, trigger.top - popupHeight - 6)
          : Math.min(trigger.bottom + 6, window.innerHeight - popupHeight - 12),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !popupRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      )
        close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) =>
          Math.max(0, Math.min(options.length - 1, current + direction)),
        );
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        setActive(event.key === "Home" ? 0 : Math.max(0, options.length - 1));
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const option = options[active] ?? options[selectedIndex];
        if (option) choose(option.value);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [active, open, options, selectedIndex]);

  return (
    <div className="sort-picker">
      <button
        ref={triggerRef}
        type="button"
        className="sort-picker-trigger"
        aria-label="Sort songs"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id + "-listbox" : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        title={options[selectedIndex]?.label}
        onClick={() => (open ? close() : openPicker())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openPicker();
          }
        }}
      >
        <span className="sort-picker-value">
          {options[selectedIndex]?.label ?? value}
        </span>
        <ChevronDown
          className={open ? "is-open" : ""}
          size={12}
          aria-hidden="true"
        />
      </button>
      {open &&
        createPortal(
          <div
            ref={popupRef}
            id={id + "-listbox"}
            className="sort-picker-popup"
            role="listbox"
            aria-label="Sort songs"
            style={position}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={option.value === value}
                className={
                  "sort-picker-option " + (active === index ? "is-active" : "")
                }
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                {option.value === value && (
                  <Check size={13} aria-hidden="true" />
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

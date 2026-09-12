import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { LibraryFacet } from "../../shared/types";

const rowHeight = 32;
const viewportRows = 8;
const overscan = 3;

export interface FacetPickerProps {
  label: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  items: LibraryFacet[];
  icon?: ReactNode;
}

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase();

export function FacetPicker({
  label,
  allLabel,
  value,
  onChange,
  items,
  icon,
}: FacetPickerProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(256);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 280 });

  const searchable = useMemo(
    () => items.map((item) => ({ item, search: normalize(item.name) })),
    [items],
  );
  const filtered = useMemo(() => {
    const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
    return searchable
      .filter((item) => terms.every((term) => item.search.includes(term)))
      .map((item) => item.item);
  }, [search, searchable]);
  const selected = items.find((item) => item.name === value);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(
    filtered.length,
    Math.ceil((scrollTop + height) / rowHeight) + overscan,
  );
  const optionId = (index: number) => id + "-option-" + index;

  const close = (focus = true) => {
    setOpen(false);
    if (focus) triggerRef.current?.focus();
  };
  const choose = (next: string) => {
    onChange(next);
    close();
  };
  const openPicker = () => {
    setSearch("");
    setActive(value ? items.findIndex((item) => item.name === value) : -1);
    setScrollTop(0);
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(
        Math.max(250, trigger.width),
        340,
        window.innerWidth - 24,
      );
      const wanted = Math.min(viewportRows, Math.max(1, filtered.length)) * rowHeight;
      const below = window.innerHeight - trigger.bottom - 16;
      const above = trigger.top - 16;
      const flip = below < wanted + 116 && above > below;
      const viewportHeight = Math.max(
        rowHeight,
        Math.min(wanted, (flip ? above : below) - 116),
      );
      setHeight(viewportHeight);
      setPosition({
        width,
        left: Math.max(
          12,
          Math.min(trigger.left, window.innerWidth - width - 12),
        ),
        top: flip
          ? Math.max(12, trigger.top - viewportHeight - 116 - 6)
          : trigger.bottom + 6,
      });
    };
    update();
    const onScroll = (event: Event) => {
      if (!popupRef.current?.contains(event.target as Node)) update();
    };
    window.addEventListener("resize", update);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [filtered.length, open]);

  useLayoutEffect(() => {
    if (open) searchRef.current?.focus({ preventScroll: true });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !viewportRef.current || active < 0) return;
    const viewport = viewportRef.current;
    const nextTop =
      active * rowHeight < viewport.scrollTop
        ? active * rowHeight
        : (active + 1) * rowHeight > viewport.scrollTop + height
          ? (active + 1) * rowHeight - height
          : viewport.scrollTop;
    if (nextTop !== viewport.scrollTop) viewport.scrollTop = nextTop;
    setScrollTop(viewport.scrollTop);
  }, [active, height, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popupRef.current?.contains(target) && !triggerRef.current?.contains(target))
        close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="facet-picker">
      <button
        ref={triggerRef}
        type="button"
        className={"facet-picker-trigger " + (value ? "has-value" : "")}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id + "-listbox" : undefined}
        title={value || allLabel}
        onClick={() => (open ? close() : openPicker())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openPicker();
          }
        }}
      >
        {icon && (
          <span className="facet-picker-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="facet-picker-value">{value || allLabel}</span>
        {selected && (
          <span className="facet-picker-count">
            {selected.count.toLocaleString()}
          </span>
        )}
        <ChevronDown className={open ? "is-open" : ""} size={12} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div ref={popupRef} className="facet-picker-popup" style={position}>
            <div className="facet-picker-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={searchRef}
                role="combobox"
                aria-label={"Search " + label.toLowerCase()}
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={id + "-listbox"}
                aria-activedescendant={optionId(active)}
                placeholder={"Search " + allLabel.toLowerCase().replace(/^all /, "") + "…"}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setActive(-1);
                  setScrollTop(0);
                  if (viewportRef.current) viewportRef.current.scrollTop = 0;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    choose(active < 0 ? "" : filtered[active]?.name || "");
                  } else if (
                    ["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const amount = event.key.startsWith("Page")
                      ? Math.max(1, Math.floor(height / rowHeight))
                      : 1;
                    const direction = event.key.endsWith("Down") ? 1 : -1;
                    setActive((current) =>
                      Math.max(
                        -1,
                        Math.min(filtered.length - 1, current + amount * direction),
                      ),
                    );
                  }
                }}
              />
              {search && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Clear filter search"
                  onClick={() => {
                    setSearch("");
                    setActive(-1);
                    searchRef.current?.focus();
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div id={id + "-listbox"} role="listbox" aria-label={label}>
              <div
                id={optionId(-1)}
                role="option"
                aria-selected={!value}
                className={
                  "facet-picker-option facet-picker-all " +
                  (active === -1 ? "is-active" : "")
                }
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(-1)}
                onClick={() => choose("")}
              >
                <span>{allLabel}</span>
                {!value && <Check size={13} aria-hidden="true" />}
              </div>
              <div
                ref={viewportRef}
                className="facet-picker-viewport"
                style={{ height }}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              >
                {filtered.length ? (
                  <div
                    className="facet-picker-spacer"
                    style={{ height: filtered.length * rowHeight }}
                  >
                    {filtered.slice(first, last).map((item, offset) => {
                      const index = first + offset;
                      return (
                        <div
                          key={item.name}
                          id={optionId(index)}
                          role="option"
                          aria-selected={item.name === value}
                          aria-posinset={index + 2}
                          aria-setsize={filtered.length + 1}
                          className={
                            "facet-picker-option " +
                            (active === index ? "is-active" : "")
                          }
                          style={{
                            position: "absolute",
                            top: index * rowHeight,
                            left: 0,
                            right: 0,
                            height: rowHeight,
                          }}
                          title={item.name}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseMove={() => setActive(index)}
                          onClick={() => choose(item.name)}
                        >
                          <span>{item.name}</span>
                          <small>{item.count.toLocaleString()}</small>
                          {item.name === value && (
                            <Check size={13} aria-hidden="true" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="facet-picker-empty">No matching filters</div>
                )}
              </div>
            </div>
            <div className="facet-picker-footer">
              <span>
                {filtered.length.toLocaleString()}{" "}
                {search ? "matches" : "available"}
              </span>
              <span>↑ ↓ · Enter to select</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

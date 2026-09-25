import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  FileAudio,
  FileImage,
  FileVideo,
  Hash,
  Link2,
  ListPlus,
  Text,
} from "lucide-react";
import type {
  Song,
  SongContextMenuAction,
  SongContextMenuInfo,
} from "../../shared/types";

export type SongMenuAction = SongContextMenuAction | "add-to-queue";

interface SongContextMenuProps {
  song: Song;
  x: number;
  y: number;
  info: SongContextMenuInfo;
  onAction: (action: SongMenuAction) => void;
  onClose: () => void;
}

type MenuItemProps = {
  label: string;
  action: SongMenuAction;
  disabled?: boolean;
  icon?: ReactNode;
  onAction: (action: SongMenuAction) => void;
};

function MenuItem({
  label,
  action,
  disabled = false,
  icon,
  onAction,
}: MenuItemProps) {
  return (
    <button
      type="button"
      className="control-option song-context-item"
      role="menuitem"
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? "Unavailable" : undefined}
      onClick={() => onAction(action)}
    >
      <span className="song-context-item-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="control-option-label">{label}</span>
    </button>
  );
}

export function SongContextMenu({
  song,
  x,
  y,
  info,
  onAction,
  onClose,
}: SongContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<"copy" | "open" | null>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    firstButtonRef.current?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    const closeOnScroll = () => onClose();
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnKey);
    document.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnKey);
      document.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
    };
  }, [onClose]);

  const openLeft = position.x > window.innerWidth - 460;
  const openUp = position.y > window.innerHeight - 430;
  const submenuClass =
    "control-popover song-context-submenu" +
    (openLeft ? " opens-left" : "") +
    (openUp ? " opens-up" : "");

  const onParentKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    submenu: "copy" | "open",
  ) => {
    if (
      event.key === "ArrowRight" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      setOpenSubmenu(submenu);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="song-context-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onClose();
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={menuRef}
        className="control-popover song-context-menu"
        role="menu"
        aria-label={`Actions for ${song.title}`}
        style={{ left: position.x, top: position.y }}
      >
        <button
          ref={firstButtonRef}
          type="button"
          className="control-option song-context-item"
          role="menuitem"
          onClick={() => onAction("add-to-queue")}
          onPointerEnter={() => setOpenSubmenu(null)}
        >
          <span className="song-context-item-icon" aria-hidden="true">
            <ListPlus size={15} />
          </span>
          <span className="control-option-label">Add to queue</span>
        </button>
        <div className="song-context-separator" />
        <div className="song-context-menu-group">
          <button
            type="button"
            className="control-option song-context-item song-context-parent"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openSubmenu === "copy"}
            onClick={() => setOpenSubmenu("copy")}
            onKeyDown={(event) => onParentKeyDown(event, "copy")}
            onPointerEnter={() => setOpenSubmenu("copy")}
          >
            <span className="song-context-item-icon" aria-hidden="true">
              <Copy size={15} />
            </span>
            <span className="control-option-label">Copy</span>
            <ChevronRight className="song-context-chevron" size={14} />
          </button>
          {openSubmenu === "copy" && (
            <div className={submenuClass} role="menu">
              <MenuItem
                label="Title"
                action="copy-title"
                icon={<Text size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Title Unicode"
                action="copy-title-unicode"
                disabled={!song.titleUnicode}
                icon={<Text size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Artist"
                action="copy-artist"
                icon={<Text size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Artist Unicode"
                action="copy-artist-unicode"
                disabled={!song.artistUnicode}
                icon={<Text size={14} />}
                onAction={onAction}
              />
              <div className="song-context-separator" />
              <MenuItem
                label="Audio"
                action="copy-audio"
                disabled={!info.audio}
                icon={<FileAudio size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Audio path"
                action="copy-audio-path"
                disabled={!info.audio}
                icon={<Link2 size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Background"
                action="copy-background"
                disabled={!info.background}
                icon={<FileImage size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Background path"
                action="copy-background-path"
                disabled={!info.background}
                icon={<Link2 size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Video"
                action="copy-video"
                disabled={!info.video}
                icon={<FileVideo size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Video path"
                action="copy-video-path"
                disabled={!info.video}
                icon={<Link2 size={14} />}
                onAction={onAction}
              />
              <div className="song-context-separator" />
              <MenuItem
                label="Online Id"
                action="copy-online-id"
                disabled={!info.listing}
                icon={<Hash size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="MD5 Hash"
                action="copy-md5"
                disabled={!song.md5Hash}
                icon={<Hash size={14} />}
                onAction={onAction}
              />
            </div>
          )}
        </div>
        <div className="song-context-menu-group">
          <button
            type="button"
            className="control-option song-context-item song-context-parent"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openSubmenu === "open"}
            onClick={() => setOpenSubmenu("open")}
            onKeyDown={(event) => onParentKeyDown(event, "open")}
            onPointerEnter={() => setOpenSubmenu("open")}
          >
            <span className="song-context-item-icon" aria-hidden="true">
              <ExternalLink size={15} />
            </span>
            <span className="control-option-label">Open</span>
            <ChevronRight className="song-context-chevron" size={14} />
          </button>
          {openSubmenu === "open" && (
            <div className={submenuClass} role="menu">
              <MenuItem
                label="Listing"
                action="open-listing"
                disabled={!info.listing}
                icon={<ExternalLink size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Audio"
                action="open-audio"
                disabled={!info.audio}
                icon={<FileAudio size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Background"
                action="open-background"
                disabled={!info.background}
                icon={<FileImage size={14} />}
                onAction={onAction}
              />
              <MenuItem
                label="Video"
                action="open-video"
                disabled={!info.video}
                icon={<FileVideo size={14} />}
                onAction={onAction}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

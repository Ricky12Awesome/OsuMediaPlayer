import { useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";

interface PreferenceTransferControlsProps<T> {
  name: string;
  filename: string;
  exportData: () => string;
  parseImport: (text: string) => T;
  onImport: (value: T) => void;
}

export function PreferenceTransferControls<T>({
  name,
  filename,
  exportData,
  parseImport,
  onImport,
}: PreferenceTransferControlsProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");

  const exportFile = () => {
    const url = URL.createObjectURL(
      new Blob([exportData()], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice(`${name} exported.`);
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("The file is too large to import.");
      }
      const imported = parseImport(await file.text());
      onImport(imported);
      setNotice(`${name} imported.`);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : `Could not import ${name}.`,
      );
    }
  };

  return (
    <>
      <div className="settings-actions">
        <button type="button" className="secondary-button" onClick={exportFile}>
          <Download size={15} /> Export
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={15} /> Import
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          aria-label={`Import ${name.toLowerCase()} file`}
          hidden
          onChange={(event) => void importFile(event)}
        />
      </div>
      {notice && (
        <p className="settings-hint" role="status">
          {notice}
        </p>
      )}
    </>
  );
}

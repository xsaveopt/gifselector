import { useState } from "react";
import Modal from "./Modal";

type ImportResultSummary = {
  successes: number;
  failures: number;
};

type ImportDialogProps = {
  onClose: () => void;
  onImport: (urls: string[]) => Promise<ImportResultSummary>;
};

const SUGGESTED_SOURCES = ["tenor.com", "giphy.com", "klipy.com", "imgur.com", "discord.com"];

export default function ImportDialog({ onClose, onImport }: ImportDialogProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleRun = async () => {
    const urls = text
      .split(/[\n\r]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (urls.length === 0) {
      return;
    }
    setBusy(true);
    setStatus("Importing…");
    try {
      const { successes, failures } = await onImport(urls);
      if (failures > 0) {
        setStatus(`Imported ${successes}, skipped ${failures}.`);
      } else {
        setStatus(`Imported ${successes} item${successes === 1 ? "" : "s"}.`);
      }
      if (successes > 0) {
        setText("");
      }
    } catch {
      setStatus("Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import from URLs" onClose={onClose}>
      <p className="dim modal-intro">
        Paste one link per line from {SUGGESTED_SOURCES.join(", ")} and other allowed sources.
      </p>
      <textarea
        className="import-area"
        rows={6}
        placeholder={`https://tenor.com/view/...\nhttps://giphy.com/gifs/...`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
        aria-label="Import URLs"
      />
      {status ? <p className="import-status">{status}</p> : null}
      <div className="modal-foot">
        <button type="button" className="btn btn-subtle" onClick={onClose} disabled={busy}>
          Close
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleRun}
          disabled={busy || text.trim().length === 0}
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </Modal>
  );
}

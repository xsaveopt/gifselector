import type { Toast } from "../types";
import { CheckIcon, CloseIcon } from "./Icons";

type ToasterProps = {
  toasts: Toast[];
  onDismiss: (id: number) => void;
};

export default function Toaster({ toasts, onDismiss }: ToasterProps) {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role="status">
          <span className="toast-icon">
            <CheckIcon width={15} height={15} />
          </span>
          <span className="toast-msg">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
          >
            <CloseIcon width={14} height={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

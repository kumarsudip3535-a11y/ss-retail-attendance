interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** A simple confirm/cancel modal for destructive or important actions. */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-lg p-6">
        <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">{message}</p>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium py-2.5 hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-lg text-white text-sm font-semibold py-2.5 ${
              danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-brand-600 hover:bg-brand-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

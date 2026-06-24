import { ConfirmDialog } from "./ConfirmDialog";
import { useConfirm } from "../store/confirm";

/**
 * App-root host for the global `confirmModal()` dialog (mounted once, like the Toaster). Replaces
 * native window.confirm with a real modal: a backdrop overlay that blocks the rest of the UI, OK /
 * Cancel buttons, and a ✕ close. Backdrop click does NOT dismiss unless the request opts in.
 */
export function ConfirmHost() {
  const current = useConfirm((s) => s.current);
  const answer = useConfirm((s) => s.answer);
  if (!current) return null;
  return (
    <ConfirmDialog
      key={current.id}
      title={current.title}
      body={current.body}
      confirmLabel={current.confirmLabel}
      cancelLabel={current.cancelLabel}
      danger={current.danger ?? true}
      dismissable={current.dismissable ?? false}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  );
}

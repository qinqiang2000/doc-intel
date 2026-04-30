/**
 * Lightweight toast notification system.
 * Uses a simple pub/sub pattern — no external deps.
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration?: number
  action?: ToastAction
  /** Called when the toast is removed without the action having been invoked. */
  onTimeout?: () => void
}

type ToastListener = (toast: Toast) => void
type DismissListener = (id: string) => void

const listeners: ToastListener[] = []
const dismissListeners: DismissListener[] = []

let counter = 0

interface ShowOpts {
  duration?: number
  action?: ToastAction
  onTimeout?: () => void
}

function show(
  message: string,
  type: ToastType = 'info',
  opts: ShowOpts = {},
): string {
  const id = `toast-${++counter}`
  const toast: Toast = {
    id,
    type,
    message,
    duration: opts.duration ?? 3500,
    action: opts.action,
    onTimeout: opts.onTimeout,
  }
  listeners.forEach((fn) => fn(toast))
  return id
}

function dismiss(id: string) {
  dismissListeners.forEach((fn) => fn(id))
}

export const toast = {
  success: (msg: string, duration?: number) =>
    show(msg, 'success', { duration }),
  error: (msg: string, duration?: number) =>
    show(msg, 'error', { duration: duration ?? 5000 }),
  info: (msg: string, duration?: number) => show(msg, 'info', { duration }),
  warning: (msg: string, duration?: number) =>
    show(msg, 'warning', { duration }),
  /**
   * Toast with an action button (e.g. Undo). `onTimeout` runs only when the
   * toast goes away without the user pressing the action.
   */
  withAction: (
    msg: string,
    type: ToastType,
    action: ToastAction,
    opts: { duration?: number; onTimeout?: () => void } = {},
  ) => show(msg, type, { ...opts, action }),
  dismiss,
}

export function onToast(fn: ToastListener) {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export function onDismiss(fn: DismissListener) {
  dismissListeners.push(fn)
  return () => {
    const i = dismissListeners.indexOf(fn)
    if (i !== -1) dismissListeners.splice(i, 1)
  }
}

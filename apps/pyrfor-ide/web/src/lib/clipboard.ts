import { isTauriRuntime } from '../components/SettingsModal';

function isMonacoFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  return Boolean(active.closest('.monaco-wrapper'));
}

function getEditableTarget(): HTMLElement | null {
  const active = document.activeElement;
  if (!active || !(active instanceof HTMLElement)) return null;
  if (active.closest('.monaco-wrapper')) return null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    return active;
  }
  if (active.isContentEditable) return active;
  const editable = active.closest('[contenteditable="true"]');
  return editable instanceof HTMLElement ? editable : null;
}

async function readClipboardText(): Promise<string> {
  if (isTauriRuntime()) {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
    return readText();
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  return '';
}

async function writeClipboardText(text: string): Promise<void> {
  if (isTauriRuntime()) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

function insertTextAtCaret(target: HTMLElement, text: string): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    target.setRangeText(text, start, end, 'end');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function copyToClipboard(text: string): Promise<void> {
  await writeClipboardText(text);
}

export function installClipboardBridge(): () => void {
  const onCopy = (event: ClipboardEvent) => {
    if (isMonacoFocused()) return;
    const selection = window.getSelection()?.toString();
    if (!selection) return;
    const target = getEditableTarget();
    if (!target && !selection.trim()) return;
    event.preventDefault();
    void writeClipboardText(selection);
  };

  const onCut = (event: ClipboardEvent) => {
    if (isMonacoFocused()) return;
    const target = getEditableTarget();
    if (!target) return;
    const selection = window.getSelection()?.toString();
    if (!selection) return;
    event.preventDefault();
    void writeClipboardText(selection).then(() => {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? 0;
        const end = target.selectionEnd ?? 0;
        target.setRangeText('', start, end, 'end');
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      sel.getRangeAt(0).deleteContents();
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };

  const onPaste = (event: ClipboardEvent) => {
    if (isMonacoFocused()) return;
    const target = getEditableTarget();
    if (!target) return;
    event.preventDefault();
    void readClipboardText().then((text) => {
      if (!text) return;
      insertTextAtCaret(target, text);
    });
  };

  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);

  return () => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
  };
}

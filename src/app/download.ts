/** 浏览器下载小工具。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(content: string, filename: string): void {
  downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename);
}

export function downloadBinary(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  downloadBlob(new Blob([copy], { type: 'application/octet-stream' }), filename);
}

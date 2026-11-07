/** Hands a blob to the browser as a download. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The click has started the download; the URL can go once the browser has taken it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A CSV as a blob. The byte order mark makes Excel read it as UTF-8 rather than the local code page. */
export function csvBlob(csv: string): Blob {
  return new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
}

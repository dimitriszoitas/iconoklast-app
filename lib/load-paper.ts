import type paper from 'paper';

let pending: Promise<typeof paper> | undefined;

/** Paper's browser build exposes remove(), omitted from its bundled typings. */
export function disposePaperScope(scope: paper.PaperScope) {
  (scope as paper.PaperScope & { remove(): void }).remove();
}

/** Load Paper's browser build only when the editor opens. Workers never evaluate it. */
export function loadPaper(): Promise<typeof paper> {
  const browserWindow = window as unknown as { paper?: typeof paper };
  if (browserWindow.paper) return Promise.resolve(browserWindow.paper);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/paper-core-0.12.18.min.js';
    script.async = true;
    const timeout = setTimeout(() => { script.remove(); pending = undefined; reject(new Error('Vector editor loading timed out.')); }, 15000);
    script.onload = () => {
      clearTimeout(timeout);
      if (browserWindow.paper) resolve(browserWindow.paper);
      else { pending = undefined; reject(new Error('Vector library is unavailable.')); }
    };
    script.onerror = () => { clearTimeout(timeout); script.remove(); pending = undefined; reject(new Error('Could not load the vector library.')); };
    document.head.appendChild(script);
  });
  return pending;
}

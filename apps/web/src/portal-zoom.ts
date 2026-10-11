// Viewers own their zoom gestures; portal gestures must not scale the page.
export function preventPortalPinch(root: Document = document) {
  const inViewer = (event: Event) => event.composedPath().some(
    node => node instanceof Element && node.matches('[data-portal-zoom="viewer"]'),
  );
  const prevent = (event: Event) => {
    if (!inViewer(event) && event.cancelable) event.preventDefault();
  };
  const wheel = (event: WheelEvent) => {
    // Browsers expose trackpad pinch as a Ctrl+wheel event.
    if (event.ctrlKey) prevent(event);
  };
  const touch = (event: TouchEvent) => {
    if (event.touches.length > 1) prevent(event);
  };
  root.addEventListener('wheel', wheel, {passive:false});
  root.addEventListener('touchstart', touch, {passive:false});
  root.addEventListener('touchmove', touch, {passive:false});
  root.addEventListener('gesturestart', prevent, {passive:false});
  root.addEventListener('gesturechange', prevent, {passive:false});
  return () => {
    root.removeEventListener('wheel', wheel);
    root.removeEventListener('touchstart', touch);
    root.removeEventListener('touchmove', touch);
    root.removeEventListener('gesturestart', prevent);
    root.removeEventListener('gesturechange', prevent);
  };
}

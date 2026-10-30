import { useEffect } from 'react';

export function useUnsavedTranscriptWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    let approved = false;
    const ask = () =>
      approved ||
      (approved = window.confirm(
        'You have unsaved transcript edits. Leave this page and discard them?',
      ));
    const unload = (event: BeforeUnloadEvent) => {
      if (!approved) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest('a[href]')
          : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.download ||
        (link.target && link.target !== '_self')
      )
        return;
      const url = new URL(link.href);
      if (
        url.origin === location.origin &&
        url.pathname === location.pathname &&
        url.search === location.search
      )
        return;
      if (!ask()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Modern browsers can also warn for cancelable same-document traversals.
    // Native unload warnings cover full-document departures; browser policy
    // determines which traversals can be canceled.
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation;
    const navigate = (event: Event) => {
      if (
        event.cancelable &&
        !(event as Event & { hashChange?: boolean }).hashChange &&
        !ask()
      )
        event.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    navigation?.addEventListener('navigate', navigate);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
      navigation?.removeEventListener('navigate', navigate);
    };
  }, [dirty]);
}

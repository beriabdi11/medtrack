const isLocalhost = Boolean(
  window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/.test(window.location.hostname)
);

export function register(config) {
  if (process.env.NODE_ENV !== 'production') return;

  const publicUrl = new URL(process.env.PUBLIC_URL, window.location.href);
  if (publicUrl.origin !== window.location.origin) return;

  window.addEventListener('load', () => {
    const swUrl = `${process.env.PUBLIC_URL}/service-worker.js`;

    if (isLocalhost) {
      checkValidServiceWorker(swUrl, config);
      navigator.serviceWorker.ready.then(() => {});
    } else {
      registerValidSW(swUrl, config);
    }
  });
}

function registerValidSW(swUrl, config) {
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.onstatechange = () => {
          if (installingWorker.state !== 'installed') return;

          if (navigator.serviceWorker.controller) {
            // new content available
            config?.onUpdate?.(registration);
          } else {
            // cached for offline
            config?.onSuccess?.(registration);
          }
        };
      };
    })
    .catch(() => {});
}

function checkValidServiceWorker(swUrl, config) {
  fetch(swUrl, { headers: { 'Service-Worker': 'script' } })
    .then((response) => {
      const contentType = response.headers.get('content-type');
      if (response.status === 404 || (contentType && !contentType.includes('javascript'))) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.unregister().then(() => window.location.reload());
        });
      } else {
        registerValidSW(swUrl, config);
      }
    })
    .catch(() => {});
}

export function unregister() {
  navigator.serviceWorker?.ready?.then((registration) => registration.unregister());
}

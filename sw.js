/**
 * sw.js — « service worker » : permet d'ouvrir l'appli même sans réseau
 * (l'écran s'affiche, puis indique qu'il faut une connexion pour les données).
 *
 * Règles simples :
 *  - pages (navigation) : réseau d'abord, sinon la dernière version en cache ;
 *  - fichiers de l'appli (JS, CSS, icônes) : cache d'abord (leurs noms changent
 *    à chaque nouvelle version, donc pas de risque de garder une vieille version) ;
 *  - tout le reste (Supabase, TCGdex, Cardmarket…) : jamais mis en cache
 *    (l'appli garde elle-même une copie de ta collection pour le mode hors ligne).
 *
 * Il reçoit aussi les notifications push (alertes, souhaits, messages) et ouvre
 * la bonne page quand on touche la notification.
 */
const CACHE = 'collection-v3';
/** Fichiers gardés au plus (les plus anciens partent d'abord : anciennes versions) */
const MAX_FICHIERS = 120;
const COQUILLE = ['./', './index.html', './manifest.webmanifest', './icone.svg', './icone-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== CACHE).map((c) => caches.delete(c))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const requete = e.request;
  const url = new URL(requete.url);
  if (requete.method !== 'GET' || url.origin !== self.location.origin) return; // données : toujours en direct

  if (requete.mode === 'navigate') {
    e.respondWith(
      fetch(requete)
        .then((reponse) => {
          const copie = reponse.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copie));
          return reponse;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  e.respondWith(
    caches.match(requete).then((enCache) => enCache ?? fetch(requete).then((reponse) => {
      if (reponse.ok) {
        const copie = reponse.clone();
        caches.open(CACHE).then(async (c) => {
          await c.put(requete, copie);
          const cles = await c.keys();
          // Les clés sont dans l'ordre d'ajout ; la coquille (index.html…) n'est jamais retirée
          const retirables = cles.filter((k) => new URL(k.url).pathname.includes('/assets/'));
          await Promise.all(retirables.slice(0, Math.max(0, retirables.length - MAX_FICHIERS)).map((k) => c.delete(k)));
        });
      }
      return reponse;
    })),
  );
});

// ---- Notifications push ----------------------------------------------------
self.addEventListener('push', (e) => {
  let donnees = {};
  try { donnees = e.data ? e.data.json() : {}; } catch { donnees = { corps: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(donnees.titre || 'Ma Collection TCG', {
    body: donnees.corps || '',
    icon: './icone-192.png',
    badge: './icone-192.png',
    tag: donnees.tag,
    data: { url: donnees.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const cible = e.notification.data?.url || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
    for (const f of fenetres) {
      if (f.url.split('#')[0] === cible.split('#')[0] && 'focus' in f) {
        f.navigate(cible);
        return f.focus();
      }
    }
    return self.clients.openWindow(cible);
  }));
});

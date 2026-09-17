// ══════════════════════════════════════════════════════════════════
//  Service Worker — Caisse SaaS Pro (DIGITALE SOLUTION)
//  Stratégie : offline-first pour l'app-shell, réseau prioritaire
//  avec repli cache pour la page principale, jamais de cache pour
//  les appels Firebase/Firestore.
// ══════════════════════════════════════════════════════════════════

// ⚠️ Incrémentez ce numéro à CHAQUE déploiement pour forcer la mise à
// jour du Service Worker chez les utilisateurs (sinon le navigateur
// ne détecte pas toujours le changement et sert une version en cache).
const CACHE_VERSION = "v1";
const CACHE_NAME = `caisse-pro-${CACHE_VERSION}`;

// Fichiers de l'app-shell à mettre en cache dès l'installation.
// Adaptez le nom du fichier HTML principal si besoin (ex: "index-24.html").
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// Domaines à ne JAMAIS mettre en cache (données temps réel / API) :
// Firestore, Auth, et tout endpoint Firebase/Google API.
const NEVER_CACHE_HOSTS = [
  "firestore.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "www.googleapis.com",
];

// ── Installation : pré-cache de l'app-shell ─────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            // Un fichier manquant ne doit pas bloquer toute l'installation
            console.warn("[SW] Impossible de pré-cacher", url, err);
          })
        )
      )
    )
  );
  // Ne PAS appeler skipWaiting() automatiquement ici : on attend le
  // message "SKIP_WAITING" envoyé par la page après confirmation de
  // l'utilisateur (voir le script de mise à jour dans index.html).
});

// ── Activation : nettoyage des anciens caches ───────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Message : mise à jour forcée depuis la page ─────────────────────
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Fetch : stratégies selon le type de requête ─────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // jamais les POST/PUT (Firestore writes, etc.)

  let url;
  try { url = new URL(request.url); } catch (e) { return; }

  // Jamais de cache pour les appels Firebase/Firestore/Auth
  if (NEVER_CACHE_HOSTS.some((host) => url.hostname === host)) {
    return; // laisse passer directement au réseau
  }

  // Navigation (chargement de la page principale) :
  // réseau en priorité, repli sur le cache si hors-ligne.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() =>
          caches.match("./index.html").then((cached) => cached || caches.match("./"))
        )
    );
    return;
  }

  // Reste (scripts CDN, polices, icônes, manifest, JSON) :
  // stale-while-revalidate — répond vite depuis le cache si présent,
  // et met à jour le cache en arrière-plan pour la prochaine visite.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

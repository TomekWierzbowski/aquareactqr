/* SERVICE WORKER APLIKACJI [D-270]: pliki aplikacji z pamięci telefonu (cache-first),
   żeby HMI otwierało się od razu i bez zasięgu (dane z brokera i tak wymagają sieci -
   bez niej ekran pokazuje ostatni stan z napisem „czekam na pakiet”). Nowa wersja
   plików = nowa nazwa pamięci (WERSJA z odcisku treści) -> stare kopie znikają. */
/* RODZINA = nazwy cache TEJ aplikacji; SW kasuje przy aktywacji TYLKO swoją rodzinę [izolacja TEST2, 23.09]:
   klient i TEST2 siedzą pod jednym origin (GitHub Pages), więc filtr „wszystko poza moją wersją"
   kasował cache drugiej aplikacji i zostawiał ją bez plików do startu offline (zmierzone przez Astrę). */
const RODZINA = 'qr-basen-hmi-';
const WERSJA = RODZINA + '6f307ddb73';
const PLIKI = ['./', './index.html', './hmi.html', './most_js.js', './mqtt.min.js', './paho_na_mqttjs.js', './wykres_temp.js', './parowanie.js',
               './manifest.webmanifest', './ikona-192.png', './ikona-512.png', './ikona-maskable-512.png'];
/* [Astra 15, 29.09.2026] SPÓJNY PAKIET, OKREŚLONY EKRAN, DANE BEZ PAMIĘCI
   WEJŚCIA:  żądania GET tej strony; pamięć TEJ wersji (WERSJA); sieć.
   CO Z CZEGO WYNIKA:
     - pliki aplikacji (strona, skrypty, manifest, ikony) idą z pamięci WŁASNEJ wersji - komplet z jednego wydania.
       Dawniej: sieć najpierw, a przy limicie czasu kopia z DOWOLNEJ pamięci (caches.match szuka we wszystkich) -
       hmi.html z serwera mógł trafić na most_js.js z poprzedniej wersji. Nowa wersja przychodzi CAŁA: nowy SW
       instaluje pełny zestaw (z pominięciem pamięci HTTP - GitHub Pages trzyma pliki 10 min), przejmuje stronę,
       a strona przeładowuje się w tle (nagłówek hmi.html);
     - kopii brak -> sieć z limitem: odpowiedź 2xx trafia do pamięci; błąd HTTP (np. 503), brak sieci albo sieć
       wisząca dłużej niż SIEC_MAX_MS = strona „nie mogę się teraz uruchomić” z przyciskiem (nawigacja) albo
       błąd pobrania (skrypt) - nigdy wieczne logo i nigdy strona błędu serwera zamiast działającej kopii;
     - WSZYSTKO INNE (dane, telemetria, komendy, cudze hosty, broker wss) - bez udziału SW: nie z pamięci
       i nie do pamięci. Cache strony nie może udawać świeżych danych ani wykonanej komendy.
   WYJŚCIA:  odpowiedź dla strony. */
const SIEC_MAX_MS = 8000;
const PAKIET = /\.(html|js|webmanifest|png|svg|ico)$/;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(WERSJA).then(c => c.addAll(PLIKI.map(p => new Request(p, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== WERSJA && k.startsWith(RODZINA)).map(k => caches.delete(k))))
              .then(() => self.clients.claim()));
});
const nieUruchomie = powod => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Basen HMI</title><body style="font:16px system-ui;background:#eef1f4;color:#111;padding:24px">' +
  '<h2 style="margin:0 0 12px">Aplikacja nie może się teraz uruchomić</h2>' +
  '<p>' + powod + ', a w telefonie nie ma jeszcze zapisanej kopii tej wersji.</p>' +
  '<p>Sprawdź zasięg i spróbuj ponownie.</p>' +
  '<button onclick="location.reload()" style="font:inherit;padding:10px 18px">Spróbuj ponownie</button></body>',
  { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // broker (wss) i obce hosty - bez udziału SW
  const nawigacja = e.request.mode === 'navigate';
  if (!nawigacja && !PAKIET.test(u.pathname)) return;                        // dane i reszta - wprost do sieci
  e.respondWith(caches.open(WERSJA).then(c => c.match(e.request, { ignoreSearch: true })).then(kopia => kopia || new Promise(res => {
    let dano = false;
    const daj = o => { if (!dano) { dano = true; res(o); } };
    const limit = setTimeout(() => daj(nawigacja ? nieUruchomie('Serwer aplikacji nie odpowiada') : Response.error()), SIEC_MAX_MS);
    fetch(e.request).then(odp => {
      clearTimeout(limit);
      if (odp && odp.ok) { const k = odp.clone(); caches.open(WERSJA).then(c => c.put(e.request, k)); daj(odp); return; }
      daj(nawigacja ? nieUruchomie('Serwer aplikacji odpowiedział błędem ' + (odp ? odp.status : '?')) : Response.error());
    }).catch(() => { clearTimeout(limit); daj(nawigacja ? nieUruchomie('Brak połączenia z serwerem aplikacji') : Response.error()); });
  })));
});

/* ============================================================================================
   paho_na_mqttjs.js — API Paho (tyle, ile używa apka) NA BIBLIOTECE MQTT.js W WERSJI 5.0
   [D-498, apka3 = TEST3 · MQTT 5, 26.09.2026]
   --------------------------------------------------------------------------------------------
   PO CO: Paho w przeglądarce zna tylko MQTT 3.1/3.1.1. Zamiast przepisywać aplikację (most_js.js,
   index.html — kilkadziesiąt miejsc z logiką ponawiania, zakresu kont i komunikatów), podmieniamy
   SAMĄ BIBLIOTEKĘ: z zewnątrz ten plik udaje Paho, w środku łączy się MQTT.js protokołem 5.0.
   Dzięki temu apka3 różni się od apki2 wyłącznie drogą, a nie logiką — różnicę w pomiarze można
   przypisać protokołowi (granica pomiaru, zasada 3).

   WEJŚCIA:  globalny `mqtt` z mqtt.min.js (MQTT.js 5.16.0, ładowany WCZEŚNIEJ).
   CO Z CZEGO WYNIKA — wiernie jak Paho, bo aplikacja na tym polega:
     • odmowa CONNACK → onFailure({errorCode: 6, errorMessage: "AMQJS0006E Bad Connack return code:N ..."}),
       gdzie N to kod w stylu 3.1.1 (aplikacja i ekran logowania rozpoznają po nim złe hasło: 4/5).
       Kody przyczyn MQTT 5 → 3.1.1:  0x84→1 (wersja), 0x85→2 (identyfikator), 0x88/0x89→3 (niedostępny),
       0x86→4 (zły login/hasło), 0x87/0x8C→5 (brak uprawnień); oryginał zostaje w treści („MQTT 5: 0x86").
     • brak CONNACK w `timeout` s → onFailure({errorCode: 1, "AMQJS0001E Connect timed out."})
     • błąd gniazda przed połączeniem → onFailure({errorCode: 7, "AMQJS0007E Socket error:..."})
     • zerwanie po połączeniu → onConnectionLost: 7 „Socket error" (błąd), 4 „Ping timed out" (keepalive),
       8 „AMQJS0008I Socket closed." (zwykłe zamknięcie, także DISCONNECT od brokera — powód v5 w treści)
     • disconnect() → onConnectionLost({errorCode: 0, "AMQJS0000I OK."}) — Paho robi to samo, a aplikacja
       ma na to osłonę [D-483]
     • connect() gdy połączony / send() i subscribe() gdy nie → wyjątek "AMQJS0011E Invalid state ..."
     • subscribe(t, {qos, onSuccess, onFailure}): SUBACK z kodem ≥ 0x80 (w v5 np. 0x87 „brak uprawnień")
       = onFailure — na tym aplikacja liczy zakres konta [D-484]
     • onSuccess PRZED onConnected(false, uri), jak w Paho
   WYJŚCIA:  window.Paho = { Client, Message, MQTT: { Client, Message } }.
   ⚠ Ponawianie: `reconnectPeriod: 0` — ponawia APLIKACJA (D-310), dokładnie jak przy Paho `reconnect:false`.
   ⚠ Właściwości MQTT 5 (wygaśnięcie sesji, aliasy tematów) celowo jeszcze NIE — najpierw pomiar
     „to samo co apka2, tylko po v5" (skill loxone-mqtt5 §2a, D-498).
   ⛔ JEDEN WŁAŚCICIEL POŁĄCZENIA [Astra 11, 29.09.2026]: próba = numer generacji (`_gen`) + jeden termin całej
     operacji (QUIC i wss razem, `timeout` z opcji). Nowe connect() / disconnect() w trakcie próby WYCOFUJE starą:
     jej klient MQTT.js jest zamykany, a jej zdarzenia i zegary nie wołają już niczego. Spóźnione „connect" starej
     próby (np. QUIC doszedł po przejściu na wss) zamyka ją od razu — dawniej zostawała żywa z tym samym clientId,
     broker przejmował sesję i wyrzucał dobrą (A→B→sukces B→późne A). wss po nieudanym QUIC dostaje RESZTĘ terminu,
     nie pełny limit od nowa (dawniej do 4+1+10+1 s, a formularz liczył 10). Sesja WebTransport zamyka się przy
     końcu strumienia, błędzie i close() - raz; strumień otwarty po anulowaniu jest od razu porzucany.
   ⚠ MARIAŻ QUIC + TLS [B.0z-78, D-530, 01.10.2026]: trzy tryby drogi (drogaTryb niżej):
       'kolejno' - dawne zachowanie (QUIC 4 s, potem wss) - DOMYŚLNE, gdy nikt nie ustawi inaczej;
       'mariaz'  - dwie drogi NARAZ pod jednym klientem Paho (sekcja MARIAŻ niżej) - aplikacja T3 z budowania;
       'tls'     - ta sama nakładka dwóch dróg, ale z samą drogą TLS (przełącznik w serwisie aplikacji).
     Tryby 'mariaz' i 'tls' dotyczą tylko serwera z mapy QUIC_DROGI (nasz broker v5); inne serwery (zapasy)
     zostają pojedynczym wss jak dotąd. Aplikacja klienta (Paho 3.1.1) tej nakładki nie ma - nie zmienia się nic.
   ⛔ PUBLIKACJA NALEŻY DO SWOJEGO POŁĄCZENIA [zadanie 11 Astry, 02.10.2026; sekcja PUBACK niżej]: wywołanie zwrotne
     PUBACK kończy wpis w mapie TEGO połączenia (klient + generacja + mapa przechwycone przy wysyłce), najwyżej raz;
     spóźnione wywołanie starego połączenia nie rusza nowej sesji (dowód 1 Astry na 3b785af7: stara #1 kasowała nową #1
     i guard PUBACK przestawał widzieć zastój). Guard zastoju PUBACK (5 s, z audytu WT 02.10, docs/36 §11 K7)
     działa TYLKO na drodze WebTransport: w trybie jednej drogi zrywa to połączenie (jak na quic/audyt-wt), w mariażu
     zamyka i odnawia SAMĄ drogę QUIC - działający TLS zostaje nietknięty.
   ⛔ JEDEN WARUNEK KAŻDEJ PRÓBY WebTransport [zadanie 12 Astry + audyt WT 02.10 K4/K5; docs/36 §11]: czyWolnoProbowacQUIC
     (pamięć porażki NA PUNKT POŁĄCZENIA w localStorage z wersją - przeżywa logowanie -> HMI i ponowne otwarcie aplikacji;
     dzierżawa innej karty) obowiązuje w pierwszym połączeniu obu trybów, zegarze ponowienia, zmianie sieci, powrocie na
     ekran, guardzie drogi i przełączniku serwisu. Zmiana sieci (`online` albo zmiana `connection.type`, nie sam szacunek
     rtt) i przełącznik dają drugą szansę NAJWYŻEJ raz na przerwę. Porzucone uzgodnienie WebTransport = porażka QUIC
     (przeglądarka i tak je prowadzi). Liczniki i dziennik prób: Paho._diagWT() (razem i na drogę).
   ============================================================================================ */
(function () {
  'use strict';
  if (!window.mqtt || !window.mqtt.connect) { console.error('paho_na_mqttjs: brak mqtt.min.js'); return; }
  var V5_NA_V3 = { 0x84: 1, 0x85: 2, 0x88: 3, 0x89: 3, 0x86: 4, 0x87: 5, 0x8C: 5 };
  var hex = function (n) { return '0x' + (+n).toString(16).toUpperCase(); };
  var utf8 = new TextDecoder('utf-8');
  var SEK = window.APKA_SEKUNDA_MS || 1000;   /* [Astra 11] test offline skraca sekundę (_test_polaczenie11.html) */
  var WSS_MIN_MS = SEK;                       /* mniej niż tyle z terminu po porażce QUIC = od razu „timed out" */
  var enc = new TextEncoder();
  /* ZEGAR MONOTONICZNY STRONY [zadanie 11 Astry]: czasy TRWANIA (czekanie na PUBACK, guard) liczymy performance.now() -
     przestawienie zegara telefonu (sieć, strefa czasowa) ich nie skraca ani nie wydłuża. */
  var mono = function () { try { return performance.now(); } catch (e) { return Date.now(); } };

  /* DIAGNOSTYKA [audyt WT/QUIC 02.10, zadania 11-12 Astry] - liczniki zawsze (kilka liczb), dziennik zdarzeń tylko z flagą
     (localStorage aqr_diag_wt=1 albo window.APKA_DIAG_WT), żeby nie zalewać pamięci telefonu. Zdarzenie: {gen (numer
     próby / połączenia), etap, m (zegar monotoniczny, ms), t (czas ścienny do zestawienia z bramką/routerem), szcz}.
     Bez treści wiadomości, haseł i PIN-ów - tylko końcówka tematu. Liczniki PUBACK: razem i osobno na drogę. */
  var drogaDiag = function () { return { proby: 0, polaczenia: 0, proby_nieudane: 0, zerwania: 0,
                                          puback_oczekuje: 0, puback_ok: 0, puback_blad: 0, puback_zastoj: 0 }; };
  var DIAG = { proby: 0, wt_utworzone: 0, wt_aktywne: 0, wt_ready: 0, wt_odrzucone: 0, wt_zamkniete: 0,
               wt_porzucone: 0, wss_starty: 0, fallback: {}, proby_wstrzymane: 0,
               puback_oczekuje: 0, puback_ok: 0, puback_blad: 0, puback_zastoj: 0,
               wybaczenia: 0, wybaczenia_wstrzymane: 0,
               drogi: { tls: drogaDiag(), quic: drogaDiag() } };   /* [zadanie 12] także osobno na drogę */
  var DZ = [], DZ_MAX = 400;
  var diagWlaczona = function () {
    if (window.APKA_DIAG_WT) return true;
    try { return localStorage.getItem('aqr_diag_wt') === '1'; } catch (e) { return false; }
  };
  var zdarzenie = function (gen, etap, szcz) {
    if (!diagWlaczona()) return;
    DZ.push({ gen: gen, etap: etap, m: Math.round(mono()), t: Date.now(), szcz: szcz || '' });
    if (DZ.length > DZ_MAX) DZ.shift();
  };

  /* ------------------------------------------------------------------------------------------
     PUBLIKACJA Z PILNOWANIEM PUBACK  [zadanie 11 Astry, 02.10.2026]
     WEJŚCIA:  klient MQTT.js `k`, mapa oczekujących TEGO połączenia `mapa` (Map nr -> chwila wysłania, zegar
               monotoniczny; null = połączenie bez liczenia), `aktualne()` - czy to wciąż to samo połączenie (klient +
               generacja + mapa), nazwa drogi do liczników, `poPuback(blad, aktualne)` - co dalej.
     CO Z CZEGO WYNIKA:
       • wpis trafia do mapy PRZED publish(); kończy go wywołanie zwrotne - w mapie PRZECHWYCONEJ przy wysyłce, nigdy
         w mapie nowego połączenia (dowód 1 Astry: numer liczony od 1 na połączenie, stara #1 kasowała nową #1);
       • numer publikacji jest jeden na całą stronę (nie od 1 na połączenie) - dodatkowa ochrona i czytelny dziennik;
       • jedna publikacja kończy się NAJWYŻEJ raz (drugie wywołanie biblioteki nic nie zmienia): licznik globalny maleje
         raz, także dla spóźnionego wywołania starego połączenia, które stanu bieżącej sesji nie zmienia;
       • wyjątek synchroniczny publish(): wpis wycofany (koniec z błędem), wyjątek idzie dalej do wołającego;
       • QoS 0 (bez PUBACK) - bez wpisu.
     WYJŚCIA:  nic; wynik przez poPuback. Guard zastoju czyta mapę przez pubWiek(). */
  var WT_PUBACK_LIMIT_S = 5;   /* [audyt WT 02.10] = termin wyniku komendy w aplikacji (most_js: 5 s); TLS: PUBACK p95 0,23 s */
  var widocznyOd = 0;          /* chwila (mono) ostatniego powrotu karty na ekran - czas w tle nie liczy się do zastoju */
  var pubNr = 0;
  /* [zadanie 13 Astry] WYJĄTEK Z WNĘTRZA BIBLIOTEKI = WYNIK NIEPEWNY: publish() już wywołany - pakiet mógł wyjść (część
     zapisana do gniazda, kopia drugą drogą). Marker `niepewne` mówi aplikacji „nie wiadomo, czy wysłano” (most_js: wynik
     NIEZNANY, bez ponowienia z nowym id). Wyjątek „AMQJS0011E … not connected” nakładka rzuca PRZED biblioteką - bez
     markera, czyli „na pewno nie wysłano”. */
  var niepewny = function (e) {
    if (!e || typeof e !== 'object') { var w = new Error(String(e)); w.niepewne = true; return w; }
    try { e.niepewne = true; } catch (x) {}
    return e;
  };
  var pubPilnuj = function (k, mapa, aktualne, temat, dane, opcje, droga, gen, poPuback) {
    if (!((opcje.qos || 0) >= 1) || !mapa) {
      try { k.publish(temat, dane, opcje, poPuback ? function (b) { poPuback(b, aktualne()); } : undefined); }
      catch (e) { throw niepewny(e); }
      return;
    }
    var nr = ++pubNr, kon = String(temat).split('/').pop(), dd = DIAG.drogi[droga] || DIAG.drogi.tls, skonczona = false;
    mapa.set(nr, mono());
    DIAG.puback_oczekuje++; dd.puback_oczekuje++;
    zdarzenie(gen, 'COMMAND_SENT', droga + ' ' + kon + ' #' + nr);
    var koniec = function (blad) {
      if (skonczona) return;                 /* druga odpowiedź tej samej publikacji */
      skonczona = true;
      mapa.delete(nr);                       /* mapa TEJ publikacji, nie mapa nowego połączenia */
      DIAG.puback_oczekuje--; dd.puback_oczekuje--;
      if (blad) { DIAG.puback_blad++; dd.puback_blad++; } else { DIAG.puback_ok++; dd.puback_ok++; }
      var biez = aktualne();
      zdarzenie(gen, blad ? 'PUBACK_BRAK' : 'PUBACK_RECEIVED', droga + ' ' + kon + ' #' + nr + (biez ? '' : ' (stare połączenie)')
                + (blad ? ' ' + String((blad && blad.message) || blad).slice(0, 60) : ''));
      if (poPuback) poPuback(blad, biez);
    };
    try { k.publish(temat, dane, opcje, koniec); }
    catch (e) { koniec(e); throw niepewny(e); }
  };
  /* ile ms czeka NAJSTARSZA publikacja tej mapy, licząc tylko czas widocznej karty (-1 = nic nie czeka). Telefon w tle
     mrozi zegary JS - po powrocie PUBACK bywa jeszcze w kolejce zdarzeń; bez tego guard zrywałby zdrową drogę. */
  var pubWiek = function (mapa) {
    var najst = null;
    if (mapa) mapa.forEach(function (t) { if (najst === null || t < najst) najst = t; });
    return najst === null ? -1 : mono() - Math.max(najst, widocznyOd);
  };

  /* ------------------------------------------------------------------------------------------
     QUIC PRZEZ WebTransport [D-500 Q2]
     QUIC_DROGI: serwer wss (host:port z ekranu logowania) -> port UDP gatewaya QUIC (dodatek aquareact_quic).
     Tylko NASZ broker [Tomasz: „nieważne, czy zewnętrzne brokery to mają — ważne, żeby nasz to miał"].
     ------------------------------------------------------------------------------------------ */
  var QUIC_DROGI = window.APKA_QUIC || { 'aquareact.duckdns.org:8889': 8890 };
  var QUIC_LIMIT_S = 4;            /* tyle czekamy na CONNACK przez QUIC, potem wss */
  var QUIC_PRZERWA_MIN = 10;       /* po porażce QUIC tyle minut prosto wss - punkt wyjścia, NIE stała Chromium [zadanie 12] */
  /* [B.0z-78] minuta liczona w SEK (jak reszta zegarów nakładki): na telefonie 60 000 ms jak dotąd, w teście offline
     skrócona razem z sekundą - inaczej próba „QUIC wraca po 10 min" musiałaby czekać 10 prawdziwych minut */
  var PRZERWA_MS = QUIC_PRZERWA_MIN * 60 * SEK;
  var DZ_TERMIN_MS = 15 * SEK;     /* dzierżawa próby WebTransport: dłużej niż najdłuższa próba (mariaż: limit connect() 10 s) */
  var SKOK_TOL_MS = 5 * SEK;       /* czas ścienny innej karty / poprzedniego otwarcia: tyle „z przyszłości” jeszcze uznajemy */
  var KL_PAM = 'aqr_quic_v1:', KL_DZ = 'aqr_quic_dz_v1:';   /* localStorage: wersja w nazwie klucza i w treści */
  var KARTA = (function () { try { var b = new Uint32Array(2); crypto.getRandomValues(b); return b[0].toString(36) + b[1].toString(36); }
                             catch (e) { return Math.random().toString(36).slice(2) + Date.now().toString(36); } })();
  var epZ = function (url) { var m = /^[a-z]+:\/\/([^\/?#]+)/i.exec(String(url)); return m ? m[1] : String(url); };

  /* PAMIĘĆ PORAŻKI QUIC - OSOBNO NA PUNKT POŁĄCZENIA (host:port UDP gatewaya)  [zadanie 12 Astry, 02.10.2026]
     WEJŚCIA:  porażki prób QUIC (quicZapamietaj), wybaczenia (quicZapomnij: zmiana sieci, przełącznik serwisu),
               wpisy innych kart i poprzednich otwarć aplikacji (localStorage, wersja 1).
     CO Z CZEGO WYNIKA:
       • pamięć dotyczy PUNKTU POŁĄCZENIA, nie całej aplikacji - porażka bramki jednego serwera nie blokuje innego;
       • w tej karcie czasy z zegara monotonicznego (PAM); w localStorage czas ścienny - wpis przeżywa przejście
         logowanie -> HMI i ponowne otwarcie aplikacji (w czasie przerwy aplikacja NIE zaczyna od WebTransport). Wpis z PRZYSZŁOŚCI
         (zegar telefonu cofnięty o więcej niż SKOK_TOL_MS) jest nieważny, za stary - wygasł; wpis tej samej karty
         czytamy z pamięci strony (monotonicznie), cudzy dokładamy, gdy jest nowszy;
       • porażka trwa, gdy jest młodsza niż PRZERWA_MS i późniejsza niż ostatnie wybaczenie;
       • bez haseł, kont i treści - punkt połączenia, dwa czasy, krótki powód;
       • localStorage niedostępny = pamięć tej karty dalej działa (QUIC i tak nie co sekundę).
     WYJŚCIA:  pamZostalo(ep) - ile ms jeszcze trwa przerwa (0 = nie trwa); pamCzytaj(ep) do diagnostyki. */
  var PAM = {};
  var wallZ = function (m) { return Date.now() - (mono() - m); };   /* chwila monotoniczna tej karty -> czas ścienny */
  var pamCzytaj = function (ep) {
    var r = PAM[ep] || (PAM[ep] = { porazka: null, wybaczono: null, powod: '' });
    try {
      var j = JSON.parse(localStorage.getItem(KL_PAM + ep) || 'null');
      if (j && j.v === 1 && j.kto !== KARTA) {
        var w = Date.now(), m = mono();
        ['porazka', 'wybaczono'].forEach(function (pole) {
          var t = j[pole];
          if (typeof t !== 'number' || !isFinite(t)) return;
          var wiek = w - t;
          if (wiek < -SKOK_TOL_MS) return;                        /* z przyszłości - nieważny */
          var tm = m - Math.max(0, wiek);
          if (r[pole] === null || tm > r[pole] + SEK / 10) { r[pole] = tm; if (pole === 'porazka') r.powod = String(j.powod || '').slice(0, 80); }
        });
      }
    } catch (e) {}
    return r;
  };
  var pamZapisz = function (ep, r) {
    try { localStorage.setItem(KL_PAM + ep, JSON.stringify({ v: 1, kto: KARTA,
            porazka: r.porazka === null ? null : Math.round(wallZ(r.porazka)),
            wybaczono: r.wybaczono === null ? null : Math.round(wallZ(r.wybaczono)), powod: r.powod || '' })); } catch (e) {}
  };
  var pamTrwa = function (r, m) { return r.porazka !== null && m - r.porazka < PRZERWA_MS && (r.wybaczono === null || r.porazka > r.wybaczono); };
  var pamZostalo = function (ep) { var r = pamCzytaj(ep), m = mono(); return pamTrwa(r, m) ? Math.max(1, PRZERWA_MS - (m - r.porazka)) : 0; };
  var pamPunkty = function () {
    var e = {}; Object.keys(PAM).forEach(function (k) { e[k] = 1; });
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(KL_PAM) === 0) e[k.slice(KL_PAM.length)] = 1; } } catch (x) {}
    return Object.keys(e);
  };
  var quicZapamietaj = function (ep, powod) {
    var r = pamCzytaj(ep); r.porazka = mono(); r.powod = String(powod || '?').slice(0, 80); pamZapisz(ep, r);
    var kl = String(powod || '?').replace(/[0-9.]+/g, 'N').slice(0, 60);
    DIAG.fallback[kl] = (DIAG.fallback[kl] || 0) + 1;
    console.warn('QUIC do ' + ep + ' zawiodl (' + (powod || '?') + ') - wss przez ' + QUIC_PRZERWA_MIN + ' min');
  };
  /* ZMIANA SIECI DAJE QUIC DRUGĄ SZANSĘ - NAJWYŻEJ RAZ NA PRZERWĘ  [26.09 WireGuard -> LTE; audyt WT 02.10 K4; zadanie 12]
     Porażka dotyczy SIECI, w której wystąpiła - nowa sieć = nowa próba (sens zmiany z 26.09). Ale przy migającym zasięgu
     `online` i zmiana łącza przychodzą co kilka sekund, a KAŻDA nieudana próba WebTransport przeglądarka trzyma 5 min
     jako „oczekującą” i wykładniczo opóźnia następne (docs/36 §11 K1) - dlatego wybaczenie (zmiana sieci ALBO
     przełącznik serwisu) najwyżej RAZ na PRZERWA_MS dla punktu połączenia; kolejna porażka trzyma wss do końca przerwy.
     Zwraca {wybaczone, wstrzymane, za_ms} - wołający mówi człowiekowi, czemu QUIC nie rusza (zasada 10). */
  var quicZapomnij = function (skad) {
    var wyn = { wybaczone: 0, wstrzymane: 0, za_ms: 0 }, m = mono();
    pamPunkty().forEach(function (ep) {
      var r = pamCzytaj(ep);
      if (!pamTrwa(r, m)) return;
      if (r.wybaczono !== null && m - r.wybaczono < PRZERWA_MS) {
        wyn.wstrzymane++; wyn.za_ms = Math.max(wyn.za_ms, PRZERWA_MS - (m - r.porazka));
        DIAG.wybaczenia_wstrzymane++; zdarzenie(0, 'WYBACZENIE_WSTRZYMANE', ep + ' ' + skad);
        return;
      }
      r.wybaczono = m; pamZapisz(ep, r);
      wyn.wybaczone++; DIAG.wybaczenia++; zdarzenie(0, 'WYBACZENIE', ep + ' ' + skad);
    });
    if (wyn.wybaczone) console.info('zmiana sieci (' + skad + ') - QUIC znow dozwolony (jedna szansa na ' + QUIC_PRZERWA_MIN + ' min)');
    if (wyn.wstrzymane) console.info('zmiana sieci (' + skad + ') - QUIC nadal wstrzymany: druga porazka w ' + QUIC_PRZERWA_MIN + ' min');
    return wyn;
  };
  /* DZIERŻAWA PRÓBY WebTransport MIĘDZY KARTAMI  [zadanie 12 Astry]
     WEJŚCIA:  utworzenie gniazda WTjakoWS (każde: logowanie, HMI, strona pomiaru), koniec uzgodnienia, czas ścienny.
     CO Z CZEGO WYNIKA: gniazdo WebTransport bierze dzierżawę punktu połączenia na DZ_TERMIN_MS; oddaje ją, gdy
               uzgodnienie się skończyło (gotowe albo odrzucone). Uzgodnienie PORZUCONE przez stronę (close() przed ready -
               przeglądarka i tak je prowadzi, docs/36 §11 K1b) trzyma dzierżawę do terminu: np. logowanie zamknęło się
               po sukcesie TLS, a HMI chwilę później nie dokłada drugiej próby do tego samego punktu. Nakładka przed
               próbą QUIC pyta dzInnej(); strona pomiaru tylko ZAZNACZA swoje próby (metody pomiaru nie zmieniamy, §11.7).
               Dzierżawa sięgająca dalej niż termin (zegar się przestawił) - nieważna.
     WYJŚCIA:  dzInnej(ep) - ile ms jeszcze trwa dzierżawa INNEJ karty (0 = wolne). */
  var dzCzytaj = function (ep) { try { return JSON.parse(localStorage.getItem(KL_DZ + ep) || 'null'); } catch (e) { return null; } };
  var dzWez = function (ep) { try { localStorage.setItem(KL_DZ + ep, JSON.stringify({ v: 1, kto: KARTA, koniec: Date.now() + DZ_TERMIN_MS })); } catch (e) {} };
  var dzOddaj = function (ep) { var j = dzCzytaj(ep); if (j && j.kto === KARTA) { try { localStorage.removeItem(KL_DZ + ep); } catch (e) {} } };
  var dzInnej = function (ep) {
    var j = dzCzytaj(ep);
    if (!j || j.v !== 1 || j.kto === KARTA || typeof j.koniec !== 'number') return 0;
    var zost = j.koniec - Date.now();
    return (zost > 0 && zost <= DZ_TERMIN_MS + SKOK_TOL_MS) ? zost : 0;
  };
  /* JEDEN WARUNEK PRÓBY QUIC  [zadanie 12 Astry; dowód 5: _mOzyw omijał pamięć porażki]
     WEJŚCIA:  punkt połączenia; WebTransport w przeglądarce, pamięć porażki, dzierżawa innej karty.
     CO Z CZEGO WYNIKA: JEDYNE miejsce decyzji „czy teraz wolno zacząć próbę WebTransport” - woła je pierwsze połączenie
               (oba tryby), zegar ponowienia, zmiana sieci i powrót na ekran (_mOzyw), guard drogi i przełącznik
               serwisu. Żadna droga nie tworzy WebTransport z pominięciem tego warunku (TLS startuje od razu niezależnie).
     WYJŚCIA:  {wolno, za_ms (kiedy znowu zapytać; 0 = nie planować), powod (zdanie dla człowieka), klucz (do jednego wpisu)}. */
  var czyWolnoProbowacQUIC = function (ep) {
    if (!window.WebTransport) return { wolno: false, za_ms: 0, powod: 'przeglądarka bez WebTransport', klucz: 'bezwt' };
    var zost = pamZostalo(ep);
    if (zost > 0) return { wolno: false, za_ms: zost, powod: 'QUIC zawiódł niedawno', klucz: 'p' + Math.round(PAM[ep].porazka) };
    var dz = dzInnej(ep);
    if (dz > 0) return { wolno: false, za_ms: dz + SEK / 4, powod: 'inna karta właśnie próbuje QUIC do tego serwera', klucz: 'd' + Math.round(dz / SEK) };
    return { wolno: true, za_ms: 0, powod: '', klucz: '' };
  };
  /* [B.0z-78] zmiana sieci budzi od razu drogi mariażu, które leżą (ozywWszystkie - sekcja MARIAŻ niżej).
     ⛔ [próba w słabym zasięgu 02.10, 42376ccb] `change` Chrome zgłasza także przy zmianie SZACUNKU łącza (rtt, downlink,
     effectiveType) - w słabym zasięgu dziesiątki razy na minutę (zmierzone: 72 w ~8 min). Zmiana SIECI to zmiana rodzaju
     łącza (`type`: wifi <-> cellular); bez `type` (komputer, część przeglądarek) liczy się tylko `online` - z rtt nie
     zgadujemy [zadanie 12]. `online` też nie dowodzi, że broker jest osiągalny - stąd jedna szansa na przerwę. */
  var rodzajLacza = function () { try { return (navigator.connection && navigator.connection.type) || ''; } catch (e) { return ''; } };
  var ostRodzaj = rodzajLacza();
  window.addEventListener('online', function () { quicZapomnij('online'); ozywWszystkie('sieć wróciła'); });
  try { if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', function () {
    var r = rodzajLacza();
    if (!r || r === ostRodzaj) return;
    ostRodzaj = r; quicZapomnij('rodzaj łącza ' + r); ozywWszystkie('zmiana sieci (' + r + ')');
  }); } catch (e) {}

  /* WebTransport UDAJĄCY WebSocket — MQTT.js w przeglądarce przyjmuje własny obiekt przez opcję `createWebsocket`
     i używa z niego tylko: readyState/OPEN, zdarzeń open/message/close/error, send(), close(), bufferedAmount.
     Jedna sesja WebTransport = jeden strumień dwukierunkowy = jedno połączenie MQTT (jak strumień w bramce).
     [audyt WT 02.10] liczniki gniazd (DIAG.wt_*) i zdarzenia dziennika; [zadanie 12] dzierżawa punktu połączenia na czas
     uzgodnienia, `naGotowe` - wołający dowiaduje się, że uzgodnienie się udało (porzucenie PO nim nie kosztuje). */
  class WTjakoWS extends EventTarget {
    constructor(url) {
      super();
      this.url = url; this.readyState = 0; this.binaryType = 'arraybuffer'; this.bufferedAmount = 0; this.protocol = 'mqtt';
      this.onopen = this.onclose = this.onerror = this.onmessage = null;
      this._gen = WTjakoWS.gen || 0; WTjakoWS.gen = 0;   /* numer próby nakładki (do dziennika diagnostycznego) */
      this._ep = epZ(url); this._uzg = true; this._porzucona = false; this.naGotowe = null;
      DIAG.wt_utworzone++; DIAG.wt_aktywne++; this._aktywny = true; zdarzenie(this._gen, 'WT_CREATE', this._ep);
      dzWez(this._ep);
      try { this._wt = new WebTransport(url.replace(/^wss?:/, 'https:')); }
      catch (e) { setTimeout(() => this._blad(e), 0); return; }
      /* [Astra 11] anulowane przed ready: strumienia nie otwieramy; otwarty mimo to (wyścig) - porzucamy od razu */
      this._wt.ready.then(() => {
        DIAG.wt_ready++; zdarzenie(this._gen, 'WT_READY', this.readyState === 0 ? '' : 'po anulowaniu');
        this._uzgKoniec(true);
        return this.readyState === 0 ? this._wt.createBidirectionalStream() : null;
      }).then(s => {
        if (!s) return;
        if (this.readyState !== 0) { try { s.writable.abort(); } catch (e) {} try { s.readable.cancel(); } catch (e) {} return; }
        this._pisz = s.writable.getWriter(); this.readyState = 1;
        zdarzenie(this._gen, 'STREAM_OPEN', '');
        this._zdarz('open', new Event('open')); this._czytaj(s.readable.getReader());
      }).catch(e => this._blad(e));
      this._wt.closed.then(() => this._koniec(), e => this._blad(e));
    }
    /* koniec uzgodnienia: dzierżawa oddana (porzucone i nieudane - zostaje do terminu), wołający wie o sukcesie */
    _uzgKoniec(ok) {
      if (!this._uzg) return;
      this._uzg = false;
      if (ok || !this._porzucona) dzOddaj(this._ep);
      if (ok && this.readyState === 0 && typeof this.naGotowe === 'function') { try { this.naGotowe(); } catch (e) {} }
    }
    async _czytaj(r) {
      try {
        for (;;) {
          const { value, done } = await r.read();
          if (done) break;
          this._zdarz('message', new MessageEvent('message', { data: value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) }));
        }
      } catch (e) { /* strumień zamknięty - niżej koniec */ }
      this._koniec();
    }
    send(d) {
      if (this.readyState !== 1) return;
      const u = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : enc.encode(String(d));
      this.bufferedAmount += u.byteLength;
      this._pisz.write(u).then(() => { this.bufferedAmount -= u.byteLength; }, e => this._blad(e));
    }
    close() {
      if (this.readyState >= 2) return;
      zdarzenie(this._gen, 'WT_CLOSE_REQUESTED', this.readyState === 0 ? 'przed ready' : '');
      if (this.readyState === 0 && this._uzg) this._porzucona = true;   /* przeglądarka i tak prowadzi uzgodnienie (K1b) */
      this.readyState = 2; this._koniec();
    }
    _blad(e) {
      if (this.readyState === 3) return;
      if (this.readyState === 0) { DIAG.wt_odrzucone++; zdarzenie(this._gen, 'WT_READY_REJECT', String((e && e.message) || e)); this._uzgKoniec(false); }
      const ev = new Event('error'); ev.message = String((e && e.message) || e); this._zdarz('error', ev); this._koniec();
    }
    /* [Astra 11] KONIEC = zamknięcie CAŁEJ sesji WebTransport (dawniej EOF strumienia zostawiał sesję otwartą) - raz */
    _koniec() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this._aktywny) { this._aktywny = false; DIAG.wt_aktywne--; DIAG.wt_zamkniete++; zdarzenie(this._gen, 'WT_CLOSED', ''); }
      if (this._wt && !this._wtZamkniete) { this._wtZamkniete = true; try { this._wt.close(); } catch (e) {} }
      this._zdarz('close', new CloseEvent('close', { code: 1006 }));
    }
    _zdarz(t, ev) { this.dispatchEvent(ev); const h = this['on' + t]; if (typeof h === 'function') h.call(this, ev); }
  }
  WTjakoWS.CONNECTING = 0; WTjakoWS.OPEN = 1; WTjakoWS.CLOSING = 2; WTjakoWS.CLOSED = 3;
  WTjakoWS.prototype.CONNECTING = 0; WTjakoWS.prototype.OPEN = 1; WTjakoWS.prototype.CLOSING = 2; WTjakoWS.prototype.CLOSED = 3;

  function Message(dane) {
    if (!(this instanceof Message)) return new Message(dane);
    this._tekst = (typeof dane === 'string') ? dane : null;   /* tekst publikujemy jako tekst */
    this._bajty = (typeof dane === 'string') ? enc.encode(dane) : new Uint8Array(dane || []);
    this.destinationName = undefined; this.qos = 0; this.retained = false; this.duplicate = false;
  }
  Object.defineProperty(Message.prototype, 'payloadString', { get: function () { return utf8.decode(this._bajty); } });
  Object.defineProperty(Message.prototype, 'payloadBytes', { get: function () { return this._bajty; } });

  /* new Client(host, port, path, clientId) albo new Client(uri, clientId) — aplikacja używa pierwszej postaci */
  function Client(host, port, path, clientId) {
    if (!(this instanceof Client)) return new Client(host, port, path, clientId);
    if (typeof port === 'string' && clientId === undefined && path === undefined) { this._uri = host; this.clientId = port; }
    else { this._host = host; this._port = port; this._path = path || '/mqtt'; this.clientId = clientId; }
    this._k = null; this._polaczony = false;
    this._gen = 0; this._proba = null;   /* [Astra 11] generacja i bieżąca próba (null = brak próby w toku) */
    this._m = null;                      /* [B.0z-78] stan mariażu (dwie drogi) albo null = tryb jednej drogi */
    this.onConnectionLost = null; this.onMessageArrived = null; this.onConnected = null;
    this.onDroga = null;                 /* [B.0z-78] zdanie o drogach do dziennika łącza (most_js: zrobDriver) */
  }
  /* [Astra 11] Wycofaj próbę w toku BEZ wywołań zwrotnych: zegar stop, klient MQTT.js zamknięty, zdarzenia martwe.
     ⛔ [audyt WT 02.10, K5; zadanie 12 (e)] PORZUCONE UZGODNIENIE WebTransport = PORAŻKA QUIC. close() strony nie wycofuje
     próby z kolejki przeglądarki (docs/36 §11 K1b) - żyje dalej jako „zombie” i kosztuje jak nieudana. Następna próba
     prosto wss, bez drugiego zombie. Porzucenie PO udanym uzgodnieniu (naGotowe) nic nie kosztuje - bez kary. */
  Client.prototype._wycofaj = function () {
    var p = this._proba; this._proba = null; this._gen++;
    if (!p) return;
    if (p.etap === 'wt' && !p.wtGotowe) {
      DIAG.wt_porzucone++; zdarzenie(p.gen, 'WT_PORZUCONA', 'nowe connect()/disconnect() w trakcie uzgodnienia WebTransport');
      quicZapamietaj(p.ep, 'proba WebTransport przerwana przez nowe polaczenie');
    }
    p.martwa = true; clearTimeout(p.zegar);
    try { if (p.k) p.k.end(true); } catch (e) {}
    if (this._k === p.k) this._k = null;
  };
  Client.prototype.isConnected = function () { return !!this._polaczony; };

  Client.prototype.connect = function (o) {
    o = o || {};
    if (this._polaczony) throw new Error('AMQJS0011E Invalid state already connected.');
    this._wycofaj();                     /* [Astra 11] poprzednia próba w toku - wycofana, nie równoległa */
    this._mStop();                       /* [B.0z-78] to samo dla próby mariażu w toku */
    /* [B.0z-78, D-530] MARIAŻ albo SAM TLS - tylko nasz broker (QUIC_DROGI) po TLS; tryb czytany przy KAŻDYM connect(),
       więc przełącznik z serwisu obowiązuje też po zerwaniu i ponownym łączeniu */
    var tryb = drogaTryb(), qm = (!this._uri && o.useSSL) ? QUIC_DROGI[this._host + ':' + this._port] : null;
    if (qm && (tryb === 'mariaz' || tryb === 'tls')) { this._mStart(o, qm, tryb); return; }
    var ja = this, wss = this._uri || ((o.useSSL ? 'wss://' : 'ws://') + this._host + ':' + this._port + this._path);
    /* [zadanie 12] termin próby na zegarze monotonicznym (przestawienie zegara telefonu go nie skraca) */
    var p = { gen: this._gen, martwa: false, k: null, zegar: null, koniec: mono() + (o.timeout || 30) * SEK, etap: null, ep: null, wtGotowe: false };
    this._proba = p;
    DIAG.proby++;
    var pozostalo = function () { return p.koniec - mono(); };
    /* koniec CAŁEJ operacji porażką - jedno onFailure, dopiero gdy nie ma już drogi w terminie */
    var porazkaOperacji = function (r) {
      if (p.martwa) return;
      p.martwa = true; clearTimeout(p.zegar);
      if (ja._proba === p) ja._proba = null;
      if (o.onFailure) o.onFailure(r);
    };
    /* [D-500 Q2] QUIC NAJPIERW, wss JAKO ZAPAS — tylko dla serwera z mapy QUIC_DROGI i przeglądarki z WebTransport.
       Porażka QUIC (UDP zablokowane, gateway nie działa, stary telefon) = od razu wss, niewidocznie dla aplikacji,
       i przez QUIC_PRZERWA_MIN nie próbujemy QUIC na tym serwerze (inaczej każde ponowne łączenie czekałoby na
       nieudaną próbę). ⚠ Odmowa LOGOWANIA (kod 6) NIE przechodzi na wss: broker już odpowiedział przez QUIC,
       złe hasło zostaje złym hasłem — aplikacja ma dostać tę odmowę, a nie drugą taką samą po wss. */
    var q = (!this._uri && o.useSSL) ? QUIC_DROGI[this._host + ':' + this._port] : null;
    var ep = q ? this._host + ':' + q : null, w = q ? czyWolnoProbowacQUIC(ep) : null;   /* [zadanie 12] jeden warunek */
    if (q && w.wolno) {
      p.etap = 'wt'; p.ep = ep;
      this._polacz(p, o, 'wss://' + this._host + ':' + q + this._path, function (u) {
                     WTjakoWS.gen = p.gen; var s = new WTjakoWS(u); s.naGotowe = function () { p.wtGotowe = true; }; return s; },
                   Math.min(QUIC_LIMIT_S * SEK, pozostalo()), function (r) {
        if (r && r.errorCode === 6) { p.etap = null; porazkaOperacji(r); return; }
        zdarzenie(p.gen, 'FALLBACK_REASON', r && r.errorMessage);
        quicZapamietaj(ep, r && r.errorMessage);
        var zost = pozostalo();                   /* [Astra 11] wss dostaje RESZTĘ terminu, nie pełny limit od nowa */
        if (zost < WSS_MIN_MS) { p.etap = null; porazkaOperacji({ errorCode: 1, errorMessage: 'AMQJS0001E Connect timed out.', invocationContext: o.invocationContext }); return; }
        p.etap = 'wss'; DIAG.wss_starty++; DIAG.drogi.tls.proby++; zdarzenie(p.gen, 'WSS_START', 'po porazce QUIC, zostalo ' + Math.round(zost) + ' ms');
        ja._polacz(p, o, wss, null, zost, porazkaOperacji);
      });
      return;
    }
    if (q && window.WebTransport) DIAG.proby_wstrzymane++;
    p.etap = 'wss'; DIAG.wss_starty++; DIAG.drogi.tls.proby++; zdarzenie(p.gen, 'WSS_START', q ? w.powod : '');
    this._polacz(p, o, wss, null, pozostalo(), porazkaOperacji);
  };

  /* Jedno podejście do połączenia jedną drogą (wss albo WebTransport) w ramach próby `p`. `budowniczy` = null ->
     zwykły WebSocket; `limitMs` = ile z terminu próby ma ta droga; `naPorazke` = co dalej (zapas albo koniec). */
  Client.prototype._polacz = function (p, o, uri, budowniczy, limitMs, naPorazke) {
    var ja = this;
    if (p.martwa) return;
    var zamkniety = false, udane = false, bladGniazda = null, bladKeepalive = false, powodV5 = null;
    var droga = budowniczy ? uri.replace(/^wss?:/, 'webtransport:') : uri;   /* do dziennika łącza aplikacji: widać, którą drogą */
    var dd = DIAG.drogi[budowniczy ? 'quic' : 'tls'];
    if (budowniczy) dd.proby++;
    /* [Astra 11] czy ten klient to wciąż BIEŻĄCA droga bieżącej generacji (inaczej: wycofany, spóźniony) */
    var biezacy = function () { return !p.martwa && p.gen === ja._gen && ja._k === k; };
    var zakoncz = function () { if (zamkniety) return; zamkniety = true; try { k.end(true); } catch (e) {} };
    var porazka = function (kod, txt) { clearTimeout(zegar); zakoncz(); if (!biezacy()) return; dd.proby_nieudane++; naPorazke({ errorCode: kod, errorMessage: txt, invocationContext: o.invocationContext }); };
    var k = mqtt.connect(uri, {
      protocolVersion: 5, clientId: this.clientId, username: o.userName, password: o.password,
      keepalive: o.keepAliveInterval != null ? o.keepAliveInterval : 60, clean: o.cleanSession !== false,
      /* ⚠ connectTimeout 0 w MQTT.js NIE wyłącza limitu - ustawia ZEROWY (zmierzone 26.09: natychmiastowe
         „connack timeout"). Limit = reszta terminu próby; nasz zegar niżej jest zapasem o 1/4 s dłuższym. */
      reconnectPeriod: 0, connectTimeout: Math.max(1, Math.round(limitMs)), resubscribe: false,
      createWebsocket: budowniczy || undefined,
    });
    p.k = k; this._k = k;
    var zegar = setTimeout(function () { if (!udane && !zamkniety) porazka(1, 'AMQJS0001E Connect timed out.'); }, limitMs + SEK / 4);
    p.zegar = zegar;
    k.on('connect', function () {
      if (zamkniety || !biezacy()) { zamkniety = true; try { k.end(true); } catch (e) {} return; }   /* [Astra 11] spóźniona: zamknij */
      clearTimeout(zegar); udane = true; ja._polaczony = true;
      p.martwa = true; p.etap = null; if (ja._proba === p) ja._proba = null;   /* próba zakończona sukcesem - połączenie trzyma `_k` */
      dd.polaczenia++; zdarzenie(p.gen, 'MQTT_CONNACK', droga);
      /* [zadanie 11] NOWE POŁĄCZENIE = NOWA MAPA oczekujących PUBACK; stare wywołania zwrotne kończą wpisy w swojej mapie.
         GUARD ZASTOJU [audyt WT 02.10, K7] tylko na WebTransport: sesja formalnie żywa, która nie potwierdza publikacji
         przez WT_PUBACK_LIMIT_S, jest zrywana (kod 7 z powodem), a QUIC trafia do pamięci porażki - następna próba wss. */
      clearInterval(ja._straz); ja._straz = null;
      var mapa = ja._pub = new Map(); ja._pubDroga = budowniczy ? 'quic' : 'tls';
      if (budowniczy) {
        var straz = ja._straz = setInterval(function () {
          if (ja._k !== k || !ja._polaczony || ja._pub !== mapa) { clearInterval(straz); return; }
          if (ukryta()) return;
          var wiek = pubWiek(mapa);
          if (wiek < WT_PUBACK_LIMIT_S * SEK) return;
          clearInterval(straz); ja._straz = null;
          DIAG.puback_zastoj++; DIAG.drogi.quic.puback_zastoj++;
          zdarzenie(p.gen, 'WT_ZASTOJ', 'brak PUBACK ' + (wiek / SEK).toFixed(1) + ' s');
          quicZapamietaj(epZ(uri), 'sesja WebTransport otwarta, brak PUBACK ' + WT_PUBACK_LIMIT_S + ' s');
          bladGniazda = new Error('WebTransport: brak PUBACK ' + WT_PUBACK_LIMIT_S + ' s - sesja uznana za martwa');
          naZamkniecie();                       /* od razu, bez czekania na zdarzenie close biblioteki */
        }, SEK);
      }
      if (o.onSuccess) o.onSuccess({ invocationContext: o.invocationContext });
      ja.droga = droga;
      if (ja.onConnected) ja.onConnected(false, droga);
    });
    k.on('message', function (temat, dane, pakiet) {
      if (ja._k !== k || !ja.onMessageArrived) return;
      var m = new Message(dane); m.destinationName = temat; m.qos = pakiet.qos; m.retained = !!pakiet.retain; m.duplicate = !!pakiet.dup;
      ja.onMessageArrived(m);
    });
    k.on('error', function (e) {
      if (ja._k !== k) return;
      if (!udane && e && typeof e.code === 'number' && e.code >= 0x80) {   /* odmowa CONNACK z kodem przyczyny v5 */
        porazka(6, 'AMQJS0006E Bad Connack return code:' + (V5_NA_V3[e.code] || 3) + ' ' + (e.message || '') + ' (MQTT 5: ' + hex(e.code) + ').');
        return;
      }
      if (!udane && /connack timeout/i.test(String(e && e.message))) { porazka(1, 'AMQJS0001E Connect timed out.'); return; }
      if (/keepalive/i.test(String(e && e.message))) bladKeepalive = true; else bladGniazda = e;
    });
    k.on('disconnect', function (p) { if (p && p.reasonCode) powodV5 = p.reasonCode; });   /* DISCONNECT od brokera (v5) */
    /* zamknięcie połączenia: zdarzenie close biblioteki ALBO guard PUBACK (wtedy od razu) - drugi raz nic nie robi */
    var naZamkniecie = function () {
      if (ja._k !== k) return;
      if (!udane) { if (!zamkniety) porazka(7, 'AMQJS0007E Socket error:' + (bladGniazda ? (bladGniazda.message || bladGniazda) : 'polaczenie zamkniete przed CONNACK') + '.'); return; }
      if (!ja._polaczony) return;
      clearInterval(ja._straz); ja._straz = null; ja._pub = null; dd.zerwania++;
      ja._polaczony = false; ja._k = null; zamkniety = true; try { k.end(true); } catch (e) {}
      var r = bladKeepalive ? { errorCode: 4, errorMessage: 'AMQJS0004E Ping timed out.' }
            : bladGniazda ? { errorCode: 7, errorMessage: 'AMQJS0007E Socket error:' + (bladGniazda.message || bladGniazda) + '.' }
            : { errorCode: 8, errorMessage: 'AMQJS0008I Socket closed.' + (powodV5 ? ' (MQTT 5 DISCONNECT ' + hex(powodV5) + ')' : '') };
      if (ja.onConnectionLost) ja.onConnectionLost(r);
    };
    k.on('close', naZamkniecie);
  };

  Client.prototype.disconnect = function () {
    if (this._m) { this._mRozlacz(); return; }   /* [B.0z-78] obie drogi naraz, jedno zdarzenie dla aplikacji */
    if (!this._polaczony) {
      /* [Astra 11] anulowanie próby w toku: wycofana bez wywołań zwrotnych (zdecydowała aplikacja), bez wyjątku */
      if (this._proba) { this._wycofaj(); return; }
      throw new Error('AMQJS0011E Invalid state not connected.');
    }
    var k = this._k; this._polaczony = false; this._k = null; this._gen++;
    clearInterval(this._straz); this._straz = null; this._pub = null;   /* [zadanie 11] */
    try { k.end(false); } catch (e) {}
    if (this.onConnectionLost) this.onConnectionLost({ errorCode: 0, errorMessage: 'AMQJS0000I OK.' });
  };

  Client.prototype.subscribe = function (temat, o) {
    o = o || {};
    if (!this._polaczony) throw new Error('AMQJS0011E Invalid state not connected.');
    if (this._m) { this._mSubskrybuj(temat, o); return; }   /* [B.0z-78] */
    /* [Sol S19] klasa z PRAWDZIWEGO SUBACK (mSubKlasa): zerwane łącze bez SUBACK to 'transport' z rc null, a nie
       udawane „SUBACK 0x80" - aplikacja liczyła je jako odmowę konta (ocenZakres) */
    var koniec = this._jednaOperacja(o, 'sub');
    try {
      this._k.subscribe(temat, { qos: o.qos || 0 }, function (blad, dane, pakiet) {
        var w = mSubKlasa(blad, dane, pakiet);
        if (w.stan === 'grant') { koniec(true, { grantedQos: [w.rc] }); return; }
        koniec(false, { errorCode: 0, errorMessage: mSubTekst(w.stan, w.rc, blad), przyczyna: { klasa: w.stan, rc: w.rc } });
      });
    } catch (e) { koniec.anuluj(); throw e; }   /* wyjątek idzie do aplikacji jak dotąd - bez drugiego sygnału z terminu */
  };

  /* JEDNA DROGA ('kolejno' albo serwer bez QUIC_DROGI): TEN SAM TERMIN OPERACJI CO W MARIAŻU  [sceptyk C, D6 - 02.10.2026]
     WEJŚCIA:  wywołanie subscribe()/unsubscribe() aplikacji w trybie jednej drogi, wywołanie zwrotne MQTT.js, zegar terminu,
               generacja połączenia (_gen: disconnect() i każdy nowy connect() ją podbijają).
     CO Z CZEGO WYNIKA: dotąd broker, który nie oddał SUBACK przy żywym połączeniu, zostawiał operację bez końca - aplikacja
               nie dostawała ani sukcesu, ani porażki (S17 naprawił to tylko w mariażu). Tryb jednej drogi to nie tylko
               dawny 'kolejno', ale KAŻDY serwer spoza QUIC_DROGI (np. broker zapasowy) - więc ta sama obietnica:
                 • najwyżej JEDNO wywołanie zwrotne na operację (spóźniony SUBACK po terminie nic nie woła);
                 • brak odpowiedzi w M_SUB_LIMIT_MS = jedno onFailure z przyczyną 'timeout' (jak w mariażu);
                 • po disconnect() / nowym connect() (inna generacja) - zero wywołań: prawdziwe MQTT.js end(false) czeka na
                   SUBACK i oddawało onSuccess już PO rozłączeniu (to samo zjawisko co R9 mariażu);
                 • termin, który upłynął przy zerwanym połączeniu, nie woła nic - zerwanie aplikacja dostała w onConnectionLost
                   (jak Paho; wynik transportu od biblioteki, jeśli przyszedł wcześniej, zostaje jak dotąd).
     WYJŚCIA:  funkcja koniec(ok, wynik) - pierwsze wołanie rozstrzyga, kolejne są puste; koniec.anuluj() - bez wywołań
               (wyjątek synchroniczny biblioteki idzie do aplikacji jak dotąd, termin już nic nie dołoży). */
  Client.prototype._jednaOperacja = function (o, rodzaj) {
    var ja = this, gen = this._gen, k = this._k, zrobione = false;
    var zegar = setTimeout(function () {
      if (zrobione) return;
      if (!ja._polaczony || ja._k !== k) { zrobione = true; return; }   /* połączenie już nie to - aplikacja wie z onConnectionLost */
      koniec(false, rodzaj === 'sub'
        ? { errorCode: 0, errorMessage: mSubTekst('timeout', null), przyczyna: { klasa: 'timeout', rc: null } }
        : { errorCode: 0, errorMessage: 'UNSUBACK - brak odpowiedzi brokera w ' + Math.round(M_SUB_LIMIT_MS / SEK) + ' s' });
    }, M_SUB_LIMIT_MS);
    var koniec = function (ok, wynik) {
      if (zrobione) return;
      zrobione = true; clearTimeout(zegar);
      if (ja._gen !== gen) return;                                      /* disconnect() albo nowa próba - bez wywołań */
      var cb = ok ? o.onSuccess : o.onFailure;
      if (cb) cb(Object.assign({}, wynik, { invocationContext: o.invocationContext }));
    };
    koniec.anuluj = function () { zrobione = true; clearTimeout(zegar); };
    return koniec;
  };

  Client.prototype.unsubscribe = function (temat, o) {
    o = o || {};
    if (!this._polaczony) throw new Error('AMQJS0011E Invalid state not connected.');
    if (this._m) { this._mOdsubskrybuj(temat, o); return; }   /* [B.0z-78] */
    var koniec = this._jednaOperacja(o, 'unsub');   /* [sceptyk C, D6] termin i jedno wywołanie jak przy subscribe */
    try {
      this._k.unsubscribe(temat, function (blad) {
        if (blad) koniec(false, { errorCode: 0, errorMessage: String(blad.message || blad) });
        else koniec(true, {});
      });
    } catch (e) { koniec.anuluj(); throw e; }
  };

  Client.prototype.send = function (m, dane, qos, retained) {
    if (!this._polaczony) throw new Error('AMQJS0011E Invalid state not connected.');
    if (typeof m === 'string') { var x = new Message(dane); x.destinationName = m; x.qos = qos || 0; x.retained = !!retained; m = x; }
    if (this._m) { this._mWyslij(m); return; }   /* [B.0z-78] jedną albo obiema drogami - klasyfikacja w _mWyslij */
    /* [zadanie 11] klient, generacja i mapa przechwycone TERAZ - wywołanie zwrotne nie czyta pól nowego połączenia */
    var ja = this, k = this._k, gen = this._gen, mapa = this._pub || null;
    pubPilnuj(k, mapa, function () { return ja._k === k && ja._gen === gen && ja._pub === mapa; },
              m.destinationName, m._tekst != null ? m._tekst : m._bajty, { qos: m.qos || 0, retain: !!m.retained },
              this._pubDroga || 'tls', gen, null);
  };
  Client.prototype.publish = Client.prototype.send;

  /* ==========================================================================================
     MARIAŻ QUIC + TLS — DWIE DROGI POD JEDNYM KLIENTEM PAHO  [B.0z-78, D-530, Tomasz 01.10.2026]
     ------------------------------------------------------------------------------------------
     PO CO: pomiar 01.10 (docs/36 §9): Wi-Fi → GSM — QUIC nie zrywa (ale opóźnia do 6 s i gubi), TLS zrywa
     i wraca w ~2 s; po braku zasięgu QUIC wraca wolniej (Chrome wstrzymuje QUIC). Obie drogi razem nigdy nie
     były gorsze od lepszej z nich. Miejsce użycia aplikacji to hala, spa, wieś, góry - Wi-Fi na granicy zasięgu.
     WEJŚCIA:  tryb drogi (drogaTryb), serwer z QUIC_DROGI, WebTransport w przeglądarce, opcje connect() aplikacji.
     CO Z CZEGO WYNIKA:
       • connect() otwiera RÓWNOLEGLE dwie drogi do TEGO SAMEGO brokera v5: QUIC (WebTransport przez gateway
         aquareact_quic, port z QUIC_DROGI) i TLS (wss). Każda ma PEŁNY termin z opcji (limit 4 s dla QUIC
         dotyczy tylko trybu 'kolejno'). Identyfikatory RÓŻNE: TLS = clientId, QUIC = clientId + 'q' - przy
         tym samym broker przejmowałby sesję i wyrzucał drugą drogę, czyli pętla zerwań.
       • aplikacja widzi JEDNO połączenie: onSuccess i onConnected przy pierwszym CONNACK; onFailure dopiero, gdy
         padły obie (wyjątek: odmowa LOGOWANIA z którejkolwiek - ten sam broker, druga droga powie to samo);
         onConnectionLost dopiero po zerwaniu OSTATNIEJ drogi. Zgubienie jednej drogi to linia w dzienniku
         łącza (onDroga) i ciche ponowienie - zielony pasek zostaje („kółko zamiast błędu").
       • ODBIÓR (_mOdbior): sterownik nadaje raz, broker oddaje wiadomość OBU sesjom - pierwsza wygrywa, kopia
         z drugiej drogi jest odrzucana (parowanie po treści w oknie 30 s, opis przy funkcji).
       • WYSYŁKA (_mWyslij): commandy `komenda` (z id - sterownik odsiewa powtórkę, 20a4 _siec_kom_powtorka) i
         odnowienie podglądu `zadanie` z liczbą (bez skutków ubocznych) idą OBIEMA drogami; reszta JEDNĄ - pełny
         blok, dziennik, karta SD, historia, rezerwa, dziennik aplikacji wykonałyby się w sterowniku dwa razy
         (`zadanie` odsiewa tylko powtórkę OSTATNIEGO w 3 s, a QUIC potrafi przyjść 6 s później).
         ⚠ Zasada „nieznane = JEDNA drogą": nowa prośba dopisana kiedyś do aplikacji nie pojedzie podwójnie po cichu.
       • drogę, która padła, nakładka przywraca sama: TLS po 1, 2, 5, 10, 30 s; QUIC raz po 1 s, a po nieudanej
         próbie po QUIC_PRZERWA_MIN albo przy zmianie sieci (raz na przerwę); przy powrocie na ekran TLS od razu,
         QUIC tylko gdy pozwala czyWolnoProbowacQUIC [zadanie 12 - jeden warunek dla każdej próby WebTransport]. Dotyczy
         też drogi, która padła PRZED pierwszym CONNACK - ponowienie liczy się od niego (gateway QUIC wyłączona =
         QUIC znowu po 10 min; TLS urwany w trakcie łączenia = TLS po 1 s) [sceptyk 01.10, W1/W2]. Drogę, której
         broker ODMÓWIŁ LOGOWANIA w trwającej sesji, próbujemy co QUIC_PRZERWA_MIN (zmiana sieci i powrót na ekran
         - od razu), z jednym zdaniem w dzienniku łącza na sesję [sceptyk 01.10, W3].
         Karta w tle - nie ponawiamy (Android i tak mrozi gniazda, D-310).
     WYJŚCIA:  API Paho jak wyżej + onDroga(tekst) + Paho.droga (przełącznik z serwisu aplikacji).
     ⚠ Bramka QUIC wyłączona w HA albo UDP zablokowane = QUIC pada przy próbie, zostaje sam TLS - bez onFailure
       i bez komunikatu błędu (wyłącznik globalny bez aplikacji, wymaganie Tomasza 01.10).
     ========================================================================================== */
  var M_OKNO_MS = 30 * SEK;       /* okno parowania kopii: dużo ponad zmierzone 6 s opóźnienia QUIC (docs/36 §9) */
  var M_OKNO_MAX = 2000;          /* najwyżej tyle kluczy w pamięci (podgląd to ~1-2 wiadomości/s - zapas kilkunastokrotny) */
  var M_DOSLIJ_MS = 6 * SEK;      /* command bez PUBACK na drodze, młodszy niż tyle, jedzie nią ponownie po jej powrocie */
  var M_SWIEZA_MS = 3 * SEK;      /* TLS „żywy" do wysyłki jedną drogą: odebrał coś w tym czasie */
  var M_CISZA_MS = 20 * SEK;      /* guard drogi: tyle ciszy jednej drogi… */
  var M_CISZA_INNA = 5;           /* …przy co najmniej tylu wiadomościach drugą = droga martwa, choć „połączona" */
  var M_STRAZ_MS = 5 * SEK;       /* co tyle patrzy guard drogi */
  var M_TLS_ODSTEPY = [1, 2, 5, 10, 30];   /* s - ponowienie zgubionej drogi TLS, aplikacja nic o tym nie wie */
  var M_QUIC_PO_ZERWANIU_S = 1;   /* zerwany QUIC, który DZIAŁAŁ: jedna szybka próba; jej porażka = pamięć porażki */
  var M_RZADKO_MS = QUIC_PRZERWA_MIN * 60 * SEK;   /* droga, która NIE WSTAJE: tyle między próbami (= pamięć porażki QUIC) */
  var M_ROZKAZY_MAX = 50;         /* bezpiecznik listy commandów do dosłania (i tak żyją 6 s) */
  var M_SUB_LIMIT_MS = 10 * SEK;  /* [Sol S17] JEDEN termin publicznej operacji SUBSCRIBE/UNSUBSCRIBE (= limit connect() aplikacji);
                                     ponowne połączenie drogi go NIE przedłuża - liczy się od wywołania subscribe()/unsubscribe() */
  /* tematy STANU: ostatnia wartość ma znaczenie, nie liczba wiadomości - wyjątek w parowaniu (_mOdbior) */
  var M_TEMATY_STANU = /\/(status|stan|serwery|nazwy)$/;
  /* [Sol S20] ODPOWIEDZI KARTY (pliki, plik, okres) BEZ PAROWANIA TREŚCI: dwie ODRĘBNE odpowiedzi o tej samej treści
     wyglądały jak kopia (np. ta sama strona na nową prośbę w oknie 30 s, gdy druga droga dopiero się zapisała) i jedna
     przepadała. Przechodzi KAŻDA kopia z obu dróg; tożsamość rozstrzyga BRIDGE: rid/part (nowy sterownik) albo dawne
     bramki kategorii/nazwy/pozycji (stary). Liczniki ruchu dróg - jak dla każdej wiadomości. */
  var M_TEMATY_RPC = /\/(pliki|plik|okres)$/;
  var NAZWA = { tls: 'TLS', quic: 'QUIC' };

  /* TRYB DROGI - skąd się bierze, od najmocniejszego:
       1. przełącznik w serwisie aplikacji w TEJ karcie (Paho.droga.ustaw) - działa także, gdy pamięć telefonu zawodzi;
       2. ?droga=mariaz|tls|kolejno w adresie - do prób, pamiętane w KARCIE (sessionStorage), żeby przeżyło
          przejście logowanie -> HMI;
       3. przełącznik zapamiętany w telefonie (localStorage, klucz z przedrostkiem aplikacji - T2/T3 osobno);
       4. window.APKA_DROGA z budowania (zbuduj_pwa.py --apka3: 'mariaz');
       5. 'kolejno' - dawne zachowanie. */
  var TRYBY = { mariaz: 1, tls: 1, kolejno: 1 };
  var KLUCZ = function (k) { return ((typeof window !== 'undefined' && window.APKA_KLUCZ) || '') + k; };
  var trybJawny = null;
  (function () {
    try { var p = new URLSearchParams(location.search).get('droga');
          if (p && TRYBY[p]) sessionStorage.setItem(KLUCZ('droga_proba'), p); } catch (e) {}
  })();
  var drogaTryb = function () {
    if (trybJawny) return trybJawny;
    try { var s = sessionStorage.getItem(KLUCZ('droga_proba')); if (s && TRYBY[s]) return s; } catch (e) {}
    try { var l = localStorage.getItem(KLUCZ('droga')); if (l && TRYBY[l]) return l; } catch (e) {}
    var w = window.APKA_DROGA; return (w && TRYBY[w]) ? w : 'kolejno';
  };
  /* KTÓRA WYSYŁKA OBIEMA DROGAMI - lista ZAMKNIĘTA, reszta jedną (patrz nagłówek sekcji). `zadanie` z liczbą to
     odnowienie podglądu („1000;niesie=0") - ta sama zasada co w sterowniku (_siec_odb_powtarzalne, 20a4). */
  var obiemaDrogami = function (temat, tekst) {
    return /\/komenda$/.test(temat) || (/\/zadanie$/.test(temat) && /^\d/.test(tekst));
  };
  /* FNV-1a 32 bit po BAJTACH - temat `historia` jest binarny, więc nie po tekście */
  var fnv = function (b) {
    var h = 0x811c9dc5;
    for (var i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16);
  };
  var ukryta = function () { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; };
  var krotko = function (r) { return String((r && r.errorMessage) || '?').replace(/^AMQJS\d+[EI]\s*/, ''); };
  /* „za 1 s" / „za 10 min albo przy zmianie sieci" - termin ponowienia drogi do dziennika łącza */
  var kiedyPonow = function (ms) {
    return ms >= 60 * SEK ? 'za ' + Math.ceil(ms / 60 / SEK) + ' min albo przy zmianie sieci' : 'za ' + Math.max(1, Math.round(ms / SEK)) + ' s';
  };
  var ZYWE = new Set();             /* klienci w trybie dwóch dróg - przełącznik i zmiana sieci docierają do nich od ręki */
  function ozywWszystkie(powod) { ZYWE.forEach(function (k) { try { k._mOzyw(powod); } catch (e) {} }); }
  try { if (typeof document !== 'undefined' && document.addEventListener)
          document.addEventListener('visibilitychange', function () { if (!ukryta()) { widocznyOd = mono(); ozywWszystkie('powrót na ekran'); } }); } catch (e) {}
  var inna = function (st, D) { return D === st.tls ? st.quic : st.tls; };

  Client.prototype._mLog = function (t) {
    try { console.info('[droga] ' + t); } catch (e) {}
    try { if (this.onDroga) this.onDroga(t); } catch (e) {}
  };

  /* START: stan sesji i obie drogi. Kolejność: QUIC, potem TLS - most_js łapie OSTATNIE gniazdo WebSocket strony
     (M._gniazdo, D-310), a WebTransport WebSocketem nie jest, więc tam trafia gniazdo TLS (M._zerwij = zerwanie TLS). */
  Client.prototype._mStart = function (o, q, tryb) {
    var ja = this;
    var droga = function (nazwa, uri, bud, cid) {
      return { nazwa: nazwa, uri: uri, budowniczy: bud, cid: cid, k: null, stan: 'stop', gen: 0, zegar: null, ponow: null,
               ponowNr: 0, ostOdbior: 0, licz: 0, innyPrzyOst: 0, blad: null, zerwanaOd: 0, bylaOk: false,
               odmowy: 0,     /* odmowy logowania tej drogi w trwającej sesji (od ostatniego CONNACK) - _mPorazka */
               liczWsp: 0, innyPrzyOstWsp: 0,   /* [Sol S19] wiadomości tematów gotowych na OBU drogach (guard) */
               prob: 0,       /* [Sol S22] próby połączenia tej drogi w sesji (diagnostyka serwisu) */
               pub: null, pubStraz: null, ostPuback: 0,   /* [zadanie 11] oczekujące PUBACK połączenia, guard (QUIC) */
               sub: new Map() };   /* [Sol S18] filtr -> ostatnia próba SUBSCRIBE tej drogi {rev, gen, k, stan, rc} */
    };
    var st = { o: o, tryb: tryb, polaczony: false, martwa: false, limit: (o.timeout || 30) * SEK,
               sub: new Map(),      /* [Sol S18] filtr -> {qos, rev, chce} - ŻĄDANE filtry; po unsubscribe zostaje
                                       nagrobek (chce: false) z nową rewizją, żeby spóźniony SUBACK nie ożywił filtra */
               subRev: 0, klucze: new Map(), ost: Object.create(null), rozkazy: [],
               kopie: 0, pierwsze: { tls: 0, quic: 0 }, straz: null, bezWT: false,
               ozywCzeka: null,     /* zmiana sieci / powrót na ekran przed pierwszym CONNACK (obsłuży _mPolaczona) */
               ops: new Map(), opNr: 0 };   /* [Sol S17] operacje SUBSCRIBE/UNSUBSCRIBE w toku (id -> op) */
    st.ep = this._host + ':' + q;        /* [zadanie 12] punkt połączenia QUIC - pamięć porażki i dzierżawa */
    st.quic = droga('quic', 'wss://' + this._host + ':' + q + this._path, true, this.clientId + 'q');
    st.tls = droga('tls', 'wss://' + this._host + ':' + this._port + this._path, null, this.clientId);
    this._m = st; ZYWE.add(this);
    this._mLog(tryb === 'tls' ? 'droga: sam TLS (QUIC wyłączony na tym telefonie)' : 'mariaż: QUIC + TLS naraz');
    if (tryb === 'mariaz') this._mQuicStart(st, true);
    this._mDroga(st, st.tls);
    st.straz = setInterval(function () { ja._mStraz(st); }, M_STRAZ_MS);
  };

  /* QUIC - tylko w trybie mariaż i tylko przez JEDEN warunek czyWolnoProbowacQUIC [zadanie 12]: bez WebTransport - zdanie
     raz; pamięć porażki albo dzierżawa innej karty - próba zaplanowana na ich koniec, zdanie raz na tę samą przyczynę
     (mow = pierwsze połączenie / przełącznik: zdanie zawsze). Zwraca true, gdy próba ruszyła. */
  Client.prototype._mQuicStart = function (st, mow) {
    var D = st.quic;
    if (st.martwa || st.tryb !== 'mariaz' || D.k) return false;
    if (!window.WebTransport) {
      if (!st.bezWT) { st.bezWT = true; this._mLog('mariaż: ta przeglądarka nie ma WebTransport - jedzie sam TLS'); }
      return false;
    }
    var w = czyWolnoProbowacQUIC(st.ep);
    if (!w.wolno) {
      DIAG.proby_wstrzymane++; zdarzenie(D.gen, 'QUIC_WSTRZYMANY', w.powod);
      if (mow || st.ostWstrzymany !== w.klucz)
        this._mLog('mariaż: ' + w.powod + ' - jedzie TLS, QUIC spróbuję ' + kiedyPonow(w.za_ms));
      st.ostWstrzymany = w.klucz;
      this._mPlanuj(st, D, w.za_ms);
      return false;
    }
    this._mDroga(st, D);
    return true;
  };

  /* JEDNA DROGA - jedno podejście (jak _polacz wyżej, te same kody błędów), w ramach sesji `st`. Zdarzenia klienta
     MQTT.js po zamknięciu drogi (D.gen) albo po końcu sesji milczą. */
  Client.prototype._mDroga = function (st, D) {
    var ja = this;
    if (st.martwa || D.k) return;
    clearTimeout(D.ponow); D.ponow = null;
    D.sub.clear();                       /* [Sol S18] nowe połączenie drogi: jej gotowość od zera, lista żądanych zostaje */
    D.prob++;                            /* [Sol S22] */
    var g = ++D.gen;
    D.wtGotowe = false;                  /* [zadanie 12] uzgodnienie WebTransport tej próby jeszcze nie skończone */
    DIAG.proby++; DIAG.drogi[D.nazwa].proby++; if (!D.budowniczy) DIAG.wss_starty++;
    zdarzenie(g, D.budowniczy ? 'QUIC_START' : 'WSS_START', D.nazwa);
    clearInterval(D.pubStraz); D.pubStraz = null;
    var mapa = D.pub = new Map();        /* [zadanie 11] oczekujące PUBACK TEGO połączenia drogi (stare kończą się w swojej) */
    var zywa = function () { return !st.martwa && ja._m === st && D.gen === g; };
    var udane = false, zamkniety = false, bladGniazda = null, bladKeepalive = false, powodV5 = null;
    var k = mqtt.connect(D.uri, {
      protocolVersion: 5, clientId: D.cid, username: st.o.userName, password: st.o.password,
      keepalive: st.o.keepAliveInterval != null ? st.o.keepAliveInterval : 60, clean: st.o.cleanSession !== false,
      reconnectPeriod: 0, connectTimeout: Math.max(1, Math.round(st.limit)), resubscribe: false,
      /* [B.0z-77] zegar keepalive na zwykłym setTimeout: zegar w workerze po powrocie z tła oddawał zaległe tyknięcia
         naraz („Keepalive timeout" 2-3 ms po CONNACK, w pętli) - przy dwóch drogach ryzyko podwójne */
      timerVariant: 'native',
      createWebsocket: D.budowniczy ? function (u) {
        WTjakoWS.gen = g; var w = new WTjakoWS(u);
        w.naGotowe = function () { if (D.gen === g) D.wtGotowe = true; };   /* porzucenie po tym nic nie kosztuje */
        return w;
      } : undefined,
    });
    D.k = k; D.stan = 'laczy';
    var zakoncz = function () { if (zamkniety) return; zamkniety = true; try { k.end(true); } catch (e) {} };
    var porazka = function (kod, txt) {
      clearTimeout(D.zegar); zakoncz();
      if (!zywa() || D.k !== k) return;
      D.k = null; D.stan = 'stop';
      DIAG.drogi[D.nazwa].proby_nieudane++;
      ja._mPorazka(st, D, { errorCode: kod, errorMessage: txt, invocationContext: st.o.invocationContext });
    };
    D.zegar = setTimeout(function () { if (!udane && !zamkniety) porazka(1, 'AMQJS0001E Connect timed out.'); }, st.limit + SEK / 4);
    k.on('connect', function () {
      if (zamkniety || !zywa() || D.k !== k) { zamkniety = true; try { k.end(true); } catch (e) {} return; }   /* spóźniona */
      clearTimeout(D.zegar); udane = true;
      DIAG.drogi[D.nazwa].polaczenia++; zdarzenie(g, 'MQTT_CONNACK', D.nazwa);
      /* [zadanie 11, audyt WT 02.10 K7] GUARD ZASTOJU PUBACK - TYLKO DROGA QUIC: brak PUBACK przez WT_PUBACK_LIMIT_S
         (czas widocznej karty) = droga QUIC martwa, choć „połączona”. Zamykamy SAMĄ ją (dalej jak każde zerwanie drogi:
         _mUtrata - TLS niesie = aplikacja nic nie wie, ponowienie po pamięci porażki; TLS też leży = jedno onConnectionLost).
         Sprawnego TLS guard nie dotyka [zadanie 1 Astry]. */
      if (D === st.quic) {
        D.pubStraz = setInterval(function () {
          if (!zywa() || D.k !== k || D.pub !== mapa) { clearInterval(D.pubStraz); D.pubStraz = null; return; }
          if (ukryta()) return;
          var wiek = pubWiek(mapa);
          if (wiek < WT_PUBACK_LIMIT_S * SEK) return;
          clearInterval(D.pubStraz); D.pubStraz = null;
          DIAG.puback_zastoj++; DIAG.drogi.quic.puback_zastoj++;
          zdarzenie(g, 'WT_ZASTOJ', 'quic brak PUBACK ' + (wiek / SEK).toFixed(1) + ' s');
          quicZapamietaj(st.ep, 'droga QUIC otwarta, brak PUBACK ' + WT_PUBACK_LIMIT_S + ' s');
          bladGniazda = new Error('WebTransport: brak PUBACK ' + WT_PUBACK_LIMIT_S + ' s - droga QUIC uznana za martwa');
          naZamkniecie();                     /* od razu, bez czekania na zdarzenie close biblioteki */
        }, SEK);
      }
      ja._mPolaczona(st, D);
    });
    k.on('message', function (temat, dane, pakiet) { if (zywa() && D.k === k) ja._mOdbior(st, D, temat, dane, pakiet || {}); });
    k.on('error', function (e) {
      if (!zywa() || D.k !== k) return;
      if (!udane && e && typeof e.code === 'number' && e.code >= 0x80) {
        porazka(6, 'AMQJS0006E Bad Connack return code:' + (V5_NA_V3[e.code] || 3) + ' ' + (e.message || '') + ' (MQTT 5: ' + hex(e.code) + ').');
        return;
      }
      if (!udane && /connack timeout/i.test(String(e && e.message))) { porazka(1, 'AMQJS0001E Connect timed out.'); return; }
      if (/keepalive/i.test(String(e && e.message))) bladKeepalive = true; else bladGniazda = e;
    });
    k.on('disconnect', function (p) { if (p && p.reasonCode) powodV5 = p.reasonCode; });
    /* zamknięcie drogi: zdarzenie close biblioteki ALBO guard PUBACK (od razu) - drugi raz nic nie robi (D.k !== k) */
    var naZamkniecie = function () {
      if (!zywa() || D.k !== k) return;
      if (!udane) { if (!zamkniety) porazka(7, 'AMQJS0007E Socket error:' + (bladGniazda ? (bladGniazda.message || bladGniazda) : 'polaczenie zamkniete przed CONNACK') + '.'); return; }
      zamkniety = true; try { k.end(true); } catch (e) {}
      clearInterval(D.pubStraz); D.pubStraz = null; DIAG.drogi[D.nazwa].zerwania++;
      D.k = null; D.stan = 'stop';
      ja._mUtrata(st, D, bladKeepalive ? { errorCode: 4, errorMessage: 'AMQJS0004E Ping timed out.' }
                        : bladGniazda ? { errorCode: 7, errorMessage: 'AMQJS0007E Socket error:' + (bladGniazda.message || bladGniazda) + '.' }
                        : { errorCode: 8, errorMessage: 'AMQJS0008I Socket closed.' + (powodV5 ? ' (MQTT 5 DISCONNECT ' + hex(powodV5) + ')' : '') });
      /* [Sol S17] próby SUBSCRIBE/UNSUBSCRIBE tej drogi skończyły się transportem; druga droga może jeszcze dać wynik.
         Gdy padła cała sesja, _mUtrata już anulował operacje - aplikacja dostaje samo onConnectionLost, jak w Paho. */
      if (ja._m === st && !st.martwa) ja._mProbyDrogiPadly(st, D, k);
    };
    k.on('close', naZamkniecie);
  };

  /* DROGA WSTAŁA. Pierwsza w sesji = połączenie dla aplikacji. Kolejna (druga dołącza albo zgubiona wraca) = ta sama
     lista tematów i commandy bez PUBACK z ostatnich 6 s, w kolejności, PRZED nowymi - sterownik weźmie je za
     powtórkę (to samo id), a kolejność commandów na tej drodze zostaje zachowana (ryzyko R2 projektu). */
  Client.prototype._mPolaczona = function (st, D) {
    var E = inna(st, D), teraz = Date.now();
    var przerwa = D.zerwanaOd ? Math.round((teraz - D.zerwanaOd) / SEK) : null;
    D.stan = 'ok'; D.ponowNr = 0; D.blad = null; D.odmowy = 0; D.ostOdbior = teraz; D.innyPrzyOst = E.licz; D.zerwanaOd = 0;
    D.innyPrzyOstWsp = E.liczWsp;
    clearTimeout(D.ponow); D.ponow = null;
    if (!st.polaczony) {
      st.polaczony = true; this._polaczony = true; D.bylaOk = true;
      this._mLog('pierwsza połączona: ' + NAZWA[D.nazwa] + (E.k ? ' (' + NAZWA[E.nazwa] + ' jeszcze się łączy)' : ''));
      var o = st.o;
      if (o.onSuccess) o.onSuccess({ invocationContext: o.invocationContext });
      if (this._m !== st || st.martwa) return;            /* apka rozłączyła w onSuccess (np. strona logowania) */
      this.droga = D.budowniczy ? D.uri.replace(/^wss?:/, 'webtransport:') : D.uri;
      if (this.onConnected) this.onConnected(false, this.droga);
      if (this._m !== st || st.martwa) return;            /* apka rozłączyła w onConnected */
      /* [sceptyk 01.10, W1/W2] ZMIANA SIECI W TRAKCIE ŁĄCZENIA: _mOzyw przed pierwszym CONNACK tylko ją zapamiętał
         (st.ozywCzeka) - obsługujemy ją teraz, inaczej przepadała (Wi-Fi -> GSM w trakcie łączenia) */
      if (st.ozywCzeka) { var pw = st.ozywCzeka; st.ozywCzeka = null; this._mOzyw(pw + ' w trakcie łączenia'); }
      /* [sceptyk 01.10, W1/W2] DRUGA DROGA PADŁA PRZED TYM CONNACK (_mPorazka: „czekam na …") - dotąd nikt jej nie
         ponawiał i leżała do końca sesji: gateway QUIC wyłączona = sam TLS na zawsze (wbrew obietnicy „QUIC wraca
         po 10 min"), TLS urwany przy przejściu Wi-Fi -> GSM = sam QUIC i guard drogi ślepy (patrzy tylko przy
         obu „ok"). Teraz zwykłe ponowienie: QUIC po pamięci porażki (10 min) albo przy zmianie sieci, TLS po 1 s. */
      if (E.blad && !E.k && !E.ponow && E.stan !== 'ok') {
        var za = this._mPonow(st, E);
        if (za) this._mLog(NAZWA[E.nazwa] + ' nie wstała przy łączeniu - ponowię ' + kiedyPonow(za));
      }
    } else {
      var ja = this;
      /* [Sol S18] te same żądane filtry przez dispatcher: próba z wywołaniem zwrotnym - jej grant może skończyć
         operację aplikacji, która jeszcze czeka (QUIC pierwszy, TLS dołącza, QUIC gubi SUBACK) */
      st.sub.forEach(function (wpis, temat) { if (wpis.chce) ja._mSubNaDrodze(st, D, temat, wpis); });
      var ile = this._mDoslij(st, D);
      this._mLog(NAZWA[D.nazwa] + (D.bylaOk ? ' wróciła' + (przerwa != null ? ' po ' + przerwa + ' s' : '') : ' dołączyła')
                 + (E.stan === 'ok' ? ' - obie drogi niosą' : '') + (ile ? '; dosłane rozkazy: ' + ile : ''));
      D.bylaOk = true;
    }
    /* sam TLS: QUIC zostaje tylko, dopóki TLS nie PRZEJMIE odbioru (przełącznik w trakcie, kiedy TLS akurat leżał) -
       [Sol S22] CONNACK TLS to za mało: jego SUBACK-i jeszcze w drodze, a zamknięty QUIC = luka w odbiorze */
    this._mPrzejmij(st);
  };
  /* PRZEJĘCIE ODBIORU PRZEZ TLS  [Sol S22, 01.10.2026]
     WEJŚCIA:  tryb 'tls', gotowość filtrów obu dróg (S18).
     CO Z CZEGO WYNIKA: QUIC zamykamy dopiero, gdy TLS stoi i ma GRANT na każdy żądany filtr, który QUIC miał
               przyjęty (_mTlsPrzejelo) - filtrów świadomie poza uprawnieniami konta nie wymagamy, bo QUIC też ich nie
               miał. Wołane po CONNACK TLS i po każdym wyniku SUBACK. Gdy TLS nie potwierdzi w M_SUB_LIMIT_MS -
               QUIC ZOSTAJE (zasada X3: nie gasimy łącza, które niesie dane) i jedno zdanie w dzienniku łącza.
     WYJŚCIA:  zamknięty QUIC albo zdanie „QUIC zostaje”. ⚠ Polityka do potwierdzenia przez Tomasza (QUIC zostaje
               z ostrzeżeniem vs wymuszony sam TLS z ograniczonym odbiorem) - wdrożona ta bezpieczniejsza. */
  Client.prototype._mTlsPrzejelo = function (st) {
    var ja = this, brak = 0;
    if (st.tls.stan !== 'ok' || !st.tls.k) return false;
    /* czekamy tylko na ODPOWIEDŹ TLS (brak próby albo SUBACK w drodze); odmowa TLS jest odpowiedzią ostateczną - czekanie
       nic nie da, a człowiek wybrał „sam TLS”: ograniczenie widać w zdrowiu drogi („bez dostępu”) */
    st.sub.forEach(function (w, f) {
      if (!w.chce || !ja._mGotowyFiltr(st, st.quic, f) || ja._mGotowyFiltr(st, st.tls, f)) return;
      var p = st.tls.sub.get(f);
      if (!p || p.rev !== w.rev || p.gen !== st.tls.gen || p.k !== st.tls.k || p.stan === 'czeka') brak++;
    });
    return brak === 0;
  };
  Client.prototype._mPrzejmij = function (st) {
    if (this._m !== st || st.martwa || st.tryb !== 'tls' || !(st.quic.k || st.quic.ponow)) return;
    if (st.tls.stan !== 'ok') return;
    if (this._mTlsPrzejelo(st)) { clearTimeout(st.przejmijZegar); st.przejmijZegar = null; this._mZamknij(st, st.quic, true); this._mLog('sam TLS: QUIC zamknięty'); return; }
    if (!st.przejmijZegar) {
      var ja = this;
      st.przejmijZegar = setTimeout(function () {
        st.przejmijZegar = null;
        if (ja._m === st && !st.martwa && st.tryb === 'tls' && st.quic.k && !ja._mTlsPrzejelo(st))
          ja._mLog('sam TLS: TLS nie potwierdził tematów w ' + Math.round(M_SUB_LIMIT_MS / SEK) + ' s - QUIC zostaje, dopóki TLS ich nie przyjmie');
      }, M_SUB_LIMIT_MS);
    }
  };

  Client.prototype._mDoslij = function (st, D) {
    var teraz = Date.now(), ile = 0, ja = this;
    st.rozkazy = st.rozkazy.filter(function (r) { return teraz - r.kiedy < M_DOSLIJ_MS; });
    st.rozkazy.forEach(function (r) { if (!r.potw[D.nazwa]) { ja._mPublikuj(D, r.temat, r.dane, r.opcje, r); ile++; } });
    return ile;
  };

  /* PRÓBA DROGI NIEUDANA (przed CONNACK). Przed pierwszym połączeniem: czekamy na drugą drogę (gdy ona wstanie,
     tę ponowi _mPolaczona), a gdy i ona padła - jedno onFailure z powodem z TLS (bez bramki po drodze - mówi więcej).
     Odmowa LOGOWANIA (kod brokera 4/5) kończy od razu: to ten sam broker i to samo konto. W trwającym połączeniu -
     tylko dziennik i ponowienie. */
  Client.prototype._mPorazka = function (st, D, r) {
    D.blad = r;
    var E = inna(st, D);
    if (st.polaczony) this._mOpsOcen(st);   /* [Sol S18] droga, która się łączyła, nie jest już kandydatem operacji */
    var rc = /return code:\s*(\d)/.exec((r && r.errorMessage) || ''); rc = rc ? +rc[1] : null;
    var logowanie = r.errorCode === 6 && (rc === 4 || rc === 5);
    /* pamięć porażki QUIC: każda nieudana próba, a odmowa logowania tylko w TRWAJĄCEJ sesji (przed pierwszym
       połączeniem odmowa kończy całą próbę onFailure - aplikacja i tak nie połączy się tym kontem żadną drogą) */
    if (D === st.quic && (!logowanie || st.polaczony)) quicZapamietaj(st.ep, r.errorMessage);
    if (!st.polaczony) {
      if (logowanie) { this._mLog(NAZWA[D.nazwa] + ': broker odrzucił logowanie - koniec próby'); this._mKoniec(st, 'porazka', r); return; }
      if (E.stan === 'laczy') { this._mLog(NAZWA[D.nazwa] + ' nie wstała (' + krotko(r) + ') - czekam na ' + NAZWA[E.nazwa]); return; }
      this._mKoniec(st, 'porazka', st.tls.blad || r);
      return;
    }
    /* [sceptyk 01.10, W3] ODMOWA LOGOWANIA W TRWAJĄCEJ SESJI (hasło zmienione w Managerze, a druga droga jedzie
       jeszcze na starym logowaniu; konto bez prawa do identyfikatora „…q"): dawniej QUIC co ~1 s bez końca
       (25 prób i 25 linii dziennika w 30 s), TLS co 1/2/5/10/30 s. Teraz ta droga próbuje rzadko (M_RZADKO_MS,
       zmiana sieci i powrót na ekran - od razu), a zdanie do dziennika łącza idzie RAZ na sesję; aplikacja nic nie
       wie, dopóki druga droga niesie (gdy i ona padnie, aplikacja łączy od nowa i dostaje odmowę jak zawsze, kod 6). */
    if (logowanie) {
      D.odmowy++;
      var za = this._mPonow(st, D);
      if (D.odmowy === 1)
        this._mLog(NAZWA[D.nazwa] + ': broker odrzucił logowanie (' + krotko(r) + ')' + (E.stan === 'ok' ? ' - dane idą drogą ' + NAZWA[E.nazwa] : '')
                   + (za ? '; ' + NAZWA[D.nazwa] + ' spróbuję ' + kiedyPonow(za) + ', kolejne odmowy bez wpisu' : ''));
      return;
    }
    this._mLog(NAZWA[D.nazwa] + ': próba nieudana (' + krotko(r) + ')' + (E.stan === 'ok' ? ' - dane idą drogą ' + NAZWA[E.nazwa] : ''));
    this._mPonow(st, D);
  };

  /* DROGA ZERWANA (po CONNACK). Druga stoi = aplikacja nic nie wie, ponawiamy w tle. Ostatnia = jedno onConnectionLost
     (aplikacja sama łączy ponownie, D-310) - próby drugiej drogi w toku są przerywane, connect() zacznie od zera.
     ⚠ ROZWAŻONE I ODRZUCONE [sceptyk 01.10, pkt 4]: przy drugiej drodze W TRAKCIE próby (np. QUIC wstaje 1 s po
       swoim zerwaniu) czekać z onConnectionLost do końca tej próby, żeby nie mignęło „zerwane". To okno „połączona
       bez łącza" do limitu connect() (10 s) - ta sama klasa błędu co X3: send() rzuca (most_js wysyła command
       w Promise bez try - command wisi bez odpowiedzi), subscribe nie ma kim odpowiedzieć na SUBACK (zakres konta,
       D-484), pasek zielony bez danych. Aplikacja i tak łączy OD RAZU (polaczTeraz 'zerwane') nową sesją z obiema
       drogami, więc koszt to krótkie, uczciwe „zerwane" (zasada 10) - jak przed mariażem przy samym TLS (test W5). */
  Client.prototype._mUtrata = function (st, D, r) {
    var E = inna(st, D);
    D.zerwanaOd = Date.now();
    if (E.stan === 'ok') {
      this._mLog(NAZWA[D.nazwa] + ' zerwana (' + krotko(r) + ') - dane idą drogą ' + NAZWA[E.nazwa] + ', ponawiam w tle');
      this._mPonow(st, D);
      return;
    }
    this._mLog(NAZWA[D.nazwa] + ' zerwana, ' + NAZWA[E.nazwa] + ' też nie stoi - połączenie stracone');
    this._mKoniec(st, 'utrata', r);
  };

  /* PONOWIENIE ZGUBIONEJ DROGI W TLE - zwraca, za ile ms (0 = nie planujemy: sesja martwa, droga w toku, QUIC
     wyłączony w serwisie albo przeglądarka bez WebTransport).
       • QUIC zerwany po działaniu: raz po M_QUIC_PO_ZERWANIU_S;
       • QUIC po nieudanej PRÓBIE (D.blad - _mPorazka zapisał pamięć porażki, także przy odmowie logowania):
         koniec pamięci porażki; gdy pamięć telefonu zawodzi (sessionStorage niedostępny - pamięć „nic nie
         pamięta"), i tak M_RZADKO_MS, nie 1 s [sceptyk 01.10: inaczej pętla prób co sekundę];
       • TLS, któremu broker ODMÓWIŁ LOGOWANIA w trwającej sesji (D.odmowy): M_RZADKO_MS - to samo konto dostanie
         tę samą odmowę, a druga droga niesie dane [sceptyk 01.10, W3];
       • TLS: odstępy M_TLS_ODSTEPY. */
  Client.prototype._mPonow = function (st, D) {
    if (st.martwa || D.k) return 0;
    var ms;
    if (D === st.quic) {
      if (st.tryb !== 'mariaz' || !window.WebTransport) return 0;
      var w = czyWolnoProbowacQUIC(st.ep);   /* [zadanie 12] pamięć porażki ALBO dzierżawa innej karty */
      ms = !w.wolno ? w.za_ms : D.blad ? M_RZADKO_MS : M_QUIC_PO_ZERWANIU_S * SEK;
    } else if (D.odmowy) {
      ms = M_RZADKO_MS;
    } else {
      ms = M_TLS_ODSTEPY[Math.min(D.ponowNr, M_TLS_ODSTEPY.length - 1)] * SEK; D.ponowNr++;
    }
    this._mPlanuj(st, D, ms);
    return ms;
  };
  Client.prototype._mPlanuj = function (st, D, ms) {
    var ja = this;
    clearTimeout(D.ponow);
    D.ponow = setTimeout(function () {
      D.ponow = null;
      if (st.martwa || ja._m !== st || D.k) return;
      if (ukryta()) return;                 /* karta w tle: zrobi to powrót na ekran (_mOzyw) */
      if (D === st.quic) ja._mQuicStart(st, false); else ja._mDroga(st, D);
    }, Math.max(1, ms));
  };

  /* ZMIANA SIECI / POWRÓT NA EKRAN: drogi, które leżą, próbujemy OD RAZU - TLS zawsze, QUIC TYLKO gdy pozwala wspólny
     warunek czyWolnoProbowacQUIC [zadanie 12; dowód 5 Astry: dawniej QUIC „mimo pamięci porażki”, czyli przy migającym
     zasięgu każde `online` i każdy powrót na ekran dokładał próbę WebTransport do kolejki przeglądarki]. Zmiana sieci
     dostaje drugą szansę przez quicZapomnij (raz na przerwę) ZANIM tu wejdzie. Wstrzymany QUIC = zdanie raz na
     przyczynę (zasada 10). Dotyczy trwającego połączenia; zerwane całe łączy aplikacja.
     ⚠ PRZED PIERWSZYM CONNACK tylko zapamiętujemy (st.ozywCzeka) i _mPolaczona obsługuje to zaraz po nim
       [sceptyk 01.10, W2: dawniej zdarzenie przepadało - TLS urwany przy przejściu Wi-Fi -> GSM w trakcie łączenia
       nie wracał wcale]. Drogi w toku próby zostawiamy: skończą się w terminie connect() aplikacji. */
  Client.prototype._mOzyw = function (powod) {
    var st = this._m;
    if (!st || st.martwa) return;
    if (!st.polaczony) { st.ozywCzeka = powod; return; }
    var ja = this, ruszone = [], wstrz = null;
    [st.tls, st.quic].forEach(function (D) {
      if (D.k) return;
      if (D === st.quic) {
        if (st.tryb !== 'mariaz' || !window.WebTransport) return;
        var w = czyWolnoProbowacQUIC(st.ep);
        if (!w.wolno) {
          DIAG.proby_wstrzymane++; zdarzenie(D.gen, 'QUIC_WSTRZYMANY', powod + ': ' + w.powod);
          if (!D.ponow) ja._mPlanuj(st, D, w.za_ms);
          if (st.ostWstrzymany !== w.klucz) { st.ostWstrzymany = w.klucz; wstrz = w; }
          return;
        }
      }
      clearTimeout(D.ponow); D.ponow = null; D.ponowNr = 0;
      ja._mDroga(st, D); ruszone.push(NAZWA[D.nazwa]);
    });
    if (ruszone.length || wstrz)
      this._mLog(powod + (ruszone.length ? ' - próbuję od razu: ' + ruszone.join(', ') : '')
                 + (wstrz ? (ruszone.length ? '; ' : ' - ') + 'QUIC wstrzymany (' + wstrz.powod + ') - spróbuję ' + kiedyPonow(wstrz.za_ms) : ''));
  };

  /* GUARD DROGI: obie drogi niosą TEN SAM strumień, więc droga milcząca 20 s, kiedy druga w tym czasie przyniosła
     co najmniej 5 wiadomości, jest martwa, choć biblioteka twierdzi „połączona" (gniazdo TCP po zmianie Wi-Fi na GSM
     potrafi wisieć do końca keepalive). Budujemy ją od nowa - aplikacja nic nie zauważa. Tylko przy widocznej karcie. */
  Client.prototype._mStraz = function (st) {
    if (st.martwa || ukryta()) return;
    var ja = this, teraz = Date.now();
    [st.tls, st.quic].forEach(function (D) {
      var E = inna(st, D);
      if (st.martwa || D.stan !== 'ok' || E.stan !== 'ok') return;
      /* [Sol S19] liczą się tylko wiadomości tematów zapisanych (grant) na OBU drogach - temat, do którego QUIC nie ma
         prawa (ACL po identyfikatorze …q), nie robi z ciszy QUIC „martwej drogi” */
      var cisza = teraz - D.ostOdbior, przyniosla = E.liczWsp - D.innyPrzyOstWsp;
      if (cisza < M_CISZA_MS || przyniosla < M_CISZA_INNA) return;
      ja._mLog(NAZWA[D.nazwa] + ' milczy ' + Math.round(cisza / SEK) + ' s, a ' + NAZWA[E.nazwa] + ' przyniosła ' + przyniosla
               + ' wiadomości - buduję ' + NAZWA[D.nazwa] + ' od nowa');
      ja._mZamknij(st, D, false); D.zerwanaOd = teraz; D.ponowNr = 0;
      if (D === st.quic) ja._mQuicStart(st, false); else ja._mDroga(st, D);   /* [zadanie 12] QUIC przez wspólny warunek */
    });
  };

  /* ODBIÓR - PIERWSZA WYGRYWA, KOPIA Z DRUGIEJ DROGI ODPADA
     WEJŚCIA:  wiadomość z drogi D (temat, bajty, flagi retain/dup).
     CO Z CZEGO WYNIKA - klucz = temat + długość + FNV-1a z bajtów; na klucz licznik NA KAŻDĄ DROGĘ (okno 30 s):
       • KOPIA = druga droga przekazała ten klucz więcej razy niż D - D tylko dogania. Dzięki parowaniu prawdziwa
         powtórka tej samej treści (drugie `pliki` w ciągu 30 s) przechodzi, bo liczniki są równe;
       • droga, która nie stoi, „widzi" to, co przyniosła druga (licznik wyrównany) - przecież tej wiadomości już
         nie dostanie, a bez tego jej późniejsza prawdziwa powtórka wyglądałaby na kopię;
       • ZASTANA (retained) równa ostatniej przekazanej dla tematu = kopia (droga, która wróciła, dostaje zastane
         jeszcze raz - aplikacja już je ma);
       • `dup` z tej samej drogi, która już ten klucz dała = powtórka QoS 1 - odpada;
       • WYJĄTEK dla tematów stanu (status, stan, serwery, nazwy): „kopia" przechodzi, gdy ostatnią wartość tematu
         ustawiła TA SAMA droga - w obrębie jednej drogi kolejność jest pewna, więc jej nowsza wiadomość przywraca
         prawdę (bez tego spóźnione „offline" mogłoby zostać na ekranie na stałe).
     WYJŚCIA:  onMessageArrived raz na wiadomość. Kolejność stanu basenu pilnuje dalej most_js (seq + u przy `zm`
               i `blok`, zegar `t=` - zegarUstaw). */
  Client.prototype._mOdbior = function (st, D, temat, dane, pakiet) {
    var E = inna(st, D), teraz = Date.now();
    D.ostOdbior = teraz; D.licz++; D.innyPrzyOst = E.licz; D.innyPrzyOstWsp = E.liczWsp;
    if (this._mGotowyTemat(st, st.tls, temat) && this._mGotowyTemat(st, st.quic, temat)) D.liczWsp++;   /* [Sol S19] */
    var b = dane || [];
    if (M_TEMATY_RPC.test(temat)) { st.pierwsze[D.nazwa]++; this._mOddaj(temat, dane, pakiet); return; }   /* [Sol S20] */
    var klucz = temat + '|' + b.length + '|' + fnv(b);
    var w = st.klucze.get(klucz);
    if (w && teraz - w.kiedy > M_OKNO_MS) w = null;
    if (w) st.klucze.delete(klucz); else w = { n: { tls: 0, quic: 0 } };
    w.kiedy = teraz; st.klucze.set(klucz, w);          /* odświeżony klucz na koniec mapy - porządki idą od początku */
    for (var it = st.klucze.entries(), x = it.next(); !x.done; x = it.next()) {
      if (st.klucze.size <= M_OKNO_MAX && teraz - x.value[1].kiedy <= M_OKNO_MS) break;
      st.klucze.delete(x.value[0]);
    }
    var ja = D.nazwa, on = E.nazwa, ost = st.ost[temat], kopia;
    if (pakiet.retain && ost && ost.klucz === klucz) kopia = true;
    else if (pakiet.dup && w.n[ja] > 0) kopia = true;
    else if (w.n[on] > w.n[ja]) kopia = !(M_TEMATY_STANU.test(temat) && ost && ost.droga === ja);
    else kopia = false;
    w.n[ja]++;
    if (E.stan !== 'ok' && w.n[on] < w.n[ja]) w.n[on] = w.n[ja];
    if (kopia) { st.kopie++; return; }
    st.ost[temat] = { klucz: klucz, droga: ja };
    st.pierwsze[ja]++;
    this._mOddaj(temat, dane, pakiet);
  };
  /* wiadomość dla aplikacji: QoS, retained i dup zachowane (jedno miejsce - odbiór zwykły i odpowiedzi karty, S20) */
  Client.prototype._mOddaj = function (temat, dane, pakiet) {
    if (!this.onMessageArrived) return;
    var m = new Message(dane); m.destinationName = temat; m.qos = pakiet.qos || 0; m.retained = !!pakiet.retain; m.duplicate = !!pakiet.dup;
    this.onMessageArrived(m);
  };

  /* WYSYŁKA - obiema albo jedną (obiemaDrogami). Jedna = TLS, gdy stoi i coś odebrał w ostatnich 3 s (przy
     stabilnym łączu niższe p95: dom 143 ms wobec 232 ms QUIC, D-530; QUIC przy migracji: PUBACK p95 6 s i gubi,
     docs/36 §9); inaczej ta, która odebrała najświeżej. Ciężkiej prośbie zależy na doręczeniu, nie na
     milisekundach - gdy zginie, aplikacja ponawia po swoich limitach (8-15 s). */
  Client.prototype._mWyslij = function (m) {
    var st = this._m, ja = this, teraz = Date.now();
    var dane = m._tekst != null ? m._tekst : m._bajty, tekst = m._tekst != null ? m._tekst : utf8.decode(m._bajty);
    var opcje = { qos: m.qos || 0, retain: !!m.retained };
    if (obiemaDrogami(m.destinationName, tekst)) {
      var r = null;
      if (/\/komenda$/.test(m.destinationName)) {     /* command pamiętamy 6 s - do dosłania drogą, która wróci */
        r = { temat: m.destinationName, dane: dane, opcje: opcje, kiedy: teraz, potw: {} };
        st.rozkazy = st.rozkazy.filter(function (x) { return teraz - x.kiedy < M_DOSLIJ_MS; });
        st.rozkazy.push(r); if (st.rozkazy.length > M_ROZKAZY_MAX) st.rozkazy.shift();
      }
      /* [zadanie 13] KAŻDA DROGA OSOBNO: wyjątek jednej nie zatrzymuje drugiej sprawnej (dawniej forEach przerywał się na
         pierwszym wyjątku - QUIC rzucił, TLS nie dostał commandu, aplikacja dostawała wyjątek). Ta sama treść z tym samym id
         na obu - sterownik odsiewa kopię. Co najmniej jedna droga wysłała = sukces wysyłki (droga z wyjątkiem: zdanie
         w dzienniku łącza; command zostaje do dosłania, gdy ta droga wróci). Wszystkie rzuciły = wyjątek NIEPEWNY. */
      var ile = 0, bledy = [], zle = [];
      [st.quic, st.tls].forEach(function (D) {
        if (!(D.stan === 'ok' && D.k)) return;
        try { ja._mPublikuj(D, m.destinationName, dane, opcje, r); ile++; }
        catch (e) { bledy.push(niepewny(e)); zle.push(NAZWA[D.nazwa] + ' (' + String((e && e.message) || e).slice(0, 60) + ')'); }
      });
      if (zle.length) this._mLog('wysyłka rozkazu nie powiodła się: ' + zle.join(', ')
                                 + (ile ? ' - rozkaz poszedł drugą drogą' : ' - żadna droga nie potwierdziła wysyłki, wynik nieznany'));
      if (ile) return;
      if (bledy.length) throw bledy[0];
      throw new Error('AMQJS0011E Invalid state not connected.');
    }
    var D = this._mJedna(st);
    if (!D) throw new Error('AMQJS0011E Invalid state not connected.');
    this._mPublikuj(D, m.destinationName, dane, opcje, null);
  };
  Client.prototype._mJedna = function (st) {
    var t = st.tls, q = st.quic, teraz = Date.now();
    var tOk = t.stan === 'ok' && !!t.k, qOk = q.stan === 'ok' && !!q.k;
    if (tOk && (!qOk || teraz - t.ostOdbior < M_SWIEZA_MS || t.ostOdbior >= q.ostOdbior)) return t;
    return qOk ? q : null;
  };
  /* PUBACK (wywołanie zwrotne MQTT.js przy QoS 1) = broker ma command tą drogą - nie dosyłamy. To FAKT O BROKERZE, więc
     liczy się także PUBACK starego połączenia drogi (broker command dostał). [zadanie 11] Klient, generacja i mapa drogi
     przechwycone TERAZ: wpis oczekiwania kończy się w mapie tego połączenia, stan nowego połączenia bez zmian. */
  Client.prototype._mPublikuj = function (D, temat, dane, opcje, r) {
    var k = D.k, g = D.gen, mapa = D.pub || null;
    pubPilnuj(k, mapa, function () { return D.k === k && D.gen === g && D.pub === mapa; }, temat, dane, opcje, D.nazwa, g,
              function (blad, biez) { if (!blad && r) r.potw[D.nazwa] = true; if (!blad && biez) D.ostPuback = mono(); });
  };

  /* SUBSKRYPCJA: lista temat -> QoS zapamiętana (droga, która dołącza, zapisuje się na całą). Wywołanie zwrotne
     aplikacji RAZ, po pierwszym SUBACK z kodem - na nim aplikacja liczy zakres konta (ocenZakres, D-484). Błąd transportu
     jednej drogi (bez kodu) = czekamy na drugą; dopiero gdy wszystkie tak skończyły - onFailure. */
  /* CZAS ŻYCIA OPERACJI SUBSCRIBE/UNSUBSCRIBE  [Sol S17, 01.10.2026]
     WEJŚCIA:  wywołanie subscribe()/unsubscribe() aplikacji, wywołania zwrotne MQTT.js KAŻDEJ próby (droga + generacja
               + konkretny klient), zamknięcie drogi, koniec sesji, zegar terminu.
     CO Z CZEGO WYNIKA:
       • jedna operacja publiczna = wpis w st.ops z JEDNYM terminem (M_SUB_LIMIT_MS, nie przedłuża go żadne ponowne
         połączenie) i markerem `koniec` - wywołanie zwrotne aplikacji najwyżej RAZ (_mOperacjaKoniec);
       • próba = {droga, generacja, klient}; jej wynik liczy się tylko, gdy to wciąż TA SAMA droga, ta sama generacja
         i ten sam klient (_mProbaZywa) - SUBACK starej sesji albo starej próby drogi (QUIC zbudowany od nowa) nie
         rusza już niczego (dawniej odmowa spóźnionego QUIC kończyła operację, choć TLS dał grant);
       • zamknięcie jednej drogi kończy JEJ próby jako transport (_mProbyDrogiPadly) - operacja czeka na drugą;
       • koniec sesji (disconnect, utrata obu dróg) ANULUJE operacje bez wywołań zwrotnych, zanim zamknie klientów -
         biblioteka potrafi oddać „Connection closed” w trakcie end() albo później;
       • brak SUBACK do terminu = jedno onFailure (dawniej cisza bez końca).
     WYJŚCIA:  onSuccess/onFailure aplikacji najwyżej raz na operację; pusty rejestr i zatrzymane zegary po końcu.
     ⚠ Polityka sukcesu bez zmian w tej karcie (pierwszy SUBACK z kodem rozstrzyga) - przebudowuje ją S18. */
  Client.prototype._mProbaZywa = function (st, D, gen, k) {
    return this._m === st && !st.martwa && D.gen === gen && D.k === k;
  };
  Client.prototype._mOperacjaNowa = function (st, rodzaj, temat, o) {
    var ja = this, op = { id: ++st.opNr, rodzaj: rodzaj, temat: temat, o: o || {}, koniec: false, timer: null, proby: [] };
    st.ops.set(op.id, op);
    op.timer = setTimeout(function () {
      op.timer = null;
      if (rodzaj === 'sub') { ja._mSubPorazka(st, op, true); return; }   /* [Sol S19] z przyczynami dróg */
      ja._mOperacjaKoniec(st, op, { ok: false, paho: { errorCode: 0,
        errorMessage: 'UNSUBACK - brak odpowiedzi brokera w ' + Math.round(M_SUB_LIMIT_MS / SEK) + ' s' } });
    }, M_SUB_LIMIT_MS);
    return op;
  };
  /* WYNIK OPERACJI SUBSCRIBE PO DROGACH  [Sol S19]: ostatnia próba operacji na każdej drodze -> {klasa, rc};
     `terminem` = zegar operacji - próba, która wciąż czeka, to 'timeout' (brak odpowiedzi), nie odmowa */
  Client.prototype._mSubDrogi = function (st, op, terminem) {
    var d = {};
    op.proby.forEach(function (p) { d[p.D.nazwa] = { klasa: p.stan === 'czeka' && terminem ? 'timeout' : p.stan, rc: p.rc }; });
    return d;
  };
  /* PORAŻKA: wszystkie przyczyny zostają (ACL + brak odpowiedzi = 'mieszany', nie „odrzucono wszystko”); rc tylko,
     gdy jedna klasa i jeden kod - nigdy wymyślony kod dla brakującej odpowiedzi */
  Client.prototype._mSubPorazka = function (st, op, terminem) {
    var d = this._mSubDrogi(st, op, terminem), kl = {}, rcs = {}, n;
    for (n in d) { kl[d[n].klasa] = 1; rcs[String(d[n].rc)] = d[n].rc; }
    var klasy = Object.keys(kl), rcl = Object.keys(rcs);
    var klasa = klasy.length === 1 ? klasy[0] : klasy.length ? 'mieszany' : (terminem ? 'timeout' : 'transport');
    var rc = (klasy.length === 1 && rcl.length === 1) ? rcs[rcl[0]] : null;
    if (rc === undefined) rc = null;
    var bl = op.proby.filter(function (p) { return p.blad; }).map(function (p) { return p.blad; })[0];
    this._mOperacjaKoniec(st, op, { ok: false, paho: { errorCode: 0, errorMessage: mSubTekst(klasa, rc, klasa === 'transport' ? bl : null),
                                                        przyczyna: { klasa: klasa, rc: rc }, drogi: d } });
  };
  /* koniec operacji: marker PRZED wywołaniem aplikacji (aplikacja może w nim wołać disconnect/subscribe), zegar stop, wpis
     z rejestru; `anuluj` = bez wywołania (koniec sesji) */
  Client.prototype._mOperacjaKoniec = function (st, op, wynik, anuluj) {
    if (op.koniec) return false;
    op.koniec = true;
    clearTimeout(op.timer); op.timer = null;
    st.ops.delete(op.id);
    if (anuluj || this._m !== st || st.martwa) return true;
    var cb = wynik.ok ? op.o.onSuccess : op.o.onFailure;
    if (cb) cb(Object.assign({}, wynik.paho, { invocationContext: op.o.invocationContext }));
    return true;
  };
  /* próba operacji na drodze D: klient i generacja przechwycone TERAZ - wywołanie zwrotne nie czyta nowego D.k */
  Client.prototype._mProba = function (st, op, D) {
    var p = { D: D, gen: D.gen, k: D.k, stan: 'czeka', kod: null, blad: null };
    op.proby.push(p);
    return p;
  };
  /* droga zamknięta / zerwana: jej próby czekające na ACK kończą się transportem, operacja ocenia resztę */
  Client.prototype._mProbyDrogiPadly = function (st, D, k) {
    var ja = this;
    Array.from(st.ops.values()).forEach(function (op) {
      var zmiana = false;
      op.proby.forEach(function (p) { if (p.D === D && p.k === k && p.stan === 'czeka') { p.stan = 'transport'; p.blad = 'droga zamknięta'; zmiana = true; } });
      if (zmiana) ja._mOpOcen(st, op);
    });
  };
  /* KLASA WYNIKU SUBACK  [Sol S18/S19] - z PRAWDZIWEGO wywołania zwrotnego MQTT.js, nie z tekstu błędu:
       brak liczbowego kodu (błąd gniazda, zamknięcie)  -> 'transport', rc null (NIE udawany 0x80);
       0..2 bez błędu                                   -> 'grant';
       0x87 (brak uprawnień)                            -> 'acl';
       inny >= 0x80 (np. 0x80 błąd, 0x97 limit)         -> 'broker';
       grant z błędem albo kod 3..127                    -> 'nieprawidlowy' (wynik niespójny, nie sukces).
     ⚠ SKĄD KOD [Sol S18, sprawdzone na prawdziwym MQTT.js 5.16 - R10 w _test_mariaz_mqttjs.html i źródło mqtt.min.js]:
       przy ODMOWIE biblioteka woła cb(Error „Subscribe error: …”, [{topic, qos: ŻĄDANY QoS}], pakiet) - kod przyczyny
       jest WYŁĄCZNIE w pakiet.granted (i blad.packet.granted), a dane[0].qos to nasze żądane QoS. Dawna nakładka brała
       dane[0].qos i odmowę 0x87 widziała jako „SUBACK 0x1”. Przy grancie dane[0].qos = kod (biblioteka go wpisuje). */
  var mSubKlasa = function (blad, dane, pakiet) {
    var g = (pakiet && pakiet.granted) || (blad && blad.packet && blad.packet.granted) || null;
    var rc = g && g.length ? g[0] : (!blad && dane && dane[0] ? dane[0].qos : undefined);
    if (!(typeof rc === 'number' && rc % 1 === 0 && rc >= 0 && rc <= 255)) return { stan: 'transport', rc: null };
    if (rc <= 2 && !blad) return { stan: 'grant', rc: rc };
    if (rc === 0x87) return { stan: 'acl', rc: rc };
    if (rc >= 0x80) return { stan: 'broker', rc: rc };
    return { stan: 'nieprawidlowy', rc: rc };
  };
  /* [Sol S19] errorMessage w stylu Paho (zaczyna się od „SUBACK”), ale z prawdziwą przyczyną - aplikacja nie parsuje tej
     treści (kontrakt to pole `przyczyna`), czyta ją człowiek w dzienniku łącza */
  var mSubTekst = function (klasa, rc, blad) {
    var b = blad ? ' (' + String(blad.message || blad) + ')' : '';
    if (klasa === 'acl') return 'SUBACK ' + hex(rc) + ' - brak uprawnień';
    if (klasa === 'broker') return 'SUBACK ' + hex(rc) + (rc === 0x97 ? ' - limit brokera' : ' - odmowa brokera');
    if (klasa === 'timeout') return 'SUBACK - brak odpowiedzi brokera w ' + Math.round(M_SUB_LIMIT_MS / SEK) + ' s';
    if (klasa === 'nieprawidlowy') return 'SUBACK ' + hex(rc) + ' - niespójna odpowiedź' + b;
    if (klasa === 'mieszany') return 'SUBACK - wynik mieszany na drogach';
    return 'SUBACK - brak odpowiedzi: łącze przerwane' + b;
  };
  /* filtr MQTT pasuje do tematu (+ jeden poziom, # reszta) - gotowość dotyczy FILTRA, nie tematu */
  var mPasuje = function (f, t) {
    var a = f.split('/'), b = t.split('/');
    for (var i = 0; i < a.length; i++) { if (a[i] === '#') return true; if (i >= b.length || (a[i] !== '+' && a[i] !== b[i])) return false; }
    return a.length === b.length;
  };
  /* GOTOWOŚĆ SUBSKRYPCJI OSOBNO DLA KAŻDEJ DROGI  [Sol S18, 01.10.2026]
     WEJŚCIA:  st.sub (żądane filtry: qos, rewizja, chce), D.sub (ostatnia próba filtra na drodze), operacje st.ops.
     CO Z CZEGO WYNIKA:
       • połączenie MQTT (CONNACK), możliwość publikacji i możliwość ODBIORU filtra to trzy różne rzeczy - D.stan 'ok'
         nie znaczy „wszystkie filtry gotowe”; filtr jest gotowy na drodze dopiero po jej grancie dla AKTUALNEJ
         rewizji, w aktualnej generacji i u aktualnego klienta (_mGotowyFiltr);
       • KAŻDE subscribe/unsubscribe podnosi rewizję filtra; unsubscribe zostawia nagrobek (chce: false), więc SUBACK
         wcześniejszego zapisu nie przywraca gotowości;
       • jeden dispatcher (_mSubNaDrodze) obsługuje zapis z aplikacji i odtworzenie na drodze, która dołącza/wraca; próba
         dołączającej drogi dopina się do operacji tej samej rewizji, która jeszcze czeka - jej grant ją kończy;
       • POLITYKA (propozycja Sola, do zatwierdzenia przez Tomasza): grant dowolnej aktualnej drogi = jeden sukces
         Paho; odmowa jednej drogi NIE kończy operacji, dopóki inna droga (połączona albo właśnie się łącząca) może
         jeszcze dać grant; komplet odmów albo termin (S17) = onFailure; reconnect nie przedłuża terminu; wynik po
         końcu operacji aktualizuje już tylko gotowość drogi;
       • wyjątek synchroniczny subscribe() jednego filtra = wynik 'transport' tej próby, reszta odtwarza się dalej.
     WYJŚCIA:  stan filtra na drodze (czeka/grant/acl/broker/transport/nieprawidlowy), _mGotowyTemat(st, D, temat),
               onSuccess/onFailure aplikacji raz.
     ⚠ Gotowość NIE daje gwarancji deduplikacji odbioru: dwie odrębne publikacje o tej samej treści rozróżni tylko
       tożsamość producenta/żądania (S20), nie gotowość tematów. */
  Client.prototype._mGotowyFiltr = function (st, D, f) {
    var w = st.sub.get(f), p = D.sub.get(f);
    return !!(w && w.chce && p && p.rev === w.rev && p.gen === D.gen && p.k === D.k && D.k && p.stan === 'grant');
  };
  Client.prototype._mGotowyTemat = function (st, D, t) {
    var ja = this, jest = false;
    st.sub.forEach(function (w, f) { if (!jest && w.chce && mPasuje(f, t) && ja._mGotowyFiltr(st, D, f)) jest = true; });
    return jest;
  };
  /* próba dopina się do operacji SUBSCRIBE tego filtra i tej rewizji, które jeszcze czekają */
  Client.prototype._mDolacz = function (st, p) {
    st.ops.forEach(function (op) { if (!op.koniec && op.rodzaj === 'sub' && op.temat === p.temat && op.rev === p.rev && op.proby.indexOf(p) < 0) op.proby.push(p); });
  };
  Client.prototype._mOpsZProba = function (st, p) {
    var ja = this;
    Array.from(st.ops.values()).forEach(function (op) { if (op.proby.indexOf(p) >= 0) ja._mOpOcen(st, op); });
    if (p.D === st.tls) this._mPrzejmij(st);   /* [Sol S22] grant TLS może kończyć przejęcie odbioru */
  };
  Client.prototype._mOpsOcen = function (st) {
    var ja = this;
    Array.from(st.ops.values()).forEach(function (op) { ja._mOpOcen(st, op); });
  };
  Client.prototype._mSubNaDrodze = function (st, D, temat, wpis) {
    if (!wpis.chce || D.stan !== 'ok' || !D.k) return null;
    var ja = this, juz = D.sub.get(temat);
    /* ta sama rewizja już wysłana tą drogą w tej generacji (czeka albo ma grant) - bez drugiej identycznej próby */
    if (juz && juz.rev === wpis.rev && juz.gen === D.gen && juz.k === D.k && (juz.stan === 'czeka' || juz.stan === 'grant')) { this._mDolacz(st, juz); return juz; }
    var p = { D: D, gen: D.gen, k: D.k, temat: temat, rev: wpis.rev, stan: 'czeka', rc: null, blad: null };
    D.sub.set(temat, p);
    this._mDolacz(st, p);
    try {
      D.k.subscribe(temat, { qos: wpis.qos }, function (blad, dane, pakiet) {
        if (!ja._mProbaZywa(st, D, p.gen, p.k) || p.stan !== 'czeka') return;   /* stara sesja / stara próba drogi */
        var w = mSubKlasa(blad, dane, pakiet);
        p.stan = w.stan; p.rc = w.rc; p.blad = blad || null;      /* najpierw stan drogi, potem operacje */
        /* [Sol S19] transport (bez SUBACK): MQTT.js oddaje „Connection closed” TUŻ PRZED zdarzeniem close tej drogi -
           ocena po bieżącym zdarzeniu, żeby utrata OBU dróg skończyła się samym onConnectionLost (operacje anuluje
           _mKoniec), a nie onFailure „odmowa” pół chwili wcześniej */
        if (w.stan === 'transport') setTimeout(function () { if (ja._m === st && !st.martwa) ja._mOpsZProba(st, p); }, 0);
        else ja._mOpsZProba(st, p);
      });
    } catch (e) { p.stan = 'transport'; p.blad = e; this._mOpsZProba(st, p); }   /* wyjątek jednego filtra nie zatrzymuje reszty */
    return p;
  };
  /* OCENA OPERACJI. SUBSCRIBE (polityka S18 wyżej): grant którejkolwiek próby = sukces; porażka dopiero, gdy żadna
     droga-kandydat (połączona z próbą w toku albo właśnie się łącząca) nie może już dać grantu. UNSUBSCRIBE (jak przed
     S17): pierwszy sukces rozstrzyga, same błędy = onFailure. */
  Client.prototype._mOpOcen = function (st, op) {
    if (op.koniec) return;
    if (op.rodzaj === 'unsub') {
      if (op.proby.some(function (p) { return p.stan === 'kod'; })) { this._mOperacjaKoniec(st, op, { ok: true, paho: {} }); return; }
      if (op.proby.some(function (p) { return p.stan === 'czeka'; })) return;
      var ou = op.proby[op.proby.length - 1];
      this._mOperacjaKoniec(st, op, { ok: false, paho: { errorCode: 0, errorMessage: ou && ou.blad ? String(ou.blad.message || ou.blad) : 'UNSUBACK - drogi zamknięte' } });
      return;
    }
    var grant = op.proby.filter(function (p) { return p.stan === 'grant'; })[0];
    /* [Sol S19] sukces niesie `drogi` - odmowa drugiej drogi zostaje widoczna jako jej ograniczenie */
    if (grant) { this._mOperacjaKoniec(st, op, { ok: true, paho: { grantedQos: [grant.rc], drogi: this._mSubDrogi(st, op, false) } }); return; }
    var czeka = [st.tls, st.quic].some(function (D) {
      if (!D.k) return false;                                   /* droga leży - wróci przez dispatcher, jeśli zdąży */
      if (D.stan === 'laczy') return true;                      /* właśnie się łączy - może jeszcze dać grant */
      return op.proby.some(function (p) { return p.D === D && p.gen === D.gen && p.k === D.k && p.stan === 'czeka'; });
    });
    if (czeka) return;
    this._mSubPorazka(st, op, false);
  };
  Client.prototype._mSubskrybuj = function (temat, o) {
    var st = this._m, qos = o.qos || 0, ja = this;
    var wpis = st.sub.get(temat) || { qos: qos, rev: 0, chce: false };
    wpis.qos = qos; wpis.rev = ++st.subRev; wpis.chce = true; st.sub.set(temat, wpis);   /* [Sol S18] nowa rewizja */
    var drogi = [st.quic, st.tls].filter(function (D) { return D.stan === 'ok' && D.k; });
    if (!drogi.length) throw new Error('AMQJS0011E Invalid state not connected.');
    var op = this._mOperacjaNowa(st, 'sub', temat, o); op.rev = wpis.rev;
    drogi.forEach(function (D) { ja._mSubNaDrodze(st, D, temat, wpis); });
    this._mOpOcen(st, op);              /* wszystkie próby rzuciły od razu - porażka bez czekania na termin */
  };
  Client.prototype._mOdsubskrybuj = function (temat, o) {
    var st = this._m, ja = this;
    /* [Sol S18] NAGROBEK, nie zapomnienie: nowa rewizja i chce=false - spóźniony SUBACK wcześniejszego zapisu nie
       przywróci gotowości, a ponowny zapis dostanie rewizję, której żaden stary SUBACK nie miał */
    var wpis = st.sub.get(temat);
    if (wpis) { wpis.chce = false; wpis.rev = ++st.subRev; }
    var drogi = [st.quic, st.tls].filter(function (D) { return D.stan === 'ok' && D.k; });
    if (!drogi.length) throw new Error('AMQJS0011E Invalid state not connected.');
    var op = this._mOperacjaNowa(st, 'unsub', temat, o);
    drogi.forEach(function (D) {
      var p = ja._mProba(st, op, D);
      D.k.unsubscribe(temat, function (blad) {
        if (!ja._mProbaZywa(st, D, p.gen, p.k) || p.stan !== 'czeka') return;
        if (blad) { p.stan = 'transport'; p.blad = blad; } else p.stan = 'kod';
        ja._mOpOcen(st, op);
      });
    });
  };

  /* ZAMKNIĘCIA. _mZamknij - jedna droga, bez zdarzeń (generacja drogi w górę). _mZamknijWszystko - koniec sesji.
     _mKoniec - koniec sesji + JEDNO zdarzenie dla aplikacji. _mRozlacz - disconnect() aplikacji. _mStop - wycofanie bez słowa. */
  /* [zadanie 12 (e)] `kara` = porzucone uzgodnienie WebTransport tej drogi liczy się jak porażka QUIC (zombie w kolejce
     przeglądarki, docs/36 §11 K1b): koniec sesji bez połączenia (nowe connect() w trakcie, disconnect() w trakcie próby)
     i utrata obu dróg. BEZ kary: aplikacja zamknęła sesję, która działała drugą drogą (np. logowanie po sukcesie TLS - wtedy
     dzierżawa w gnieździe trzyma punkt do terminu, a HMI nie dokłada próby), przełącznik serwisu, odmowa logowania. */
  Client.prototype._mZamknij = function (st, D, grzecznie, kara) {
    if (D === st.quic && D.k && D.stan === 'laczy' && !D.wtGotowe) {
      DIAG.wt_porzucone++; zdarzenie(D.gen, 'WT_PORZUCONA', kara ? 'koniec sesji w trakcie uzgodnienia' : 'bez kary - sesja działała drugą drogą / decyzja człowieka');
      if (kara) quicZapamietaj(st.ep, 'proba WebTransport porzucona w trakcie uzgodnienia');
    }
    D.gen++; clearTimeout(D.zegar); clearTimeout(D.ponow); D.zegar = D.ponow = null;
    clearInterval(D.pubStraz); D.pubStraz = null;   /* [zadanie 11] */
    var k = D.k, bylaOk = D.stan === 'ok'; D.k = null; D.stan = 'stop';
    if (k) { try { k.end(!(grzecznie && bylaOk)); } catch (e) {} }
    /* [Sol S17] próby tej drogi = transport (generacja już w górę, więc ich wywołania zwrotne z end() milczą) */
    if (k && this._m === st && !st.martwa) this._mProbyDrogiPadly(st, D, k);
  };
  Client.prototype._mZamknijWszystko = function (st, grzecznie, kara) {
    st.martwa = true; clearInterval(st.straz); clearTimeout(st.przejmijZegar);
    /* [Sol S17] NAJPIERW anulować operacje (bez wywołań aplikacji, zegary stop), DOPIERO POTEM end() klientów */
    var ja = this;
    Array.from(st.ops.values()).forEach(function (op) { ja._mOperacjaKoniec(st, op, null, true); });
    this._mZamknij(st, st.quic, grzecznie, kara); this._mZamknij(st, st.tls, grzecznie);
    ZYWE.delete(this);
    if (this._m === st) { this._m = null; this._polaczony = false; }
  };
  Client.prototype._mKoniec = function (st, jak, r) {
    if (st.martwa) return;
    var o = st.o;
    this._mZamknijWszystko(st, false, jak === 'utrata');   /* utrata obu dróg: uzgodnienie QUIC w toku kosztuje */
    if (jak === 'porazka') { if (o.onFailure) o.onFailure({ errorCode: r.errorCode, errorMessage: r.errorMessage, invocationContext: o.invocationContext }); return; }
    if (this.onConnectionLost) this.onConnectionLost(r);
  };
  Client.prototype._mRozlacz = function () {
    var st = this._m, byl = st.polaczony;
    this._mZamknijWszystko(st, true, !byl); this._gen++;   /* disconnect() w trakcie próby = porzucenie z karą */
    if (byl && this.onConnectionLost) this.onConnectionLost({ errorCode: 0, errorMessage: 'AMQJS0000I OK.' });
  };
  Client.prototype._mStop = function () { if (this._m) this._mZamknijWszystko(this._m, false, true); };   /* nowe connect() w trakcie */

  /* PRZEŁĄCZNIK OD RĘKI (serwis aplikacji): sam TLS - QUIC zamykany, gdy TLS stoi (inaczej zaraz po jego wstaniu);
     mariaż - QUIC dołącza od razu, ale przez wspólny warunek [zadanie 12]: przełącznik to wybaczenie pamięci porażki
     w TYM SAMYM budżecie co zmiana sieci (raz na przerwę), a dzierżawa innej karty obowiązuje - inaczej przełącznik
     „tam i z powrotem” byłby furtką do serii prób WebTransport. Wstrzymany QUIC = zdanie `uwaga` dla serwisu.
     ⛔ QUIC NIE JEST ZAMYKANY, GDY JEST JEDYNĄ ŻYWĄ DROGĄ [sceptyk 01.10, X3]: aplikacja zostałaby „połączona" bez
       łącza - send() rzuca wyjątek, a onConnectionLost nie przychodzi (aplikacja nie łączy od nowa). Zamiast tego:
       TLS próbuje od razu, QUIC zamyka _mPolaczona, gdy TLS wstanie. Zwraca zdanie dla serwisu (zasada 10) albo nic. */
  Client.prototype._mTryb = function (t) {
    var st = this._m;
    if (!st || st.martwa || st.tryb === t) return '';
    st.tryb = t;
    if (t === 'tls') {
      if (st.tls.stan === 'ok' && this._mTlsPrzejelo(st)) { this._mZamknij(st, st.quic, true); this._mLog('serwis: sam TLS - QUIC zamknięty'); return ''; }
      if (st.tls.stan === 'ok') { this._mLog('serwis: sam TLS - QUIC zamknę, gdy TLS przyjmie tematy'); this._mPrzejmij(st); return ''; }   /* [Sol S22] */
      clearTimeout(st.quic.ponow); st.quic.ponow = null;
      this._mLog('serwis: sam TLS - QUIC zamknę, gdy wstanie TLS');
      if (!st.tls.k && st.polaczony) { st.tls.ponowNr = 0; this._mDroga(st, st.tls); }
      return st.quic.stan === 'ok' ? 'TLS w tej chwili nie stoi — QUIC zostaje, dopóki TLS nie wstanie' : '';
    }
    this._mLog('serwis: mariaż QUIC + TLS - dołączam QUIC');
    quicZapomnij('serwis'); st.bezWT = false;
    if (this._mQuicStart(st, true) || st.quic.k || !window.WebTransport) return '';
    var w = czyWolnoProbowacQUIC(st.ep);
    return w.wolno ? '' : 'QUIC wstrzymany (' + w.powod + ', ochrona przed karą przeglądarki) — dołączy ' + kiedyPonow(w.za_ms) + '; dane idą TLS';
  };
  /* ZDROWIE DROGI DLA SERWISU  [Sol S22]: stan połączenia, filtry AKTUALNEJ rewizji/generacji (gotowe, czekają, odmowy
     brokera, bez odpowiedzi), wiek ostatniej wiadomości, próby połączenia, odmowy logowania, ostatni błąd - BEZ kont,
     haseł, identyfikatorów klienta i treści. Obserwacja, nie podstawa decyzji (decyzje: S17-S19). */
  var mPodsumujDroge = function (ja, st, D, teraz) {
    var gotowe = 0, czeka = 0, odmowy = 0, inne = 0;
    st.sub.forEach(function (w, f) {
      if (!w.chce) return;
      var p = D.sub.get(f);
      if (!p || p.rev !== w.rev || p.gen !== D.gen || p.k !== D.k || !D.k) return;
      if (p.stan === 'grant') gotowe++; else if (p.stan === 'czeka') czeka++; else if (p.stan === 'acl' || p.stan === 'broker') odmowy++; else inne++;
    });
    return { polaczenie: D.stan, filtry_gotowe: gotowe, filtry_czekaja: czeka, filtry_odmowy: odmowy, filtry_bez_odpowiedzi: inne,
             odbior_wiek_s: D.ostOdbior && D.stan === 'ok' ? Math.max(0, (teraz - D.ostOdbior) / SEK) : null,
             proby: D.prob, odmowy_logowania: D.odmowy, blad: D.blad ? krotko(D.blad) : null,
             puback_czeka: D.pub && D.k ? D.pub.size : 0,      /* [zadanie 11] publikacje tej drogi bez PUBACK */
             wstrzymany: D === st.quic && !D.k && st.ep ? (function () { var w = czyWolnoProbowacQUIC(st.ep); return w.wolno ? null : w.powod; })() : null };
  };
  /* do sond, prób i serwisu: co się dzieje na drogach (bez kont i haseł) */
  Client.prototype.stanDrog = function () {
    var st = this._m, teraz = Date.now();
    if (!st) return { tryb: drogaTryb(), mariaz: false };
    return { tryb: st.tryb, mariaz: true, tls: st.tls.stan, quic: st.quic.stan, kopie: st.kopie,
             pierwsze_tls: st.pierwsze.tls, pierwsze_quic: st.pierwsze.quic,
             szczegoly: { tls: mPodsumujDroge(this, st, st.tls, teraz), quic: mPodsumujDroge(this, st, st.quic, teraz) } };   /* [Sol S22] */
  };

  window.Paho = { Client: Client, Message: Message, MQTT: { Client: Client, Message: Message } };
  window.Paho._WTjakoWS = WTjakoWS;   /* [Astra 11] test offline (_test_polaczenie11.html) ORAZ strona pomiaru apka3/pomiar.html (karta 36: QUIC przez WebTransport) — NIE USUWAĆ; pilnują K2 w proba_pomiar36.cjs i zbuduj_pwa.py --apka3 */
  window.Paho.MQTT_WERSJA = 5;   /* apka3 może pokazać, którą drogą idzie */
  /* [audyt WT 02.10, zadanie 11] liczniki + dziennik zdarzeń (dziennik tylko z flagą aqr_diag_wt=1); kopia, nie żywe obiekty */
  window.Paho._diagWT = function () {
    return { liczniki: JSON.parse(JSON.stringify(DIAG)), dziennik_wlaczony: diagWlaczona(), zdarzenia: DZ.slice(),
             wt_puback_limit_s: WT_PUBACK_LIMIT_S, quic_limit_s: QUIC_LIMIT_S, quic_przerwa_min: QUIC_PRZERWA_MIN,
             pamiec: (function () { var o = {}; pamPunkty().forEach(function (ep) { o[ep] = pamStanJawny(ep); }); return o; })() };
  };
  /* [zadanie 12] stan pamięci porażki i dzierżawy punktu połączenia - do diagnostyki i prób offline; wyczysc() TYLKO
     dla prób (_test_*.html: czysty start scenariusza). Bez haseł i kont. NIE do logiki aplikacji. */
  var pamStanJawny = function (ep) {
    var r = pamCzytaj(ep), m = mono();
    return { zostalo_ms: pamZostalo(ep), porazka_temu_ms: r.porazka === null ? null : Math.round(m - r.porazka),
             wybaczono_temu_ms: r.wybaczono === null ? null : Math.round(m - r.wybaczono), powod: r.powod, dzierzawa_innej_ms: dzInnej(ep) };
  };
  window.Paho._quicPamiec = {
    stan: pamStanJawny,
    wolno: function (ep) { return czyWolnoProbowacQUIC(ep); },
    karta: KARTA,
    wyczysc: function () {
      PAM = {};
      try { for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i);
              if (k && (k.indexOf(KL_PAM) === 0 || k.indexOf(KL_DZ) === 0)) localStorage.removeItem(k); } } catch (e) {}
    },
  };
  /* [B.0z-78] PRZEŁĄCZNIK „QUIC + TLS naraz / sam TLS" dla serwisu aplikacji (panel4_serwis.html - wiersz tylko w aplikacji
     z tą nakładką). Zapamiętany w telefonie (localStorage z przedrostkiem aplikacji); działa OD RĘKI na żywych klientach
     dwóch dróg (_mTryb), a na pozostałych przy następnym connect(). Odpowiedź zawsze z opisem (zasada 10);
     `uwaga` = zdanie, gdy „sam TLS" nie mógł od ręki zamknąć QUIC, bo ten był jedyną żywą drogą (X3). */
  window.Paho.droga = {
    tryb: drogaTryb,
    quicMozliwy: function () { return !!window.WebTransport; },
    /* [Sol S22] zdrowie dróg żywych klientów dwóch dróg - dla wiersza „Łącze aplikacji” w serwisie */
    stan: function () { var d = []; ZYWE.forEach(function (k) { try { d.push(k.stanDrog()); } catch (e) {} }); return { tryb: drogaTryb(), drogi: d }; },
    ustaw: function (t) {
      if (t !== 'mariaz' && t !== 'tls') return { ok: false, zapamietane: false, opis: 'nieznany tryb drogi: ' + t };
      trybJawny = t;
      var zap = false;
      try { localStorage.setItem(KLUCZ('droga'), t); zap = localStorage.getItem(KLUCZ('droga')) === t; } catch (e) {}
      try { sessionStorage.removeItem(KLUCZ('droga_proba')); } catch (e) {}
      var uwaga = '';               /* [X3] zdanie dla serwisu, gdy przełącznik nie zadziałał w pełni od ręki */
      ZYWE.forEach(function (k) { try { uwaga = k._mTryb(t) || uwaga; } catch (e) {} });
      return { ok: true, zapamietane: zap, opis: t === 'mariaz' ? 'QUIC + TLS naraz' : 'sam TLS', uwaga: uwaga };
    },
  };
})();

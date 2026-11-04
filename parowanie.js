/* ============================================================
 *  parowanie.js — PAROWANIE TELEFONU KODEM QR Z DRZWI SZAFY (aplikacja apka3, broker v5)  [D-554, docs/57, 07.10.2026]
 * ============================================================
 *  SPIS: [1] stałe i teksty (zasada 10 - każda odmowa ma zdanie; szkic do korekty Tomasza)  [2] odczyt kodu z adresu
 *        [3] przebieg: prośba -> nowe hasło -> zapis -> potwierdzenie -> sprawdzenie nowego hasła  [4] eksport
 *
 *  WEJŚCIA:  fragment adresu `#p=<base64url JSON {v,h,k,p,o}>` z kodu QR (Manager → „Kod parowania”); klient MQTT w API Paho
 *            (nakładka MQTT 5, `paho_na_mqttjs.js`); magazyn logowania strony startowej; zegar - wszystko WSTRZYKIWANE
 *            (strona podaje prawdziwe, test node - atrapy).
 *  CO Z CZEGO WYNIKA: fragment czytamy RAZ i od razu zdejmujemy z paska adresu i historii (niesie hasło z naklejki). Łączymy się
 *            kontem z kodu - ono widzi TYLKO swoje tematy parowania; subskrypcja `parowanie/<konto>/odp`, prośba z losowym id.
 *            Odpowiedź z TYM id (drugi telefon na tej samej naklejce dostaje swoje) niesie NOWE hasło: zapisujemy logowanie
 *            jak przy „zapamiętaj” (D-550 pkt 3) z JAWNYM tematem obiegu (konto `tel-…` nie mówi, który to obiekt) i publikujemy
 *            potwierdzenie; Manager dopiero wtedy zmienia hasło i nadaje rolę klienta. Na koniec logowanie nowym hasłem,
 *            ponawiane co PONOW_MS do CZAS_POWROTU_MS: działa = HMI; nie działa = zapis usunięty, kod z naklejki nadal ważny.
 *            Pierwsze połączenie zostaje otwarte do końca - nakładka nie zgłasza doręczenia, a potwierdzenie musi wyjść.
 *  WYJŚCIA:  Promise {ok, tekst}; zdanie na stronie; zapis logowania; przejście do HMI (o.dalej).
 *  ⚠ Bez kryptografii po stronie aplikacji: izolację daje broker (konto parowania widzi tylko własne tematy), drogę - TLS.
 * ============================================================ */
(function (glob) {
  'use strict';
  /* ---------------------------------------------------------------- [1] stałe i teksty */
  const WERSJA = 1;
  const CZAS_ODP_MS = 20000;        /* tyle czekamy na nowe hasło od Managera */
  const CZAS_POWROTU_MS = 15000;    /* tyle próbujemy logowania nowym hasłem po potwierdzeniu */
  const PONOW_MS = 2000;
  const PREFIKS_OBIEGU = 'obiekt/';
  const TEKSTY = {
    zly: 'To nie jest kod parowania AquaReact (uszkodzony albo z innego produktu).',
    trwa: n => 'Paruję telefon z: ' + n + '…',
    uzyty: 'Ten kod z szafy został już użyty albo wycofany. Nowy kod daje serwis (Manager → Kod parowania).',
    brakSerwera: 'Serwer parowania nie odpowiada. Sprawdź internet i spróbuj za chwilę — kod nadal jest ważny.',
    niePotwierdzone: 'Serwer nie potwierdził parowania. Zeskanuj kod z szafy jeszcze raz — kod nadal jest ważny.',
    ok: n => 'Sparowano z: ' + n + '. Telefon zapamiętał dostęp.',
  };

  /* ---------------------------------------------------------------- [2] odczyt kodu z adresu */
  const jest = hash => typeof hash === 'string' && hash.indexOf('#p=') === 0;

  function zBase64url(s) {
    s = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = glob.atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new glob.TextDecoder().decode(u8);
  }

  /* -> {v, h, k, p, o} albo null; każde pole sprawdzone - zły kod nie może zacząć łączenia z przypadkowym adresem */
  function odczytaj(hash) {
    if (!jest(hash)) return null;
    let d = null;
    try { d = JSON.parse(zBase64url(hash.slice(3))); } catch (e) { return null; }
    if (!d || d.v !== WERSJA) return null;
    if (typeof d.h !== 'string' || !/^[A-Za-z0-9.-]+:\d{2,5}$/.test(d.h)) return null;
    if (typeof d.k !== 'string' || !/^tel-[a-z0-9]{8}$/.test(d.k)) return null;
    if (typeof d.p !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(d.p)) return null;
    if (typeof d.o !== 'string' || !/^obiekt\/[a-z0-9][a-z0-9-]{0,62}$/.test(d.o)) return null;
    return d;
  }

  const adres = h => { const i = h.lastIndexOf(':'); return { host: h.slice(0, i), port: +h.slice(i + 1) }; };
  const nazwa = o => o.slice(PREFIKS_OBIEGU.length);

  /* ---------------------------------------------------------------- [3] przebieg */
  /*  o = { hash, Klient, Wiadomosc, pokaz(klasa, tekst), zapisz(dane | null), czysc(), dalej(), losujId(), teraz(),
          ustawCzas(f, ms), wyczyscCzas(t), [czasOdp, czasPowrotu, ponow] } */
  function uruchom(o) {
    return new Promise(gotowe => {
      let skonczone = false, k1 = null, nrProby = 0;
      const czasy = [];
      const czas = (f, ms) => { const t = o.ustawCzas(f, ms); czasy.push(t); return t; };
      const zamknij = k => { try { if (k) k.disconnect(); } catch (e) { /* już rozłączony */ } };
      const koniec = (ok, klasa, tekst) => {
        if (skonczone) return;
        skonczone = true;
        czasy.forEach(t => o.wyczyscCzas(t));
        if (!ok) zamknij(k1);
        o.pokaz(klasa, tekst);
        gotowe({ ok, tekst });
      };

      const d = odczytaj(o.hash);
      o.czysc();                                   /* hasło z naklejki znika z paska adresu i historii ZANIM cokolwiek dalej */
      if (!d) return koniec(false, 'zle', TEKSTY.zly);
      const n = nazwa(d.o), a = adres(d.h), id = String(o.losujId());
      const temat = r => 'parowanie/' + d.k + '/' + r;
      o.pokaz('', TEKSTY.trwa(n));
      const tOdp = czas(() => koniec(false, 'zle', TEKSTY.brakSerwera), o.czasOdp || CZAS_ODP_MS);

      const wyslij = (rodzaj, tresc) => {
        const m = new o.Wiadomosc(JSON.stringify(tresc));
        m.destinationName = temat(rodzaj); m.qos = 1;
        k1.send(m);
      };

      /*  Sprawdzenie nowego hasła: Manager zmienia je dopiero po potwierdzeniu (Dynamic Security ~2 s) - ponawiamy. */
      const sprawdz = haslo => {
        const t0 = o.teraz();
        const sproboj = () => {
          if (skonczone) return;
          let k2;
          try { k2 = new o.Klient(a.host, a.port, '/mqtt', 'par2-' + id + '-' + (++nrProby)); } catch (e) { return dalejCzy(); }
          try {
            k2.connect({ useSSL: true, userName: d.k, password: haslo, timeout: 7, cleanSession: true,
              onSuccess: () => { zamknij(k2); zamknij(k1); koniec(true, 'ok', TEKSTY.ok(n)); o.dalej(); },
              onFailure: () => dalejCzy() });
          } catch (e) { dalejCzy(); }
        };
        const dalejCzy = () => {
          if (skonczone) return;
          if (o.teraz() - t0 >= (o.czasPowrotu || CZAS_POWROTU_MS)) {
            o.zapisz(null);                        /* zapis z hasłem, którego serwer nie przyjął, tylko by mylił */
            return koniec(false, 'zle', TEKSTY.niePotwierdzone);
          }
          czas(sproboj, o.ponow || PONOW_MS);
        };
        czas(sproboj, o.ponow || PONOW_MS);
      };

      try { k1 = new o.Klient(a.host, a.port, '/mqtt', 'par-' + id); } catch (e) { return koniec(false, 'zle', TEKSTY.brakSerwera); }
      let maHaslo = false;
      k1.onMessageArrived = m => {
        if (skonczone || maHaslo || m.destinationName !== temat('odp')) return;
        let j = null;
        try { j = JSON.parse(m.payloadString); } catch (e) { return; }
        if (!j || j.v !== WERSJA || j.id !== id || typeof j.haslo !== 'string' || !j.haslo) return;   /* nie nasza odpowiedź */
        maHaslo = true;
        o.wyczyscCzas(tOdp);
        const obiegi = (Array.isArray(j.obiegi) && j.obiegi.length ? j.obiegi : [j.o || d.o])
          .filter(x => typeof x === 'string' && x.indexOf(PREFIKS_OBIEGU) === 0);
        const glowny = obiegi[0] || d.o;
        o.zapisz({ host: d.h, user: d.k, pass: j.haslo, nazwa: nazwa(glowny), serwis: false,
                   temat: glowny, tematy: obiegi.length ? obiegi : [glowny], obiekt: obiegi.length > 1 ? null : glowny,
                   host2: '', user2: '', pass2: '', host3: '', user3: '', pass3: '',
                   parowanie: { konto: d.k, kiedy: o.teraz() } });
        try { wyslij('potw', { v: WERSJA, id }); } catch (e) { /* bez połączenia Manager nie zmieni hasła - wykaże to sprawdzenie */ }
        sprawdz(j.haslo);
      };
      try {
        k1.connect({ useSSL: true, userName: d.k, password: d.p, timeout: 7, cleanSession: true,
          onSuccess: () => {
            if (skonczone) return;
            try {
              k1.subscribe(temat('odp'), { qos: 1,
                onSuccess: () => { try { wyslij('prosba', { v: WERSJA, id }); } catch (e) { koniec(false, 'zle', TEKSTY.brakSerwera); } },
                onFailure: () => koniec(false, 'zle', TEKSTY.brakSerwera) });
            } catch (e) { koniec(false, 'zle', TEKSTY.brakSerwera); }
          },
          onFailure: r => {
            /* kod OD BROKERA jest w treści („return code: N”, nakładka mapuje MQTT 5 na 3.1.1): 4 i 5 = konto nie wpuszczone
               = hasło z naklejki już nie działa = kod użyty albo wycofany. Inaczej - droga, nie konto. */
            const m = /return code:\s*(\d)/i.exec((r && r.errorMessage) || '');
            const rc = m ? +m[1] : null;
            koniec(false, 'zle', (rc === 4 || rc === 5) ? TEKSTY.uzyty : TEKSTY.brakSerwera);
          } });
      } catch (e) { koniec(false, 'zle', TEKSTY.brakSerwera); }
    });
  }

  /* ---------------------------------------------------------------- [4] eksport */
  const PAROWANIE = { WERSJA, TEKSTY, jest, odczytaj, uruchom, CZAS_ODP_MS, CZAS_POWROTU_MS, PONOW_MS };
  glob.PAROWANIE = PAROWANIE;
  if (typeof module !== 'undefined' && module.exports) module.exports = PAROWANIE;
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================================================================
 *  wykres_temp.js — WYKRES TEMPERATURY WODY W APLIKACJI T3  [Tomasz 27/28.09.2026: „wypasiony wykres temperatury…
 *  ładne opisanie osi, trend, zakres 1h 24h 7d, renderowany z efektami, przenikaniem” · prototyp zatwierdzony: „jest, wydaj T3”]
 * ============================================================================================================
 *  WEJŚCIA:  wiadomości `swiat` z most_js.js (te same, które rysuje hala): d.temp, d.temp_set, d.grzeje,
 *            d.poziomStan.pompa, d.obieg_nr, d.awtemp; w tle także d.cis, d.poziom (+ d.awmano, d.awsonda, d.obejscia);
 *            nazwa obiektu z pakietu klienta chmury (podpięcie pod MOST_JS.startMqtt).
 *  CO ROBI:  (1) co minutę zapisuje próbkę w pamięci telefonu (localStorage, 7 dni na obiekt i obieg) - temperaturę,
 *                a od 28.09 w tle także ciśnienie i poziom (rysowane w następnej wersji, B.0z-72);
 *            (2) w kaflu temperatury dokłada ikonę wykresu (nakładka - układ kafli bez zmian, dotknięcie reszty
 *                kafla dalej otwiera nastawę); (3) karta wykresu - zakresy 1 h / 24 h / 7 dni z przenikaniem,
 *                trend °C/h, prognoza dojścia do zadanej, pasy grzania i postoju pompy.
 *            [28.09, Tomasz: „wykresy umieść między harmonogram a alarmy i zdarzenia”] karta żyje w bloczku
 *                „wykresy” hali (window.WYKRES.osadz, ekranWykresy), ikona prowadzi tam (wykresyOtworz);
 *                okno na wierzchu (otworz) zostaje tylko dla strony bez hali.
 *            [D-511, 30.09: „pobrała i trzymała dane ze sterownika KOMPLETNE”] (4) HISTORIA ZE STEROWNIKA: najpierw
 *                baza w telefonie (IndexedDB, MOST_JS.historia.czytaj - rysuje od razu), potem dociąganie od ostatniej
 *                próbki (MOST_JS.historia.dociagnij, strumień `historia:` po MQTT); pierwsze pobranie z paskiem postępu
 *                w karcie; każdy kawałek wlewa `dolozHistorie()`. Dociąga przy starcie, przy otwarciu wykresu i po
 *                powrocie z tła (>5 min). Starsza aplikacja / sterownik bez historii = wykres jak dotąd z telefonu.
 *  WYJŚCIA:  ekran; jedyna wysyłka to prośba `historia:` (przez most_js.js - poziom klienta, bez PIN-u, D-511).
 *  ⚠ HISTORIA Z TELEFONU zostaje (zbiera co minutę z `swiat`) - przy sterowniku z historią jest tylko uzupełnieniem;
 *    dane sterownika wygrywają przy tej samej minucie (0,01 °C zamiast 0,1 °C z bloku).
 *  ⚠ Moduł jest dołączany tylko do apki (zbuduj_pwa.py --apka3); makieta hali i generator LVGL go nie widzą.
 * ============================================================================================================ */
(function () {
  'use strict';
  if (window.__wykresTemp) return; window.__wykresTemp = true;
  const MIN = 60000, GODZ = 60 * MIN, DOBA = 24 * GODZ, TRZYMAJ = 7 * DOBA;
  const PREF = (window.APKA_KLUCZ || 'apka') + '_wykresT_';
  let obiekt = 'obiekt', obiektSurowy = null, ostatnie = null;   /* obiektSurowy = prefiks tematu (klucz bazy historii) */

  /* ---------------- [1] ZBIERANIE PRÓBEK ---------------- */
  /* ZAPIS ZWARTY [28.09, zmierzone sondą]: 7 dni po minucie w JSON to ~220 kB na obieg - konto serwisowe z kilkoma
     obiektami doszłoby do limitu localStorage (5 MB), a wtedy odmowę dostałby też zapis LOGOWANIA aplikacji. Tu: 4 znaki
     na próbkę (flagi a-d + temperatura×100 w base36 na 3 znakach), przerwa „!<minuty>.”, zmiana zadanej „z<×10>.”
     → ~40 kB na obieg i tydzień. Do tego limit łączny LIMIT_ZNAKOW: gdy przekroczony, najpierw wypada historia
     obiektu oglądanego najdawniej. Wykres jest pomocniczy - nigdy nie może zająć miejsca logowaniu. */
  const LIMIT_ZNAKOW = 1200000;
  /* SERIE [B.0z-72, Tomasz 28.09: „tak, zrób” - zbierać w tle już teraz]: ciśnienie i poziom zapisywane od tej wersji,
     rysowane w następnej (pasy pod wspólną osią czasu, ptaszki). Zapis = round(wartość × skala) + przesunięcie, w zakresie
     0..46655 (3 znaki base36). Temperatura zostaje pod DOTYCHCZASOWYM kluczem (bez przyrostka) - zebrana historia przechodzi.
     Poziom: i16 z bloku, po przesunięciu kalibracji bywa ujemny - stąd +5000 mm. Ciśnienie: w bloku bez znaku, bar × 100. */
  const SERIE = { temp: { sfx: '', skala: 100, przes: 0 }, cis: { sfx: '_cis', skala: 100, przes: 0 }, poz: { sfx: '_poz', skala: 1, przes: 5000 } };
  window.WYKRES_SERIE = SERIE;                               // dla następnej wersji i sond: jak odczytać zapis
  const klucz = (ob, sr = 'temp') => PREF + obiekt + '_' + ob + SERIE[sr].sfx;
  function koduj(p) {
    if (!p.length) return '';
    let s = '', pop = p[0][0] - 1, zad = -2;
    for (const [m, t, z, f] of p) {
      if (m - pop !== 1) s += '!' + (m - pop).toString(36) + '.';
      if (z !== zad) { s += 'z' + (z < 0 ? '' : z.toString(36)) + '.'; zad = z; }
      s += String.fromCharCode(97 + (f & 3)) + ('00' + Math.max(0, Math.min(46655, t)).toString(36)).slice(-3);
      pop = m;
    }
    return s;
  }
  /* [Astra 14, 29.09.2026] ROZBIÓR Z GRANICAMI. Dawniej marker „!”/„z” bez kropki dawał indexOf = -1, więc indeks
     wracał na 0 i pętla kręciła się bez końca (zawieszony ekran), a zła próbka (litera spoza a-d, ucięte 3 znaki)
     wchodziła do wykresu jako NaN albo ujemna flaga - udawała pomiar. Teraz: każdy krok PRZESUWA indeks albo KOŃCZY
     rozbiór; rekord sprawdzany przed użyciem (kropka w zasięgu, cyfry base36, flaga a-d, pełne 3 znaki, dodatnia
     przerwa, limit próbek); pierwszy błąd kończy serię - zostaje poprawny początek, a `blad` mówi gdzie i czemu.
     Następny zapis serii (co minutę) przepisuje ją bez uszkodzonego końca - naprawa bez udziału człowieka. */
  const MAX_PROBEK = 8 * 24 * 60;                            /* 7 dni po minucie + doba zapasu */
  function dekoduj(m0, s, blad) {
    const p = [];
    const zle = (opis, poz) => { if (blad) { blad.opis = opis; blad.poz = poz; blad.od = p.length ? p[p.length - 1][0] : null; } };
    if (typeof s !== 'string' || !Number.isFinite(m0)) { zle('zły nagłówek', 0); return p; }
    let m = m0 - 1, zad = -1, i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '!' || c === 'z') {
        const k = s.indexOf('.', i + 1);
        if (k < 0 || k - i > 9) { zle('znacznik bez kropki', i); break; }
        const v = s.slice(i + 1, k);
        if (v !== '' && !/^[0-9a-z]+$/.test(v)) { zle('znacznik z obcym znakiem', i); break; }
        if (c === '!') { const d = parseInt(v, 36); if (!(d >= 1)) { zle('zła przerwa', i); break; } m += d - 1; }
        else zad = v === '' ? -1 : parseInt(v, 36);
        i = k + 1;
        continue;
      }
      const f = c.charCodeAt(0) - 97, t = s.substr(i + 1, 3);
      if (f < 0 || f > 3 || !/^[0-9a-z]{3}$/.test(t)) { zle('zła próbka', i); break; }
      if (p.length >= MAX_PROBEK) { zle('za długi zapis', i); break; }
      m++; p.push([m, parseInt(t, 36), zad, f]); i += 4;
    }
    return p;
  }
  const uszkodzone = {};                                      /* klucz serii -> {opis, poz, od}: pokazywane w stopce karty */
  function wczytaj(ob, sr) {
    const k = klucz(ob, sr);
    try {
      const t = localStorage.getItem(k); const j = t ? JSON.parse(t) : null;
      if (!j || j.v !== 2) return [];
      const b = {}; const p = dekoduj(j.m0, j.s, b);
      if (b.opis) { uszkodzone[k] = b; console.warn('wykres: zapis ' + k + ' uszkodzony (' + b.opis + ', znak ' + b.poz + ') - biorę ' + p.length + ' poprawnych próbek'); }
      return p;
    } catch (e) { uszkodzone[k] = { opis: 'zapis nieczytelny', poz: 0, od: null }; return []; }
  }
  function zapisz(ob, p, sr = 'temp') {
    const k = klucz(ob, sr), txt = JSON.stringify({ v: 2, u: Date.now(), m0: p.length ? p[0][0] : 0, s: koduj(p) });
    try {
      let razem = txt.length; const inne = [];
      for (let i = 0; i < localStorage.length; i++) { const n = localStorage.key(i);
        if (n && n.indexOf(PREF) === 0 && n !== k && n !== PREF + 'zakres') { const v = localStorage.getItem(n) || ''; razem += v.length;
          const u = +((/"u":(\d+)/.exec(v.slice(0, 40)) || [0, 0])[1]); inne.push([u, n, v.length]); } }   // „u” jest na początku - bez parsowania 40 kB
      inne.sort((a, b) => a[0] - b[0]);
      while (razem > LIMIT_ZNAKOW && inne.length) { const [, n, dl] = inne.shift(); localStorage.removeItem(n); razem -= dl; }
      localStorage.setItem(k, txt);
    } catch (e) {}                                       // pełna pamięć albo tryb prywatny: wykres żyje z RAM
  }
  const pamiec = {};                                   // obiekt|ob|seria -> tablica [minuta, zapis, zadana*10, flagi]
  const seria = (ob, sr = 'temp') => { const k = obiekt + '|' + ob + '|' + sr; return (pamiec[k] = pamiec[k] || wczytaj(ob, sr)); };
  function dopisz(ob, sr, m, v, zad, flagi) {         // jedna próbka na minutę (zegar telefonu cofnięty = czekamy)
    const p = seria(ob, sr); if (p.length && p[p.length - 1][0] >= m) return false;
    const S = SERIE[sr]; p.push([m, Math.max(0, Math.min(46655, Math.round(v * S.skala) + S.przes)), zad, flagi]);
    const granica = m - TRZYMAJ / MIN; while (p.length && p[0][0] < granica) p.shift();
    zapisz(ob, p, sr); return true;
  }
  /* KTÓRY OBIEKT: pakiet `swiat` go nie niesie - nazwę ma zewnętrzny pakiet klienta chmury (`d.obiekt`, most_js.js
     wspolne()). Podpinamy się pod startMqtt zanim hala go wywoła (hala startuje po doładowaniu biblioteki MQTT,
     czyli po tym skrypcie). Konto serwisowe przełącza obiekty - bez tego historie różnych basenów by się zlały.
     ⛔ Nie czytać nazwy z listy wyboru na pasku: przed pierwszą paczką stoi tam „czekam…” (sonda 28.09 zapisała
     historię pod obiektem „czekam__”). */
  const nazwa = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, '_');
  const M = window.MOST_JS;
  if (M && typeof M.startMqtt === 'function' && !M.__wykresTemp) {
    const pierwotny = M.startMqtt; M.__wykresTemp = true;
    M.startMqtt = function (podaj, o) {
      const w = pierwotny.call(this, (d) => { if (d && typeof d.obiekt === 'string' && d.obiekt) { obiekt = nazwa(d.obiekt); obiektSurowy = d.obiekt; } return podaj(d); }, o);
      histPodepnij();                                        /* [D-511] M.historia powstaje w startMqtt */
      return w;
    };
  }
  window.addEventListener('message', (ev) => {
    const d = ev.data; if (!d || typeof d !== 'object' || d.typ !== 'swiat') return;
    const ob = typeof d.obieg_nr === 'number' ? d.obieg_nr : 0;
    const pompa = !!(d.poziomStan && d.poziomStan.pompa), grz = !!d.grzeje, flagi = (grz ? 1 : 0) | (pompa ? 2 : 0);
    const m = Math.floor(Date.now() / MIN), obej = d.obejscia || {};
    histPrzyPakiecie();                                      /* [D-511] pierwszy pakiet obiektu = baza + dociąganie */
    /* W TLE [B.0z-72]: bez odczytu przy awarii czujnika i przy obejściu (liczba wtedy nic nie znaczy).
       ⚠ „Czujnik niepodłączony” pakiet nie niesie (sterownik: `cisn_brak`, bez alarmu) - takie zera też się zapiszą;
       następna wersja pokaże ptaszek tylko dla czujników, które są, więc potrzebny będzie marker obecności w bloku. */
    if (typeof d.cis === 'number' && isFinite(d.cis) && !d.awmano && !obej.mano) dopisz(ob, 'cis', m, d.cis, -1, flagi);
    if (typeof d.poziom === 'number' && isFinite(d.poziom) && !d.awsonda && !obej.sonda) dopisz(ob, 'poz', m, d.poziom, -1, flagi);
    if (typeof d.temp !== 'number' || !isFinite(d.temp) || d.awtemp || d.awtempBrak) return;
    ostatnie = { ob, temp: d.temp, zad: typeof d.temp_set === 'number' ? d.temp_set : null, grz, pompa, t: Date.now(),
                 ile: typeof d.obiegi_ile === 'number' ? d.obiegi_ile : 1 };
    if (!dopisz(ob, 'temp', m, d.temp, ostatnie.zad === null ? -1 : Math.round(ostatnie.zad * 10), flagi)) {
      if (otwarte && otwarte.ob === ob && widok) podsumuj();   // liczba w oknie i tak na żywo, co pakiet
      return;
    }
    if (otwarte && otwarte.ob === ob) { widok = zbuduj(zakres); rysuj(false); }
  });
  /* HISTORIA ZE STEROWNIKA (tablice jak wyżej, `sr` = temp | cis | poz) - scala bez dubli [D-511]:
     - próbka sterownika WYGRYWA z zebraną w telefonie przy tej samej minucie (to ten sam pomiar, dokładniejszy);
     - okno TRZYMAJ jak przy zbieraniu (starsze leży w bazie IndexedDB, nie w localStorage) - bez tego zapis
       przekraczał MAX_PROBEK i przy następnym wczytaniu był „za długi” (uszkodzony koniec). */
  window.dolozHistorie = function (ob, wpisy, sr = 'temp') {
    if (!wpisy || !wpisy.length) return 0;
    const granica = Math.floor(Date.now() / MIN) - TRZYMAJ / MIN;
    const p = seria(ob, sr), poz = new Map(p.map((x, i) => [x[0], i]));
    let nowych = 0;
    wpisy.forEach(w => { if (w[0] < granica) return; const i = poz.get(w[0]);
      if (i === undefined) { poz.set(w[0], p.length); p.push(w); nowych++; } else p[i] = w; });
    p.sort((a, b) => a[0] - b[0]);
    while (p.length && p[0][0] < granica) p.shift();
    zapisz(ob, p, sr);
    return nowych;
  };

  /* ---------------- [1b] HISTORIA ZE STEROWNIKA: baza w telefonie + dociąganie [D-511] ---------------- */
  const HIST_ODSTEP_MS = 60000;     /* dociąganie najczęściej co minutę (wykres i tak zbiera co minutę z `swiat`) */
  const HIST_TLO_MS = 5 * MIN;      /* powrót z tła po dłuższej przerwie = dociągnij (telefon w tle nie zbiera) */
  const HIST_WLEJ_MS = 400;         /* kawałki strumienia wlewamy paczką - bez przerysowania na każdy kawałek */
  const hist = { pref: null, tekst: '', postep: null, blad: '', ost: 0, zaladowane: {}, podpiete: false, ma: false, kolejka: [], zegar: null, ukryta: 0 };
  const MJ = () => window.MOST_JS;
  const histJest = () => !!(MJ() && MJ().historia && MJ().HI);
  function histWlej(wszystkie) {
    const HI = MJ().HI;
    /* starsze niż okno wykresu leżą tylko w bazie - bez odczytu i zapisu localStorage na każdy kawałek fazy 2 */
    const granica = Math.floor((Date.now() - TRZYMAJ) / 1000), probki = wszystkie.filter(p => p.czas >= granica);
    if (probki.length) hist.ma = true;                       /* dziura w oknie = „sterownik nie zapisał”, nie „aplikacja zamknięta” */
    HI.obiegiW(probki).forEach(ob => {
      const s = HI.naSerie(probki, ob, SERIE);
      ['temp', 'cis', 'poz'].forEach(sr => { if (s[sr].length) window.dolozHistorie(ob, s[sr], sr); });
    });
  }
  function histPrzerysuj() { if (otwarte && widok) { widok = zbuduj(zakres); rysuj(false); } }
  function histWlejPozniej(probki) {
    for (const p of probki) hist.kolejka.push(p);
    if (hist.zegar) return;
    hist.zegar = setTimeout(() => { const p = hist.kolejka; hist.kolejka = []; hist.zegar = null; histWlej(p); histPrzerysuj(); }, HIST_WLEJ_MS);
  }
  /* NAJPIERW BAZA: 7 dni z IndexedDB - wykres rysuje się od razu, zanim sterownik cokolwiek odeśle */
  function histZBazy(pref) {
    if (!histJest() || !pref || hist.zaladowane[pref]) return Promise.resolve();
    hist.zaladowane[pref] = true;
    return MJ().historia.czytaj(pref, Math.floor((Date.now() - TRZYMAJ) / 1000), 0)
      .then(p => { if (pref === obiektSurowy && p.length) { histWlej(p); histPrzerysuj(); } }, () => {});
  }
  function histOpisBazy(pref) {
    if (!histJest()) return;
    Promise.all([MJ().historia.meta(pref), MJ().historia.miejsce()]).then(([m, mj]) => {
      if (pref !== obiektSurowy || !m || !m.pierwsza) return;
      const d = new Date(m.pierwsza * 1000), komplet = m.od_pelne != null && m.od_pelne <= (m.od_dost || 0);
      hist.tekst = 'Historia ze sterownika w telefonie od ' + d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear()
        + (komplet ? ' - komplet' : ' - starsza dociąga się w tle')
        + (mj && mj.zajete ? ' · pamięć apki ' + (mj.zajete / 1048576).toFixed(1) + ' MB' + (mj.trwaly === false ? ' (przeglądarka może ją wyczyścić - zainstaluj apkę)' : '') : '') + '.';
      histPokaz();
    }, () => {});
  }
  function histDociagnij(powod) {
    if (!histJest() || !obiektSurowy) return;
    const t = Date.now();
    if (MJ().historia.trwa() || t - hist.ost < HIST_ODSTEP_MS) return;
    hist.ost = t;
    const pref = obiektSurowy;
    histZBazy(pref).then(() => MJ().historia.dociagnij(powod)).then(w => {
      if (pref !== obiektSurowy) return;
      hist.postep = null;
      /* `uwaga` = sterownik NIE zapisuje (zegar, odcięcie, brak nośnika - 3332 z nagłówka) - na czerwono jak błąd [zasada 10] */
      hist.blad = (w && (w.blad || w.uwaga)) || '';
      histPokaz(); histOpisBazy(pref);
    });
  }
  /* zdarzenia pobierania -> pasek w karcie i wlewanie kawałków */
  function histPodepnij() {
    if (hist.podpiete || !histJest()) return;
    hist.podpiete = true;
    MJ().historia.sluchaj(e => {
      if (!e || e.pref !== obiektSurowy) return;
      if (e.typ === 'dane' && e.probki) histWlejPozniej(e.probki);
      if (e.typ === 'blad') { hist.blad = e.tekst || ''; hist.postep = null; }
      else if (e.typ === 'koniec') hist.postep = null;
      else { hist.postep = typeof e.postep === 'number' ? e.postep : hist.postep; hist.blad = ''; if (e.tekst) hist.tekst = e.tekst; }
      histPokaz();
    });
  }
  function histPrzyPakiecie() {
    if (!obiektSurowy) return;
    if (hist.pref !== obiektSurowy) {                        /* konto serwisowe przełączyło obiekt - stan paska od nowa */
      hist.pref = obiektSurowy; hist.ost = 0; hist.tekst = ''; hist.blad = ''; hist.postep = null; hist.ma = false;
    }
    histPodepnij();
    if (!hist.zaladowane[obiektSurowy]) { histZBazy(obiektSurowy); histDociagnij('start apki'); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hist.ukryta = Date.now(); return; }
    if (hist.ukryta && Date.now() - hist.ukryta > HIST_TLO_MS) { hist.ost = 0; histDociagnij('powrót z tła'); }
    hist.ukryta = 0;
  });
  /* pasek historii w otwartej karcie (tekst + postęp); pusty = ukryty */
  function histPokaz() {
    if (!otwarte) return;
    const el = otwarte.el.querySelector('.wt-hist'); if (!el) return;
    const pobiera = hist.postep !== null;
    const txt = hist.blad ? hist.blad : pobiera ? (hist.tekst || 'pobieram historię ze sterownika…') + ' ' + hist.postep + ' %' : hist.tekst;
    el.hidden = !txt;
    el.classList.toggle('blad', !!hist.blad);
    el.querySelector('.wt-hist-txt').textContent = txt ? txt.charAt(0).toUpperCase() + txt.slice(1) : '';
    const pas = el.querySelector('.wt-hist-pas'); pas.hidden = !pobiera;
    pas.firstChild.style.width = (pobiera ? Math.max(2, hist.postep) : 0) + '%';
    const pusto = otwarte.el.querySelector('.wt-pusto');
    if (pusto && !pusto.hidden) pusto.textContent = pustoTekst();
  }
  function pustoTekst() {
    if (hist.postep !== null) return 'Pobieram historię ze sterownika… ' + hist.postep + ' %';
    return histJest() && !hist.blad ? 'Zbieram dane: historia ze sterownika pojawi się po pierwszym pobraniu, a wykres rośnie co minutę.'
                                    : 'Zbieram dane: wykres wypełnia się, gdy apka jest otwarta.';
  }

  /* ---------------- [2] WYGLĄD (paleta aplikacji T3) ---------------- */
  const styl = document.createElement('style');
  styl.textContent = `
  .temp .th.lewa{position:relative}
  .wt-ikona{position:absolute;bottom:8px;right:8px;width:30px;height:30px;border-radius:9px;border:1px solid #dfe3e8;background:#fff;
    display:grid;place-items:center;cursor:pointer;color:#1e6fd9;box-shadow:0 1px 3px rgba(20,22,26,.12);padding:0;z-index:2}
  .wt-ikona svg{width:18px;height:18px}
  .wt-ikona:active{transform:scale(.94)}
  .wt-tlo{position:fixed;inset:0;z-index:2147483000;background:rgba(14,22,32,.42);display:grid;place-items:center;padding:14px;
    opacity:0;transition:opacity .25s ease;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wt-tlo.widac{opacity:1}
  .wt-karta{width:min(880px,100%);max-height:100%;overflow:auto;background:#fff;color:#14161a;border-radius:16px;
    box-shadow:0 10px 40px rgba(0,0,0,.28);padding:16px 16px 12px;display:grid;gap:12px;transform:translateY(12px);transition:transform .3s cubic-bezier(.2,.8,.2,1)}
  .wt-tlo.widac .wt-karta{transform:none}
  .wt-karta.wt-osadz{width:100%;max-height:none;overflow:visible;box-shadow:none;border:1px solid #dfe3e8;border-radius:12px;
    transform:none;transition:none;padding:12px 12px 10px;box-sizing:border-box}
  .wt-brew{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#5d6470}
  .wt-trend{display:inline-flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;border-radius:999px;background:#f3f5f8;font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;color:#5d6470}
  .wt-trend.rosnie{color:#e0701f}
  .wt-trend svg{width:16px;height:16px;transition:transform .5s cubic-bezier(.2,.8,.2,1)}
  .wt-prog{font-size:13px;color:#5d6470;margin-top:-4px}
  .wt-prog:empty{display:none}
  .wt-prog b{color:#e0701f}
  .wt-pasek{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
  .wt-pasek .wt-zamknij{margin-left:auto}
  .wt-zakresy{display:inline-flex;background:#f3f5f8;border-radius:10px;padding:3px;gap:2px;position:relative}
  .wt-zakresy button{font:700 14px/1 system-ui,sans-serif;color:#5d6470;background:transparent;border:0;border-radius:8px;padding:8px 14px;cursor:pointer;position:relative;z-index:1}
  .wt-zakresy button[aria-pressed=true]{color:#14161a}
  .wt-suwak{position:absolute;top:3px;bottom:3px;left:3px;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(20,22,26,.12);transition:transform .35s cubic-bezier(.2,.8,.2,1),width .35s cubic-bezier(.2,.8,.2,1)}
  .wt-zamknij{border:1px solid #dfe3e8;background:#fff;border-radius:10px;padding:8px 14px;font:600 14px/1 system-ui,sans-serif;color:#14161a;cursor:pointer}
  .wt-wykres{position:relative;width:100%;height:clamp(240px,52vw,380px);touch-action:pan-y}
  .wt-wykres canvas{position:absolute;inset:0;width:100%;height:100%}
  .wt-pusto{position:absolute;inset:0;display:grid;place-items:center;text-align:center;color:#5d6470;font-size:14px;padding:20px;pointer-events:none}
  .wt-dymek{position:absolute;top:8px;pointer-events:none;background:#fff;border:1px solid #dfe3e8;border-radius:10px;box-shadow:0 6px 20px rgba(20,22,26,.14);padding:8px 10px;min-width:140px;font-size:12px;color:#5d6470;opacity:0;transition:opacity .15s}
  .wt-dymek.widac{opacity:1}
  .wt-dymek .v{font-size:22px;font-weight:700;color:#14161a;font-variant-numeric:tabular-nums;margin:2px 0 4px}
  .wt-znacz{display:inline-block;font-size:11px;font-weight:700;padding:3px 6px;border-radius:6px;background:#f3f5f8;margin:0 4px 0 0}
  .wt-znacz.c{background:rgba(224,112,31,.14);color:#e0701f}
  .wt-stat{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;border-top:1px solid #dfe3e8;padding-top:10px}
  .wt-stat span{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a929d}
  .wt-stat b{font-size:20px;font-variant-numeric:tabular-nums}
  .wt-leg{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:#5d6470}
  .wt-leg i{display:inline-block;width:16px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
  .wt-stopka{font-size:11px;color:#8a929d}
  .wt-hist{display:grid;gap:5px;font-size:12px;color:#5d6470}
  .wt-hist.blad{color:#bb0000}
  .wt-hist-pas{height:6px;border-radius:3px;background:#edf0f3;overflow:hidden}
  .wt-hist-pas i{display:block;height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,rgba(18,162,181,.9),rgba(30,111,217,1));transition:width .4s ease}
  @media (max-width:480px){.wt-stat{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (prefers-reduced-motion:reduce){.wt-tlo,.wt-karta,.wt-suwak,.wt-trend svg{transition:none}}`;
  document.head.appendChild(styl);

  /* ---------------- [3] IKONA W KAFLU (po każdym przerysowaniu hali) ---------------- */
  const IKONA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18l5-6 4 3 5-8 4 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function doloz() {
    const lewa = document.querySelector('.tile.temp .th.lewa'); if (!lewa || lewa.querySelector('.wt-ikona')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'wt-ikona'; b.setAttribute('aria-label', 'Wykres temperatury wody'); b.innerHTML = IKONA;
    b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault();
      if (typeof window.wykresyOtworz === 'function') window.wykresyOtworz(); else otworz(); });
    lewa.appendChild(b);
  }
  new MutationObserver(doloz).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', doloz); doloz();

  /* ---------------- [4] WIDOK: dane dla zakresu ---------------- */
  const ZAK = { '1h': { dl: GODZ, kub: 1 }, '24h': { dl: DOBA, kub: 5 }, '7d': { dl: 7 * DOBA, kub: 30 } };
  let zakres = '24h'; try { const z = localStorage.getItem(PREF + 'zakres'); if (ZAK[z]) zakres = z; } catch (e) {}
  const fmt = (v, m = 1) => v.toLocaleString('pl-PL', { minimumFractionDigits: m, maximumFractionDigits: m });
  const hhmm = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const dz = new Intl.DateTimeFormat('pl-PL', { weekday: 'short' }), dzien = (t) => dz.format(new Date(t)).replace('.', '');
  const KROKI = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5];

  function zbuduj(z) {
    const ob = otwarte ? otwarte.ob : 0, cfg = ZAK[z], teraz = Date.now(), t0 = teraz - cfg.dl;
    const surowe = seria(ob).filter(p => p[0] * MIN >= t0).map(p => ({ t: p[0] * MIN, v: p[1] / 100, zad: p[2] >= 0 ? p[2] / 10 : null, grz: !!(p[3] & 1), pompa: !!(p[3] & 2) }));
    const zad = ostatnie && ostatnie.ob === ob && ostatnie.zad !== null ? ostatnie.zad : (surowe.length ? surowe[surowe.length - 1].zad : null);
    const kub = cfg.kub * MIN, punkty = [];
    let i = 0;
    while (i < surowe.length) {
      const k0 = Math.floor(surowe[i].t / kub) * kub; let s = 0, n = 0, lo = Infinity, hi = -Infinity, tsum = 0;
      while (i < surowe.length && surowe[i].t < k0 + kub) { const v = surowe[i].v; s += v; n++; lo = Math.min(lo, v); hi = Math.max(hi, v); tsum += surowe[i].t; i++; }
      punkty.push({ t: tsum / n, v: s / n, lo, hi });
    }
    const odcinki = []; let odc = [];                                        // przerwa > 2,5 kubełka = osobny odcinek
    punkty.forEach((p, j) => { if (j && p.t - punkty[j - 1].t > 2.5 * Math.max(kub, MIN)) { odcinki.push(odc); odc = []; } odc.push(p); });
    if (odc.length) odcinki.push(odc);
    const ostS = surowe[surowe.length - 1];                                  // ostatni kubełek kończy się OSTATNIM odczytem -
    if (ostS && odcinki.length) { const o = odcinki[odcinki.length - 1];     // inaczej kropka „teraz” wisi nad średnią z 5-30 min
      o[o.length - 1] = Object.assign({}, o[o.length - 1], { t: ostS.t, v: ostS.v }); }
    const przedz = (f) => { const w = []; let od = null, pop = null;
      surowe.forEach(p => { const ciag = pop && p.t - pop.t <= 3 * MIN; if (f(p) && (od === null || !ciag)) { if (od !== null) w.push([od, pop.t]); od = p.t; }
        else if (!f(p) && od !== null) { w.push([od, p.t]); od = null; } else if (f(p) && !ciag && od !== null) { w.push([od, pop.t]); od = p.t; } pop = p; });
      if (od !== null && pop) w.push([od, pop.t]); return w; };
    // trend z ostatniej godziny (regresja liniowa), prognoza tylko przy grzaniu
    const godz = surowe.filter(p => p.t >= teraz - GODZ); let nach = null, prognoza = null;
    if (godz.length >= 15 && godz[godz.length - 1].t - godz[0].t >= 20 * MIN) {
      const x0 = godz[0].t; let sx = 0, sy = 0, sxy = 0, sxx = 0; const n = godz.length;
      godz.forEach(p => { const x = (p.t - x0) / GODZ; sx += x; sy += p.v; sxy += x * p.v; sxx += x * x; });
      nach = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      const ost = godz[godz.length - 1];
      if (ost.grz && zad !== null && nach > 0.05 && ost.v < zad) { const min = (zad - ost.v) / nach * 60; if (min < 8 * 60) prognoza = { t: ost.t + min * MIN, min }; }
    }
    let t1 = teraz;
    if (prognoza && z === '24h') t1 = Math.min(prognoza.t, teraz + 4 * GODZ) + 12 * MIN;
    if (prognoza && z === '1h') t1 = teraz + 22 * MIN;
    const wart = surowe.map(p => p.v);
    let ymin = wart.length ? Math.min(...wart) : 26, ymax = wart.length ? Math.max(...wart) : 29;
    if (zad !== null) { ymin = Math.min(ymin, zad); ymax = Math.max(ymax, zad); }
    const zapas = Math.max(0.12, (ymax - ymin) * 0.12); ymin -= zapas; ymax += zapas;
    const krokY = KROKI.find(k => (ymax - ymin) / k <= 6) || 5; ymin = Math.floor(ymin / krokY) * krokY; ymax = Math.ceil(ymax / krokY) * krokY;
    let s = 0, grzMin = 0; surowe.forEach(p => { s += p.v; if (p.grz) grzMin++; });
    return { z, t0, t1, teraz, ymin, ymax, krokY, surowe, odcinki, zad, nach, prognoza, ost: surowe[surowe.length - 1] || null,
      grzanie: przedz(p => p.grz), postoj: przedz(p => !p.pompa),
      stat: wart.length ? { min: Math.min(...wart), max: Math.max(...wart), sr: s / wart.length, grzMin } : null };
  }

  /* ---------------- [5] RYSOWANIE ---------------- */
  let otwarte = null, widok = null, W = 0, H = 0, DPR = 1, pole = null, cv, cx, ov, ox, kursor = null, anim = null;
  /* WARSTWY TYLKO PRZY JEDNEJ SERII [Tomasz 28.09: „kreskowana zadana też za dużo może być - jak wyświetlamy tylko
     1 zmienną [dobrze], jak pojawi się więcej, zrobi bałagan”]: linia zadanej i prognoza (strefa + kropkowana linia)
     rysują się wyłącznie, gdy na wykresie jest JEDNA wielkość. Dziś jest jedna (temperatura); wersja z ptaszkami
     (B.0z-72) ustawi tu liczbę zaznaczonych serii. */
  let liczbaSerii = 1;
  const X = (w, t) => pole.l + (t - w.t0) / (w.t1 - w.t0) * (pole.r - pole.l);
  const Y = (w, v) => pole.d - (v - w.ymin) / (w.ymax - w.ymin) * (pole.d - pole.g);
  const K = { ink2: '#5d6470', ink3: '#8a929d', siatka: '#edf0f3', woda: '30,111,217', turk: '18,162,181', cieplo: '224,112,31' };
  function wymiary() { DPR = Math.min(window.devicePixelRatio || 1, 2.5); const r = cv.parentNode.getBoundingClientRect(); W = r.width; H = r.height;
    [cv, ov].forEach(c => { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }); pole = { l: 46, r: W - 14, g: 26, d: H - 30 }; }   // g 26: nad polem opis osi Y
  function krzywa(ctx, pkt) {                                                   // monotoniczna (Fritsch-Carlson) - bez przeregulowań
    const n = pkt.length; if (n === 1) { ctx.moveTo(pkt[0][0], pkt[0][1]); ctx.lineTo(pkt[0][0] + 0.1, pkt[0][1]); return; }
    const d = [], m = []; for (let i = 0; i < n - 1; i++) d.push((pkt[i + 1][1] - pkt[i][1]) / ((pkt[i + 1][0] - pkt[i][0]) || 1e-6));
    m.push(d[0]); for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2); m.push(d[n - 2]);
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const q = 3 / Math.sqrt(s); m[i] = q * a * d[i]; m[i + 1] = q * b * d[i]; } }
    ctx.moveTo(pkt[0][0], pkt[0][1]);
    for (let i = 0; i < n - 1; i++) { const h = (pkt[i + 1][0] - pkt[i][0]) / 3; ctx.bezierCurveTo(pkt[i][0] + h, pkt[i][1] + m[i] * h, pkt[i + 1][0] - h, pkt[i + 1][1] - m[i + 1] * h, pkt[i + 1][0], pkt[i + 1][1]); }
  }
  function szraf(ctx) { const p = document.createElement('canvas'); p.width = p.height = 8; const q = p.getContext('2d'); q.strokeStyle = K.ink3; q.globalAlpha = .35; q.lineWidth = 1.2;
    q.beginPath(); q.moveTo(0, 8); q.lineTo(8, 0); q.moveTo(-2, 2); q.lineTo(2, -2); q.moveTo(6, 10); q.lineTo(10, 6); q.stroke(); return ctx.createPattern(p, 'repeat'); }

  function klatka(ctx, w) {
    ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = szraf(ctx); w.postoj.forEach(([a, b]) => ctx.fillRect(X(w, a), pole.g, Math.max(1, X(w, b) - X(w, a)), pole.d - pole.g));
    w.grzanie.forEach(([a, b]) => { const x = X(w, a), s = Math.max(1, X(w, b) - x); ctx.fillStyle = 'rgba(' + K.cieplo + ',.045)'; ctx.fillRect(x, pole.g, s, pole.d - pole.g);
      ctx.fillStyle = 'rgba(' + K.cieplo + ',.85)'; ctx.fillRect(x, pole.d - 3, s, 3); });
    /* OŚ Y [Tomasz 28.09: „po lewej liczby na osi Y zleją się z innymi danymi - tylko info, co jest na Y, i punkt 0
       i max”]: linie siatki zostają (oko czyta z nich zmianę), liczby TYLKO na dole i na górze skali, nad osią opis
       wielkości. Ten sam układ dostanie każdy pas w wersji z wieloma seriami (B.0z-72) - pasy nie będą się gryzły
       liczbami. Temperatura: dół skali = najniższa wartość z zapasem (od zera krzywa byłaby płaska kreską);
       ciśnienie i poziom w następnej wersji od zera. */
    const miejsc = Math.abs(w.krokY * 10 - Math.round(w.krokY * 10)) > 1e-9 ? 2 : 1;
    for (let v = w.ymin; v <= w.ymax + 1e-9; v += w.krokY) { const y = Math.round(Y(w, v)) + .5; ctx.strokeStyle = K.siatka; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pole.l, y); ctx.lineTo(pole.r, y); ctx.stroke(); }
    ctx.textAlign = 'right'; ctx.fillStyle = K.ink3; ctx.font = '500 12px system-ui, sans-serif';
    ctx.textBaseline = 'top';    ctx.fillText(fmt(w.ymax, miejsc), pole.l - 8, pole.g - 1);
    ctx.textBaseline = 'bottom'; ctx.fillText(fmt(w.ymin, miejsc), pole.l - 8, pole.d + 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = K.ink2; ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillText('TEMPERATURA [°C]', 4, 4);
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    /* OPISY OSI X [sonda 28.09: na 430 px „21:00” wchodziło na „pon 00:00”]: najpierw zbieramy znaczniki, potem
       rysujemy - mocne (północ, dni) pierwsze, zwykłe tylko tam, gdzie nie nachodzą na już postawione. Linie siatki
       idą przy każdym znaczniku, także bez napisu. */
    const znaczniki = [];
    if (w.z === '1h') { const k = 10 * MIN; for (let t = Math.ceil(w.t0 / k) * k; t <= w.t1; t += k) znaczniki.push([t, hhmm(t), false]); }
    else if (w.z === '24h') { const d = new Date(w.t0); d.setMinutes(0, 0, 0); for (let t = d.getTime(); t <= w.t1; t += GODZ) { const g = new Date(t).getHours(); if (t >= w.t0 && g % 3 === 0) znaczniki.push([t, g === 0 ? dzien(t) + ' 00:00' : hhmm(t), g === 0]); } }
    else { const d = new Date(w.t0); d.setHours(0, 0, 0, 0); for (let t = d.getTime() + DOBA; t <= w.t1; t += DOBA) { const q = new Date(t); znaczniki.push([t, dzien(t) + ' ' + q.getDate() + '.' + String(q.getMonth() + 1).padStart(2, '0'), true]); } }
    const zajete = [];
    znaczniki.forEach(([t]) => { const x = X(w, t); if (x < pole.l - 1 || x > pole.r + 1) return; ctx.strokeStyle = K.siatka;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, pole.g); ctx.lineTo(Math.round(x) + .5, pole.d); ctx.stroke(); });
    [true, false].forEach(etap => znaczniki.filter(z => z[2] === etap).forEach(([t, tx, mocno]) => {
      const x = X(w, t); if (x < pole.l - 1 || x > pole.r + 1) return;
      ctx.font = (mocno ? '600 ' : '500 ') + '12px system-ui, sans-serif';
      const sz = ctx.measureText(tx).width, xs = Math.min(Math.max(x, pole.l + sz / 2), pole.r - sz / 2), a = xs - sz / 2 - 5, b = xs + sz / 2 + 5;
      if (zajete.some(([p, k]) => a < k && b > p)) return;
      zajete.push([a, b]); ctx.fillStyle = mocno ? K.ink2 : K.ink3; ctx.fillText(tx, xs, pole.d + 8); }));
    if (w.t1 > w.teraz && liczbaSerii === 1) { const x = X(w, w.teraz), g = ctx.createLinearGradient(x, 0, pole.r, 0); g.addColorStop(0, 'rgba(' + K.cieplo + ',.07)'); g.addColorStop(1, 'rgba(' + K.cieplo + ',0)');
      ctx.fillStyle = g; ctx.fillRect(x, pole.g, pole.r - x, pole.d - pole.g); ctx.fillStyle = 'rgb(' + K.cieplo + ')'; ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText('PROGNOZA', pole.r - 4, pole.g + 4); }
    if (w.zad !== null && liczbaSerii === 1) { const y = Math.round(Y(w, w.zad)) + .5; ctx.setLineDash([6, 5]); ctx.strokeStyle = K.ink2; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pole.l, y); ctx.lineTo(pole.r, y); ctx.stroke(); ctx.setLineDash([]); }
      /* bez napisu „zadana 28,0 °C” na linii [Tomasz 28.09: „info o aktualnej i zadanej zaburzy, jak pojawią się inne
         wykresy”] - linię opisuje legenda, liczbę pokazuje dymek po dotknięciu */
    w.odcinki.forEach(odc => {
      if (w.z === '7d' && odc.length > 1) { ctx.beginPath(); odc.forEach((p, i) => i ? ctx.lineTo(X(w, p.t), Y(w, p.hi)) : ctx.moveTo(X(w, p.t), Y(w, p.hi)));
        for (let i = odc.length - 1; i >= 0; i--) ctx.lineTo(X(w, odc[i].t), Y(w, odc[i].lo)); ctx.closePath(); ctx.fillStyle = 'rgba(' + K.woda + ',.13)'; ctx.fill(); }
      const pkt = odc.map(p => [X(w, p.t), Y(w, p.v)]);
      ctx.beginPath(); krzywa(ctx, pkt); ctx.lineTo(pkt[pkt.length - 1][0], pole.d); ctx.lineTo(pkt[0][0], pole.d); ctx.closePath();
      const g = ctx.createLinearGradient(0, pole.g, 0, pole.d); g.addColorStop(0, 'rgba(' + K.woda + ',.30)'); g.addColorStop(.55, 'rgba(' + K.turk + ',.12)'); g.addColorStop(1, 'rgba(' + K.turk + ',0)');
      ctx.fillStyle = g; ctx.fill();
      const gl = ctx.createLinearGradient(pole.l, 0, pole.r, 0); gl.addColorStop(0, 'rgba(' + K.turk + ',.95)'); gl.addColorStop(1, 'rgba(' + K.woda + ',1)');
      ctx.beginPath(); krzywa(ctx, pkt); ctx.strokeStyle = gl; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(' + K.woda + ',.45)'; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0; });
    if (w.prognoza && w.t1 > w.teraz && w.ost && liczbaSerii === 1) { const a = [X(w, w.ost.t), Y(w, w.ost.v)], tk = Math.min(w.prognoza.t, w.t1 - 4 * MIN);
      const vk = w.ost.v + (w.zad - w.ost.v) * (tk - w.ost.t) / (w.prognoza.t - w.ost.t), b = [X(w, tk), Y(w, vk)];
      ctx.setLineDash([2, 5]); ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgb(' + K.cieplo + ')'; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
      if (tk >= w.prognoza.t - 1) { ctx.beginPath(); ctx.arc(b[0], b[1], 4, 0, Math.PI * 2); ctx.fillStyle = 'rgb(' + K.cieplo + ')'; ctx.fill(); } }
    ctx.restore();
  }

  function rysuj(przenikanie) {
    if (!otwarte) return; const pusto = otwarte.el.querySelector('.wt-pusto');
    pusto.hidden = widok.surowe.length > 1;
    pusto.textContent = pustoTekst();                          /* [D-511] pobieranie historii / zbieranie - co naprawdę się dzieje */
    if (!przenikanie || matchMedia('(prefers-reduced-motion: reduce)').matches) { if (anim) cancelAnimationFrame(anim); anim = null; klatka(cx, widok); podsumuj(); return; }
    const A = document.createElement('canvas'); A.width = cv.width; A.height = cv.height; A.getContext('2d').drawImage(cv, 0, 0);
    const B = document.createElement('canvas'); B.width = cv.width; B.height = cv.height; klatka(B.getContext('2d'), widok);
    const t0 = performance.now(); if (anim) cancelAnimationFrame(anim);
    const krok = (t) => { const u = Math.min(1, (t - t0) / 480), e = 1 - Math.pow(1 - u, 3);
      cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); cx.globalAlpha = 1 - e; cx.drawImage(A, 0, 0); cx.globalAlpha = e; cx.drawImage(B, 0, 0); cx.globalAlpha = 1;
      if (u < 1) anim = requestAnimationFrame(krok); else { anim = null; klatka(cx, widok); } };
    anim = requestAnimationFrame(krok); podsumuj();
  }

  function nakladka(czas) {
    if (!otwarte) return;
    if (!otwarte.el.isConnected) { if (otwarte.osadzona) otwarte = null; return; }   // hala zmienila widok - karta idzie do kosza
    requestAnimationFrame(nakladka);
    ox.setTransform(1, 0, 0, 1, 0, 0); ox.clearRect(0, 0, ov.width, ov.height); if (anim || !widok || !widok.ost) return;
    ox.setTransform(DPR, 0, 0, DPR, 0, 0);
    const o = widok.ost, x = X(widok, o.t), y = Y(widok, o.v);
    if (Date.now() - o.t < 3 * MIN) { if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { const f = (czas % 1800) / 1800; ox.beginPath(); ox.arc(x, y, 5 + f * 14, 0, 7); ox.fillStyle = 'rgba(' + K.woda + ',' + (.35 * (1 - f)) + ')'; ox.fill(); }
      ox.beginPath(); ox.arc(x, y, 5, 0, 7); ox.fillStyle = '#fff'; ox.fill(); ox.lineWidth = 3; ox.strokeStyle = 'rgb(' + K.woda + ')'; ox.stroke(); }
    const dym = otwarte.el.querySelector('.wt-dymek');
    if (kursor === null) { dym.classList.remove('widac'); return; }
    const t = widok.t0 + (kursor - pole.l) / (pole.r - pole.l) * (widok.t1 - widok.t0), s = widok.surowe;
    let lo = 0, hi = s.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].t < t) lo = m; else hi = m; }
    const p = Math.abs(s[lo].t - t) < Math.abs(s[hi].t - t) ? s[lo] : s[hi], blisko = Math.abs(p.t - t) <= Math.max(3 * MIN, (widok.t1 - widok.t0) / (pole.r - pole.l) * 6);
    const kx = blisko ? X(widok, p.t) : kursor;
    ox.strokeStyle = K.ink3; ox.lineWidth = 1; ox.setLineDash([3, 3]); ox.beginPath(); ox.moveTo(Math.round(kx) + .5, pole.g); ox.lineTo(Math.round(kx) + .5, pole.d); ox.stroke(); ox.setLineDash([]);
    const d = new Date(blisko ? p.t : t), dt = dzien(d.getTime()) + ' ' + d.getDate() + '.' + String(d.getMonth() + 1).padStart(2, '0') + ', ' + hhmm(d.getTime());
    if (blisko) { ox.beginPath(); ox.arc(kx, Y(widok, p.v), 4.5, 0, 7); ox.fillStyle = 'rgb(' + K.woda + ')'; ox.fill(); ox.lineWidth = 2; ox.strokeStyle = '#fff'; ox.stroke();
      dym.innerHTML = '<div>' + dt + '</div><div class="v">' + fmt(p.v, 2) + ' °C</div>' + (p.grz ? '<span class="wt-znacz c">grzanie</span>' : '<span class="wt-znacz">bez grzania</span>') + '<span class="wt-znacz">' + (p.pompa ? 'pompa pracuje' : 'pompa stoi') + '</span>'; }
    else dym.innerHTML = '<div>' + dt + '</div><div class="v">brak danych</div><span class="wt-znacz">'
                         + (hist.ma ? 'sterownik nie zapisał pomiaru' : 'apka była zamknięta') + '</span>';   /* [D-511] */
    const sz = dym.offsetWidth || 150; dym.style.left = Math.min(Math.max(8, kx + (kx > W / 2 ? -sz - 14 : 14)), W - sz - 8) + 'px'; dym.classList.add('widac');
  }

  function podsumuj() {
    const w = widok, el = otwarte.el, q = (s) => el.querySelector(s), o = w.ost;
    q('.wt-brew').textContent = tytul(otwarte.ob);        // nazwy obiegów przychodzą ze sterownika - co pakiet
    const tr = q('.wt-trend');
    if (w.nach === null) { tr.hidden = true; } else { tr.hidden = false; tr.classList.toggle('rosnie', w.nach > 0.05);
      tr.querySelector('b').textContent = (w.nach >= 0 ? '+' : '−') + fmt(Math.abs(w.nach), 2) + ' °C/h'; tr.querySelector('svg').style.transform = 'rotate(' + Math.max(-45, Math.min(45, -w.nach * 120)) + 'deg)'; }
    const cz = (m) => { const h = Math.floor(m / 60), mm = Math.round(m % 60); return (h ? h + ' h ' : '') + mm + ' min'; };
    q('.wt-prog').innerHTML = w.prognoza ? 'Zadana ok. <b>' + hhmm(w.prognoza.t) + '</b> · za ' + cz(w.prognoza.min) + ' przy obecnym tempie' : (w.nach === null ? 'Trend po 20 min danych' : '');
    const st = w.stat;
    q('.wt-s-min').textContent = st ? fmt(st.min) + '°' : '–'; q('.wt-s-max').textContent = st ? fmt(st.max) + '°' : '–'; q('.wt-s-sr').textContent = st ? fmt(st.sr) + '°' : '–';
    q('.wt-s-grz').textContent = st ? Math.floor(st.grzMin / 60) + ':' + String(st.grzMin % 60).padStart(2, '0') + ' h' : '–';
    const p = seria(otwarte.ob), u = uszkodzone[klucz(otwarte.ob)];   /* [Astra 14] uszkodzony zapis - jawnie, nie jako zera */
    q('.wt-stopka').textContent = (p.length ? (hist.ma ? 'Na wykresie od ' : 'Historia z tego telefonu od ') + dzien(p[0][0] * MIN) + ' ' + hhmm(p[0][0] * MIN) + ' (' + p.length + ' próbek co minutę, 7 dni).' : '')
      + (u ? ' Część zapisu w telefonie była uszkodzona (' + u.opis + ')' + (u.od !== null ? ' - pokazuję dane do ' + dzien(u.od * MIN) + ' ' + hhmm(u.od * MIN) : ' - pominięta') + '.' : '');
  }

  /* NAZWA OBIEGU W TYTULE [Tomasz 28.09: „przy 1 obiegu nie piszemy obieg 1; jak są 2 obiegi, to piszemy jakie, np.
     wanna 1, wanna 2 albo basen, wanna albo basen 1, basen 2 albo basen, brodzik” - rozstrzygnięte już 26.09]:
     JEDNO źródło reguły - `obiegEtykieta()` serwisu (panel4_serwis.html, w sklejce pod tą samą nazwą; przeznaczenia
     ze świata `przezn_obiegow`). Bez serwisu w dokumencie: jeden obieg = bez dopisku, kilka = „obieg N”. */
  function tytul(ob) {
    let n = '';
    try { n = typeof window.obiegEtykieta === 'function' ? window.obiegEtykieta(ob) : ''; } catch (e) { n = ''; }
    if (!n && typeof window.obiegEtykieta !== 'function' && ostatnie && ostatnie.ile > 1) n = 'obieg ' + (ob + 1);
    return 'Temperatura wody' + (n ? ' · ' + n : '');
  }
  /* ---------------- [6] KARTA WYKRESU: w bloczku „wykresy” hali albo w oknie na wierzchu ---------------- */
  function karta(ob, osadzona) {
    const k = document.createElement('div'); k.className = 'wt-karta' + (osadzona ? ' wt-osadz' : '');
    /* GÓRA KARTY BEZ WARTOŚCI BIEŻĄCEJ I ZADANEJ [Tomasz 28.09: „info o aktualnej i zadanej zaburzy info, jak pojawią
       się inne wykresy”]: bieżąca jest na ekranie głównym, zadana - linia przerywana; zostaje tytuł, zakresy z trendem
       i jedna linijka prognozy. Przy wielu seriach (B.0z-72) każdy pas dostanie tylko swój opis osi i swój trend. */
    k.innerHTML = '<div class="wt-brew">' + tytul(ob) + '</div>' +
      '<div class="wt-pasek"><div class="wt-zakresy" role="group" aria-label="Zakres"><span class="wt-suwak"></span><button type="button" data-z="1h">1 h</button><button type="button" data-z="24h">24 h</button><button type="button" data-z="7d">7 dni</button></div>' +
      '<span class="wt-trend" hidden><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><b></b></span>' +
      (osadzona ? '' : '<button type="button" class="wt-zamknij">Zamknij</button>') + '</div>' +
      '<div class="wt-prog"></div>' +
      '<div class="wt-wykres"><canvas></canvas><canvas aria-hidden="true"></canvas><div class="wt-pusto" hidden></div><div class="wt-dymek"></div></div>' +
      '<div class="wt-leg"><span><i style="background:linear-gradient(180deg,rgba(30,111,217,.9),rgba(18,162,181,.25))"></i>temperatura</span><span><i style="height:0;border-top:2px dashed #5d6470;border-radius:0"></i>zadana</span>' +
      '<span><i style="background:rgba(224,112,31,.22);border-bottom:3px solid #e0701f"></i>grzanie</span><span><i style="background:repeating-linear-gradient(135deg,#8a929d 0 1.5px,transparent 1.5px 5px);opacity:.6"></i>pompa stoi</span></div>' +
      '<div class="wt-stat"><div><span>minimum</span><b class="wt-s-min">–</b></div><div><span>maksimum</span><b class="wt-s-max">–</b></div><div><span>średnia</span><b class="wt-s-sr">–</b></div><div><span>grzanie łącznie</span><b class="wt-s-grz" style="color:#e0701f">–</b></div></div>' +
      '<div class="wt-hist" hidden><div class="wt-hist-txt"></div><div class="wt-hist-pas" hidden><i></i></div></div>' +   /* [D-511] */
      '<div class="wt-stopka"></div>';
    return k;
  }
  /* wspólne dla obu miejsc: płótna, zakresy, kursor, zmiana rozmiaru, pierwszy rysunek, pętla nakładki.
     `root` = to, co wisi w dokumencie (tło okna albo sama karta), `k` = karta. */
  function podlacz(root, k, ob, osadzona) {
    [cv, ov] = k.querySelectorAll('canvas'); cx = cv.getContext('2d'); ox = ov.getContext('2d');
    otwarte = { el: root, karta: k, ob, osadzona }; kursor = null;
    const przyc = [...k.querySelectorAll('.wt-zakresy button')], suw = k.querySelector('.wt-suwak');
    const ustaw = () => { const b = przyc.find(x => x.dataset.z === zakres); if (!b.offsetWidth) return;
      suw.style.width = b.offsetWidth + 'px'; suw.style.transform = 'translateX(' + (b.offsetLeft - 3) + 'px)'; przyc.forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
    przyc.forEach(b => b.addEventListener('click', () => { if (b.dataset.z === zakres) return; zakres = b.dataset.z; try { localStorage.setItem(PREF + 'zakres', zakres); } catch (e) {}
      ustaw(); widok = zbuduj(zakres); rysuj(true); }));
    const pw = k.querySelector('.wt-wykres');
    const ruch = (e) => { const r = pw.getBoundingClientRect(), x = e.clientX - r.left; kursor = (x >= pole.l && x <= pole.r && widok && widok.surowe.length) ? x : null; };
    pw.addEventListener('pointermove', ruch); pw.addEventListener('pointerdown', ruch); pw.addEventListener('pointerleave', () => { kursor = null; });
    /* 0 px = karta chwilowo poza dokumentem (przenosiny między ramkami hali) - nie zerujemy płócien */
    new ResizeObserver(() => { if (!otwarte || otwarte.karta !== k || !pw.clientWidth) return; wymiary(); widok = zbuduj(zakres); rysuj(false); ustaw(); }).observe(pw);
    requestAnimationFrame(() => { if (!osadzona) root.classList.add('widac'); if (!pw.clientWidth) return;
      wymiary(); ustaw(); widok = zbuduj(zakres); rysuj(false); requestAnimationFrame(nakladka); });
    /* [D-511] pasek historii od razu (stan z ostatniego pobierania) i dociągnięcie przy otwarciu (najczęściej co minutę) */
    histPokaz(); if (obiektSurowy) { if (!hist.tekst && !hist.blad) histOpisBazy(obiektSurowy); histDociagnij('otwarcie wykresu'); }
  }
  let zamknijOkno = () => {};
  function otworz() {
    if (otwarte) return;
    const ob = ostatnie ? ostatnie.ob : 0, el = document.createElement('div'); el.className = 'wt-tlo'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Wykres temperatury wody');
    const k = karta(ob, false); el.appendChild(k); document.body.appendChild(el);
    const esc = (e) => { if (e.key === 'Escape') zamknijOkno(); };
    zamknijOkno = () => { if (!otwarte || otwarte.el !== el) return; el.classList.remove('widac'); otwarte = null; kursor = null; setTimeout(() => el.remove(), 260); document.removeEventListener('keydown', esc); };
    el.addEventListener('click', (e) => { if (e.target === el) zamknijOkno(); });
    k.querySelector('.wt-zamknij').addEventListener('click', zamknijOkno); document.addEventListener('keydown', esc);
    podlacz(el, k, ob, false);
  }
  /* OSADZENIE W HALI [28.09]: hala przebudowuje ekran przy każdej paczce (render) i za każdym razem woła osadz()
     z NOWĄ ramką. Istniejącą kartę tego samego obiegu PRZENOSIMY (appendChild przenosi węzeł; płótna trzymają
     rysunek, przenikanie trwa dalej), nową budujemy tylko przy pierwszym wejściu albo zmianie obiegu.
     Przeniesienie dzieje się w tym samym zadaniu co przebudowa, więc przeglądarka nie rysuje klatki bez karty. */
  window.WYKRES = {
    _dekoduj: dekoduj,                                       /* [Astra 14] tylko dla testu offline (_test_dekoder14.html) */
    osadz(kont, ob) {
      ob = typeof ob === 'number' ? ob : (ostatnie ? ostatnie.ob : 0);
      if (otwarte && otwarte.osadzona && otwarte.ob === ob) { if (otwarte.el.parentNode !== kont) kont.appendChild(otwarte.el); return; }
      if (otwarte && !otwarte.osadzona) zamknijOkno();
      otwarte = null;
      const k = karta(ob, true); kont.appendChild(k); podlacz(k, k, ob, true);
    }
  };
})();

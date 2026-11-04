/* ============================================================
 *  most_js.js - BRIDGE W PRZEGLADARCE [D-221, 2026-09-06]
 * ============================================================
 *  SPIS TRESCI
 *   [1] po co: strona na AP sterownika 1:1 z bridge'em
 *   [2] tabele kontraktu (te same, co most.py): nastawy MN, wylaczniki,
 *       kody zaciskow, sposoby akcesoriow
 *   [3] dekodowanie: blok panelu + linia MN + rejestry -> pakiet "swiat"
 *       (port swiat_z_bloku / nastawy_z_mn / harm_z_rejestrow z most.py)
 *   [4] komendy makiety -> zapisy rejestrow (port komenda_na_rejestr,
 *       nastawa_na_rejestr, akc, wycisz-alarmy, ustaw-czas)
 *   [5] klient AP: /blok.txt co 1 s, /rej co 10 s, /cmd?adr=;
 *       podaje pakiety makiecie i przechwytuje fetch('/cmd?co=...')
 *   [5a] trwa edycja: wspolny marker otwartych edytorow makiet -> M.zajety()
 *       (przeladowanie aplikacji po aktualizacji czeka, karta Astry 15)
 *
 *  [1] PO CO [Tomasz 2026-09-06: „strona na AP - da sie zrobic 1:1 jak
 *  wyglada i dziala bridge sadzawki?" - „pelne"]. Bridge (most.py) liczy
 *  pakiet stanu (74 pola) z trzech surowych rzeczy: bloku panelu (72
 *  slowa, ten sam, ktory idzie do Tab5), linii nastaw MN (128 pol)
 *  i kilku rejestrow. Sterownik na AP NIE liczy tego w C (bylaby to
 *  druga kopia 74 pol - zrodlo rozjazdow, patrz D-217), tylko wystawia
 *  surowe linie MB;/MN; jak po USB, a liczy TEN plik - ta sama makieta
 *  pod bridge'em na PC i pod AP na telefonie. Docelowo most.py zostaje
 *  samym transportem po USB, a jedyny zapis dekodowania jest tutaj.
 *
 *  ⚠ PRZEJSCIOWO DWA ZAPISY (Python w most.py i JS tutaj) - spina je
 *  probe parytetu (makieta pod bridge'em liczy swiat z /blok.txt bridge'a
 *  i porownuje z /stan.json pole po polu). Rozjazd = blad w porcie.
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------- [2] TABELE */
  /* MN_NASTAWY: [indeks MN, klucz makiety, skala, rodzaj]
     rodzaj: 'l' liczba, 'b' bool, 'z' liczba ze znakiem, [a,b] = wybor 0/1 */
  const MN_NASTAWY = [
    [0, 'dol_start', 1, 'l'], [1, 'dol_stop', 1, 'l'], [2, 'sucho_stop', 1, 'l'],
    [3, 'sonda_reakcja', 1, ['pracuj', 'stop']], [4, 'nadmiar_prog', 1, 'l'],
    [5, 'nadmiar_hist', 1, 'l'], [7, 'dol_maxs', 1, 'l'], [8, 'litr_cm', 10.0, 'l'],
    [9, 'uklad', 1, ['skimmer', 'przelew']], [10, 'dol_limit_l', 1, 'l'],
    [11, 'dol_awaria', 1, 'l'], [12, 'prefill_max', 1, 'l'],
    [13, 'geo_ksztalt', 1, ['prost', 'okrag']], [14, 'geo_a', 100.0, 'l'],
    [15, 'geo_b', 100.0, 'l'], [16, 'geo_d', 100.0, 'l'], [17, 'geo_gl', 100.0, 'l'],
    [18, 'geo_h', 100.0, 'l'], [19, 'dol_autokas', 1, 'b'],
    [20, 'pl_wstepna', 1, 'l'], [22, 'pl_koncowa', 1, 'l'], [23, 'pl_dolewka', 1, 'b'],
    [24, 'pl_ile', 1, 'l'], [25, 'pl_blokuj', 1, 'b'], [26, 'pl_wid_min', 1, 'l'],
    [27, 'pl_wid_max', 1, 'l'], [28, 'cA_prog', 100.0, 'l'], [29, 'cA_min', 1, 'l'],
    [30, 'cB_prog', 100.0, 'l'], [31, 'cC_prog', 100.0, 'l'], [32, 'cC_min', 1, 'l'],
    [33, 'cisn_reakcja', 1, ['pracuj', 'stop']],   /* [D-503] 4600+5 - reakcja na uszkodzenie czujnika cisnienia */
    [34, 'kal_poz_zak', 1, 'l'], [35, 'kal_cis_zak', 100.0, 'l'],
    [36, 'kal_temp_kor', 10.0, 'z'], [37, 'grz_hist', 10.0, 'l'],
    [38, 'kal_poz_off', 1, 'z'], [39, 'kal_cis_off', 100.0, 'z'],
    [40, 'heat_tryb', 1, 'l'], [41, 'heat_prio', 1, 'l'], [42, 'heat_delta', 10.0, 'l'],
    [43, 'heat_min', 1, 'l'],
    [45, 'pl_powt', 1, 'l']        /* zalegle plukanie: ile prob (4560+8), 0 = nie rob [D-233] */
  ];
  /* MN_UKLAD: indeks MN -> [baza rejestru, przesuniecie]; adres = baza + obieg*20 + rel */
  const MN_UKLAD = [];
  for (let r = 0; r < 20; r++) MN_UKLAD.push([4520, r]);
  for (let r = 0; r < 8; r++) MN_UKLAD.push([4560, r]);
  for (let r = 0; r < 6; r++) MN_UKLAD.push([4600, r]);
  for (const r of [2, 5, 6, 7, 8, 9]) MN_UKLAD.push([4640, r]);
  for (let r = 0; r < 4; r++) MN_UKLAD.push([4680, r]);
  MN_UKLAD.push([4680, 4]);      /* [44] numer obiegu bloku - nie nastawa (rejestr nie istnieje) */
  MN_UKLAD.push([4560, 8]);      /* [45] zalegle plukanie: ile prob [D-233] */
  const WYLACZNIKI = [['cA_wl', 4024], ['cB_wl', 4028], ['cC_wl', 4030], ['uv_wl', 4044],
                      ['grz_wl', 4046], ['dol_wl', 4048], ['pluk_wl', 4050]];
  const MAPA_KOD_DO = { 1: 'Pompa filtracyjna', 2: 'Zawór głowicy płuczącej', 3: 'Zawór dolewania',
    4: 'Grzanie — styk 1', 5: 'Grzanie — styk 2', 6: 'Lampa UV', 7: 'Masaż wodny 1', 8: 'Masaż wodny 2',
    9: 'Masaż powietrzny 1', 10: 'Masaż powietrzny 2', 11: 'Atrakcja 1', 12: 'Atrakcja 2',
    13: 'Oświetlenie białe', 14: 'Oświetlenie barwne', 15: 'Zawór trybu cichego' };   /* 15 [D-495, 2026-09-26] */
  const MAPA_KOD_DI = { 1: 'Przełącznik w pozycji AUTO', 2: 'Przełącznik w pozycji HAND',
    3: 'Termik pompy filtracyjnej', 4: 'Przycisk masażu 1', 5: 'Przycisk masażu 2', 6: 'Przycisk światła',
    7: 'Roleta zamknięta', 8: 'Termik pompy masażu 1', 9: 'Termik pompy masażu 2',
    10: 'Wymuszenie zewnętrzne', 11: 'Zanik fazy', 12: 'Przycisk trybu cichego' };   /* 12 [D-495] */
  const AKC_SPOSOBY = ['tylko z ekranu', 'przelacznik', 'na czas', 'na czas, bez przerwania', 'podtrzymanie'];

  /* ---------------------------------------------------------- [3] DEKODOWANIE */
  const i16 = x => (x >= 0x8000 ? x - 0x10000 : x);
  const bit = (v, n) => !!((v >> n) & 1);

  /* linie tekstowe jak po USB: "MB;a,b,c" -> tablica liczb albo null */
  function parsujLinie(txt, prefiks) {
    if (!txt) return null;
    for (const l of txt.split(/\r?\n/)) {
      if (!l.startsWith(prefiks)) continue;
      const w = l.slice(prefiks.length).split(',');
      const out = [];
      for (const x of w) { if (x === '') continue; const n = Number(x); if (!Number.isFinite(n)) return null; out.push(n); }
      return out;
    }
    return null;
  }
  /* [D-533] linia `KT;<nr>;<zdanie>` z /blok.txt strony - zdanie odmowy komendy o numerze `nr` (to samo, co aplikacja
     dostaje w `wynik`). Inny numer albo brak linii = '' (stary sterownik, albo wynik nalezy do innej komendy). */
  function zdanieOdmowyKT(txt, nr) {
    if (!txt) return '';
    for (const l of txt.split(/\r?\n/)) {
      if (!l.startsWith('KT;')) continue;
      const r = l.slice(3), i = r.indexOf(';');
      if (i > 0 && Number(r.slice(0, i)) === nr) return r.slice(i + 1);
    }
    return '';
  }

  function mapaNazwa(slowo, tabela, obiegiIle) {
    if (slowo === null || slowo === undefined) return null;
    const kod = slowo & 0xFF;
    if (kod === 0) return '';
    let nazwa = tabela[kod];
    if (nazwa === undefined) return 'kod ' + kod;
    if (obiegiIle > 1) nazwa += ' — obieg ' + (((slowo >> 8) & 3) + 1);
    return nazwa;
  }
  function mapaIoNazwy(slDo, slDi, obiegiIle) {
    obiegiIle = obiegiIle || 1;
    if (!slDo && !slDi) return [null, null];
    return [(slDo || []).map(w => mapaNazwa(w, MAPA_KOD_DO, obiegiIle)),
            (slDi || []).map(w => mapaNazwa(w, MAPA_KOD_DI, obiegiIle))];
  }
  /*  WŁASNE NAZWY KANAŁÓW [D-493]: rejestry 4140 + 10*kanał, 2 bajty UTF-8 na słowo (starszy pierwszy),
      19 bajtów + zero. Pusta = ekran pisze nazwę fabryczną; niepusta = „Gejzer (Atrakcja 1)". */
  const AKC_NAZWY_REJ = 4140, AKC_NAZWA_SLOW = 10, AKC_NAZWA_MAX_B = 19;
  function nazwaNaSlowa(tekst) {
    let b = new TextEncoder().encode(String(tekst || '').trim());
    if (b.length > AKC_NAZWA_MAX_B) {                      /* nie tniemy w pół litery */
      let n = AKC_NAZWA_MAX_B; while (n > 0 && (b[n] & 0xC0) === 0x80) n--; b = b.slice(0, n);
    }
    const out = [];
    for (let i = 0; i < AKC_NAZWA_SLOW; i++) out.push(((b[2 * i] || 0) << 8) | (b[2 * i + 1] || 0));
    return out;
  }
  function akcNazwyZRej(g) {
    const out = []; let jest = false;
    for (let k = 0; k < 16; k++) {
      const b = [];
      for (let i = 0; i < AKC_NAZWA_SLOW; i++) {
        const v = g(AKC_NAZWY_REJ + k * AKC_NAZWA_SLOW + i);
        if (v === null) break; jest = true;
        const a = (v >> 8) & 255, c = v & 255;
        if (!a) break; b.push(a); if (!c) break; b.push(c);
      }
      out.push(b.length ? new TextDecoder().decode(new Uint8Array(b)) : '');
    }
    return jest ? out : null;
  }
  function akcNastawyZMn(slowo) {
    if (slowo(68) === null) return null;
    const out = [];
    for (let k = 0; k < 16; k++) {
      const sp = slowo(68 + k * 2), cz = slowo(69 + k * 2);
      out.push({ sposob: sp, czas: cz,
        opis: (sp !== null && sp < AKC_SPOSOBY.length) ? AKC_SPOSOBY[sp] : (sp === null ? null : 'kod ' + sp) });
    }
    return out;
  }
  function funkcjeZMn(w, o, uvZapas) {
    if (w === null || w === undefined) return { uv: uvZapas, grz: null, dol: null, pluk: null };
    return { grz: bit(w, 0 + o), dol: bit(w, 2 + o), pluk: bit(w, 4 + o), uv: bit(w, 6 + o) };
  }
  function profilZSlow(slowa) {
    if (!slowa || slowa.every(s => s === null)) return null;
    let zn = '';
    for (const s of slowa) {
      if (s === null) break;
      const hi = (s >> 8) & 0xFF, lo = s & 0xFF;
      if (hi === 0) break;
      zn += String.fromCharCode(hi);
      if (lo === 0) break;
      zn += String.fromCharCode(lo);
    }
    return zn || null;
  }
  function dataBuilda(slowo) {
    if (!slowo) return null;
    const p2 = n => String(n).padStart(2, '0');
    return (2000 + (slowo >> 9)) + '-' + p2((slowo >> 5) & 0xF) + '-' + p2(slowo & 0x1F);
  }
  /* nastawy z MN: klucze makiety serwisu (N), w jej jednostkach */
  function nastawyZMn(n) {
    const out = {};
    for (const [i, klucz, skala, rodzaj] of MN_NASTAWY) {
      let x = n(i);
      if (x === null || x === undefined) continue;
      if (Array.isArray(rodzaj)) out[klucz] = x ? rodzaj[1] : rodzaj[0];
      else if (rodzaj === 'b') out[klucz] = !!x;
      else { if (rodzaj === 'z') x = i16(x); out[klucz] = skala !== 1 ? x / skala : x; }
    }
    /* POLE 45 = ile prob (bajt dolny) | wlacznik zaleglych << 8 [D-236] - jak most.py */
    if ('pl_powt' in out) { const v = out.pl_powt | 0; out.pl_powt = v & 0xFF; out.pl_zalegle = !!(v & 0x100); }
    /* POLE 128 = korekta temperatury powietrza x10 ze znakiem [D-282]; starszy firmware go nie ma -> pomijamy */
    { const kp = n(128); if (kp !== null && kp !== undefined) out.kal_pow_kor = i16(kp) / 10; }
    return out;
  }
  /* tydzien okien z rejestrow w ukladzie 4300+ (dzien RTClib*8 + okno*2: start|0x8000, stop);
     dzien 0 = poniedzialek. [D-495] wspolne dla filtracji (4300+) i trybu cichego (5000+) -
     kodowanie IDENTYCZNE, jeden dekoder (port okna_z_rejestrow z most.py) */
  function oknaZRejestrow(g, baza) {
    const tydz = [];
    for (let dz = 0; dz < 7; dz++) {
      const b8 = (dz + 1) % 7;
      const okna = [];
      for (let k = 0; k < 4; k++) {
        const a = baza + b8 * 8 + k * 2;
        const s = g(a), e = g(a + 1);
        if (s === null || s === undefined || !(s & 0x8000)) continue;
        okna.push([(s & 0x7FFF) / 60.0, (e || 0) / 60.0]);
      }
      tydz.push(okna);
    }
    return tydz;
  }
  /* harmonogram z rejestrow: g(adr) -> liczba albo null; dzien 0 = poniedzialek.
     [D-495] `cichy` = harmonogram trybu cichego (5000 + o*60) w ksztalcie `filt` */
  function harmZRejestrow(g, o) {
    const filt = oknaZRejestrow(g, 4300 + o * 60), pluk = [];
    for (let dz = 0; dz < 7; dz++) {
      const b8 = (dz + 1) % 7;
      const v = g(4500 + o * 10 + b8);
      pluk.push((v === null || v === undefined || !(v & 0x8000)) ? null : (v & 0x7FFF) / 60.0);
    }
    const sek = g(4560 + o * 20 + 1);
    return { filt: filt, pluk: pluk, sek: sek || 0, cichy: oknaZRejestrow(g, CICHY_HARM + o * CICHY_HARM_KROK) };
  }
  /* TRYB CICHY [D-495, 2026-09-26] - port cichy_z_rejestrow z most.py, 1:1
     WEJSCIA:  rejestry z 06b_tryb_cichy.h [7]: 3328+o stan (bity), 3330+o minuty do konca,
               5120+o*10 +1 sposob / +2 czas. Aplikacja ma je z lustra (paczki `zm`, zakresy SIEC_ZM_R),
               strona na AP i bridge - z odczytu /rej.
     CO Z CZEGO WYNIKA: bit 0 „funkcja jest" (przelew + zawor przypisany) rozstrzyga o wszystkim -
               bez niego nie ma kafla, bloczka ani sekcji serwisu („nie pokazuj, czego nie ma").
               Lustro aplikacji niesie 0 tam, gdzie rejestru nie da sie odczytac - 0 to tez „nie ma".
     WYJSCIA:  plaskie pola `cichy_*` swiata - te same klucze co w most.py (sonda parytetu). */
  const CICHY_HARM = 5000, CICHY_HARM_KROK = 60, CICHY_NAST = 5120, CICHY_NAST_KROK = 10,
        CICHY_STAN = 3328, CICHY_POZOST = 3330;
  function cichyZRejestrow(g, o) {
    const s = g(CICHY_STAN + o);
    const jest = s !== null && s !== undefined && !!(s & 1);
    if (!jest) return { cichy_jest: false, cichy_zadany: false, cichy_zawor: false, cichy_okno: false,
                        cichy_zwarty: false, cichy_ubytek: false, cichy_ogr: false, cichy_powod: 0, cichy_zostalo: 0,
                        cichy_sposob: null, cichy_czas: null };
    const n = CICHY_NAST + o * CICHY_NAST_KROK;
    return { cichy_jest: true,
             cichy_zadany: bit(s, 1),          /* tryb cichy wlaczony (zadanie) */
             cichy_zawor: bit(s, 2),           /* zawor pod napieciem = ssanie z dna */
             cichy_okno: bit(s, 3),            /* okno trzeciego harmonogramu trwa */
             cichy_zwarty: bit(s, 4),          /* przycisk przy niecce zwarty */
             cichy_ubytek: bit(s, 5),          /* tempo ubytku liczone bilansem trybu cichego */
             cichy_ogr: bit(s, 6),             /* ogranicznik: chwila przerwy po zbyt wielu załączeniach [2026-09-26] */
             cichy_powod: (s >> 8) & 0x0F,     /* 1 pompa stoi, 2 nadmiar, 3 plukanie, 4 brak pomiaru, 5 test */
             cichy_zostalo: g(CICHY_POZOST + o) || 0,
             cichy_sposob: g(n + 1), cichy_czas: g(n + 2) };
  }
  /* zapis przyjety = wartosc JEST w rejestrze -> od razu do pamieci (harmonogram, sposob, czas);
     ⚠ NIE komenda 5120/5130 - tam odczyt niesie STAN, ktory ustala dopiero przebieg sterownika */
  const cichyAdresLustra = adr =>
    (adr >= CICHY_HARM && adr < CICHY_HARM + 2 * CICHY_HARM_KROK && (adr - CICHY_HARM) % CICHY_HARM_KROK < 56)
    || (adr >= CICHY_NAST && adr < CICHY_NAST + 2 * CICHY_NAST_KROK && [1, 2].includes((adr - CICHY_NAST) % CICHY_NAST_KROK));

  /* PAKIET STANU - port swiat_z_bloku(b, obieg) z most.py, 1:1.
     b = 72 slow bloku panelu, mn = tablica MN (albo null), o = obieg */
  function swiatZBloku(b, mn, o) {
    if (!b || b.length < 70) return null;
    const p = b.slice(10 + o * 30, 40 + o * 30);
    if (p.length < 20) return null;
    const v = mn || null;
    const nast = (i, dom) => (v && i < v.length) ? v[i] : (dom === undefined ? 0 : dom);
    const nastOb = (oo, i, dom) => (!v || v.length < 45 || v[44] !== oo) ? (dom === undefined ? 0 : dom) : nast(i, dom);
    const mnSlowo = i => (v && i < v.length) ? v[i] : null;
    const wyp = p[0], st = p[6];
    /* 64 bity alarmow: 4 slowa; BigInt, bo JS liczy bitowo na 32 bitach [D-108] */
    const alarmy = BigInt(b[4]) | (BigInt(b[5]) << 16n)
                 | (BigInt(b.length > 7 ? b[7] : 0) << 32n) | (BigInt(b.length > 8 ? b[8] : 0) << 48n);
    const almBit = n => !!((alarmy >> BigInt(n)) & 1n);
    const alm = bitBasen => almBit(bitBasen + o);
    const mapy = mapaIoNazwy([0, 1, 2, 3, 4, 5, 6, 7].map(i => mnSlowo(52 + i)),
                             [0, 1, 2, 3, 4, 5, 6, 7].map(i => mnSlowo(60 + i)));
    let obiegiIle = 0;
    const obiegiJest = [];
    for (const i of [0, 1]) if (b.length > 10 + i * 30 && (b[10 + i * 30] & 1)) { obiegiIle++; obiegiJest.push(i); }
    return {
      typ: 'swiat',
      hoa: ({ 0: 'auto', 1: 'reka' })[p[14]] || 'stop',
      poziom: i16(p[3]),
      cis: p[4] / 100.0,
      temp: i16(p[1]) / 10.0,
      temp_set: i16(p[2]) / 10.0,
      grzeje: bit(st, 3) || bit(st, 4),
      grzanie_on: bit(st, 12),
      termik: alm(8),
      termikAkc: alm(34),
      awTempPowBrak: almBit(36),
      awOdcQuic: almBit(37), awOdcDziennik: almBit(38),   /* [B.0z-69] */
      awRtcOdczyt: almBit(39),                            /* [D-505] zegar nie odpowiada */
      awWejscia: almBit(40),                              /* [D-506] wejścia nieczytelne - pompy stoją */
      awNastawyFabr: almBit(41),                          /* [D-507] nastawy fabryczne po odrzuconym zapisie */
      awPiesPetli: almBit(42),                            /* [D-538] pętla bez watchdoga zadań */
      awsonda: alm(2), awmano: alm(4), awtemp: alm(6), awtempBrak: alm(28),
      /* [D-241] alarmy kwitowalne bez klucza - jak most.py */
      awDolew: alm(0), awBwNiesk: alm(12), awZuzycie: alm(19), awPrefill: almBit(o === 0 ? 21 : 32), awWyciek: alm(26),
      awRtc: almBit(17), awI2C: almBit(22), awFazy: almBit(23),
      ostrzCis: alm(30),
      zatrzask: bit(st, 7) ? (p[16] & 0xFF) : 0,
      uv_on: bit(st, 5),
      pluk: p[7] !== 0,
      bw_skip_alarm: alm(24), bw_skip_powod: p[17], bw_widelki_powod: p[18],   /* [D-245] */
      bw_pompa_pracowala: bit(st, 13), bw_zalegle: bit(st, 14),
      bw_czeka: bit(st, 10),        /* zadanie plukania odlozone do konca dolewania [D-227] */
      pluk_czas_s: nastOb(o, 21) || null,
      przezn: v ? nast(46 + o) : null,
      /* [2026-09-26] przeznaczenia WSZYSTKICH obiegów (indeks = numer obiegu) - nazwy obiegów w dzienniku i alarmach
         („dolewanie wanna 1”); przy jednym obiegu lista ma jeden element i dopisku nie ma */
      przezn_obiegow: v ? obiegiJest.map(i => nast(46 + i)) : null,
      akc_ist: (nast(48) >> (8 * o)) & 0xFF,
      akc_prac: mnSlowo(116) !== null ? (mnSlowo(116) >> (8 * o)) & 0xFF : null,
      akc_zostalo: [0, 1, 2, 3, 4, 5, 6, 7].map(k => mnSlowo(100 + o * 8 + k)),
      akc_ust: mnSlowo(117) !== null ? (mnSlowo(117) >> (8 * o)) & 0xFF : 0,
      akc_term: mnSlowo(127) !== null ? (mnSlowo(127) >> (8 * o)) & 0xFF : 0,
      akc_wl: (nast(49) >> (8 * o)) & 0xFF,
      obieg_jest: !!(wyp & 1), obieg_nr: o, obiegi_ile: obiegiIle,
      pluk_faza: p[7],
      czas: (b[2] << 16) | b[3],
      pluk_s: p.length > 8 ? p[8] : 0,
      dolewka_proc: p.length > 9 ? p[9] : 0,        /* postep dopelnienia [%] (D-127/D-226) */
      wodaAwaria: bit(st, 11),
      brakuje: p[15], zuzycie24: p[10], parowanie24: i16(p[11]), ubytek_l_h: i16(p[12]),
      bw_zrzut: p[13],
      mies_zrzut: p.length > 27 ? (p[26] | (p[27] << 16)) : 0,
      rok_zrzut: p.length > 29 ? (p[28] | (p[29] << 16)) : 0,
      di_do: b.length > 9 ? b[9] : null,
      adc_poz: p.length > 23 ? p[22] : null, adc_cis: p.length > 23 ? p[23] : null,
      mapa_v: b[0], obiegi: b[1],
      obejscia: { sonda: bit(st, 8), mano: bit(st, 9) },
      poziomStan: { sucho: bit(st, 6), dolewa: bit(st, 2),
                    wymusz: o === 0 ? alm(16) : almBit(18), pompa: bit(st, 0) },
      progiPoz: { start: nastOb(o, 0, 250), stop: nastOb(o, 1, 350), sucho: nastOb(o, 2, 100),
                  nadmiar: nastOb(o, 4, 0), hist: nastOb(o, 5, 0), zak: nastOb(o, 34, 1000),
                  przelew: !!nastOb(o, 9, 0) },
      progiCis: { min: nastOb(o, 28) / 100.0, ostrz: nastOb(o, 31) / 100.0, kryt: nastOb(o, 30) / 100.0,
                  zak: (nastOb(o, 35) || 600) / 100.0 },
      /* [D-503] reakcje na uszkodzenie czujnikow (0 pompa pracuje dalej, 1 zatrzymanie) - hala dopisuje przy
         alarmie „pompa też zatrzymana”, jak panel (hmi_modbus.c). Jak most.py. */
      reakcja: { sonda: nastOb(o, 3, 0), cisn: nastOb(o, 33, 0) },
      nast: { pl_dolewka: !!nastOb(o, 23, 0), pl_ile: nastOb(o, 24, 0), pl_blokuj: !!nastOb(o, 25, 0),
              pl_wstepna: nastOb(o, 20, 10), pl_koncowa: nastOb(o, 22, 10) },
      limit_wody: 0,
      mapa_do: mapy[0], mapa_di: mapy[1],
      akc_nast: akcNastawyZMn(mnSlowo),
      jest_uv: bit(wyp, 7), jest_grz: bit(wyp, 5) || bit(wyp, 6), grz_styk: bit(wyp, 13),
      jest_dol: bit(wyp, 4), jest_pluk: bit(wyp, 3),
      jest_roleta: bit(wyp, 12),     /* styk rolety przypisany [D-234] */
      temp_pow: b.length > 71 ? i16(b[70]) / 10.0 : null,
      temp_pow_stan: b.length > 71 ? b[71] : 0,
      funkcje: funkcjeZMn(mnSlowo(50), o, bit(wyp, 7)),
      zwloka: { grz: p.length > 20 ? p[20] : 0, uv: p.length > 21 ? p[21] : 0 },
      profil: profilZSlow([0, 1, 2, 3, 4, 5, 6, 7].map(i => mnSlowo(118 + i))),
      fw_data: dataBuilda(mnSlowo(126))
    };
  }
  /* DODATKI - port most.dodatki(): harmonogram, nastawy (MN + wylaczniki), srednia miesieczna.
     rej = {adres: wartosc} z /rej; hist pomijamy (strona historii - komenda 12, osobne zadanie) */
  function dodatki(rej, mn, o) {
    const g = a => (a in rej ? rej[a] : null);
    const out = { harm: harmZRejestrow(g, o) };
    let nast = {};
    if (mn && mn.length >= 45 && mn[44] === o) nast = nastawyZMn(i => (i < mn.length ? mn[i] : null));
    for (const [kl, adr] of WYLACZNIKI) { const v = g(adr + o); if (v !== null) nast[kl] = !!v; }
    out.nastawy = nast;
    const lo = g(3061 + 2 * o), hi = g(3062 + 2 * o);
    if (lo !== null) out.sr_mies = ((hi || 0) << 16) | lo;
    const naz = akcNazwyZRej(g); if (naz) out.akc_naz = naz;   /* [D-493] */
    Object.assign(out, cichyZRejestrow(g, o));                   /* [D-495] pola `cichy_*` */
    if (out.cichy_jest) { nast.cichy_sposob = out.cichy_sposob; nast.cichy_czas = out.cichy_czas; }
    return out;
  }
  /* obieg z bloku: pierwszy, ktory istnieje (bridge dostaje --obieg; na AP wynika z bloku) */
  function obiegZBloku(b) {
    if (b && b.length > 10 && (b[10] & 1)) return 0;
    if (b && b.length > 40 && (b[40] & 1)) return 1;
    return 0;
  }

  /* ---------------------------------------------------------- [4] KOMENDY -> REJESTRY */
  function akcNastawaNaRejestr(klucz, wart) {
    if (!klucz.startsWith('akc')) return null;
    const m = /^akc(\d+)_(sposob|czas)$/.exec(klucz);
    if (!m) return null;
    const nr = parseInt(m[1], 10);
    if (!(nr >= 0 && nr < 16)) return null;
    return [4100 + nr * 2 + (m[2] === 'sposob' ? 0 : 1), Math.round(parseFloat(wart)) & 0xFFFF];
  }
  function nastawaNaRejestr(klucz, wart, o) {
    const para = akcNastawaNaRejestr(klucz, wart);
    if (para) return para;
    const s = String(wart).trim().toLowerCase();
    for (const [k, adr] of WYLACZNIKI) if (k === klucz) return [adr + o, ['1', 'true', 'tak', 'on'].includes(s) ? 1 : 0];
    if (klucz === 'pl_zalegle') return [4560 + o * 20 + 9, ['1', 'true', 'tak', 'on'].includes(s) ? 1 : 0];   /* [D-236] */
    if (klucz === 'kal_pow_kor') return [4068, Math.round(parseFloat(wart) * 10) & 0xFFFF];   /* korekta temp. powietrza - GLOBALNA, bez obiegu [D-282] */
    /* TRYB CICHY [D-495]: poza tabela MN - 5120 + obieg*10 (+1 sposob, +2 czas [min]) */
    if (klucz === 'cichy_sposob') return [CICHY_NAST + o * CICHY_NAST_KROK + 1, Math.round(parseFloat(wart)) & 0xFFFF];
    if (klucz === 'cichy_czas')   return [CICHY_NAST + o * CICHY_NAST_KROK + 2, Math.round(parseFloat(wart)) & 0xFFFF];
    for (const [i, k, skala, rodzaj] of MN_NASTAWY) {
      if (k !== klucz) continue;
      const [baza, rel] = MN_UKLAD[i];
      const adr = baza + o * 20 + rel;
      let w;
      if (Array.isArray(rodzaj)) w = (s === rodzaj[1]) ? 1 : 0;
      else if (rodzaj === 'b') w = ['1', 'true', 'tak', 'on'].includes(s) ? 1 : 0;
      else w = Math.round(parseFloat(wart) * (skala !== 1 ? skala : 1));
      return [adr, w & 0xFFFF];
    }
    return null;
  }
  /* zwraca {zapisy: [[adr, wart], ...]} albo {blad: '...'} */
  function komendaNaZapisy(co, wart, o) {
    const w = (wart === undefined || wart === null) ? '' : String(wart);
    if (co === 'rej') {
      const [a, v] = w.split(':'); const adr = parseInt(a, 10), val = parseInt(v, 10);
      if (!Number.isFinite(adr) || !Number.isFinite(val)) return { blad: 'format: wart="adres:wartosc"' };
      return { zapisy: [[adr, val]] };
    }
    if (co === 'akc') {
      const [k, s] = w.split(':'); const kan = parseInt(k, 10), st = parseInt(s, 10);
      if (!Number.isFinite(kan) || !Number.isFinite(st)) return { blad: 'format: wart="kanal:1/0"' };
      return { zapisy: [[4067, ((kan & 0xFF) << 8) | (st ? 1 : 0)]] };
    }
    if (co === 'nastawa') {
      const i = w.indexOf(':'); if (i < 0) return { blad: 'format: wart="klucz:wartosc"' };
      const mNaz = /^akc(\d+)_nazwa$/.exec(w.slice(0, i));       /* [D-493] nazwa = dziesięć słów */
      if (mNaz) {
        const k = parseInt(mNaz[1], 10); if (!(k >= 0 && k < 16)) return { blad: 'kanał poza zakresem' };
        if (new TextEncoder().encode(w.slice(i + 1).trim()).length > AKC_NAZWA_MAX_B)
          return { blad: 'nazwa za długa - najwyżej ' + AKC_NAZWA_MAX_B + ' bajtów (polska litera liczy się podwójnie)' };
        return { zapisy: nazwaNaSlowa(w.slice(i + 1)).map((s, j) => [AKC_NAZWY_REJ + k * AKC_NAZWA_SLOW + j, s]) };
      }
      const para = nastawaNaRejestr(w.slice(0, i), w.slice(i + 1), o);
      return para ? { zapisy: [para] } : { blad: 'nieznana nastawa: ' + w.slice(0, i) };
    }
    if (co === 'temp-set') { const t = Math.max(10, Math.min(40, parseFloat(w))); return { zapisy: [[4000 + o, Math.round(t * 10)]] }; }
    if (co === 'grzanie') return { zapisy: [[4002 + o, (w === 'true' || w === '1') ? 1 : 0]] };
    if (co === 'kasuj-zatrzask') return { zapisy: [[4022 + o, 1]] };
    if (co === 'kasuj-awarie-wodna') return { zapisy: [[4052 + o, 1]] };
    if (co === 'reset-wody') return { zapisy: [[4054 + o, 1]] };
    if (co === 'plukaj') return { zapisy: [[4006 + o, 1]] };
    if (co === 'kasuj-alarm') return { zapisy: [[4008, parseInt(w, 10)]] };
    if (co === 'zdejmij-ochrony') return { zapisy: [[4062, parseInt(w, 10) & 0x7F]] };
    if (co === 'wycisz-alarmy') {
      let m; try { m = BigInt(w); } catch (e) { return { blad: 'wycisz-alarmy: oczekiwana liczba 64-bit' }; }
      return { zapisy: [0, 1, 2, 3].map(i => [4058 + i, Number((m >> BigInt(16 * i)) & 0xFFFFn)]) };
    }
    if (co === 'ustaw-czas') {
      /* bridge: unix = timegm(localtime) - sterownik chodzi na czasie lokalnym */
      const unix = /^\d+$/.test(w) ? parseInt(w, 10) : Math.floor(Date.now() / 1000 - new Date().getTimezoneOffset() * 60);
      return { zapisy: [[4034, (unix >> 16) & 0xFFFF], [4035, unix & 0xFFFF]] };
    }
    if (['hoa', 'termik', 'termikm', 'przycisk', 'poz', 'cis', 'model', 'zrzut', 'parowanie', 'wy', 'stan', 'we',
         'mapa', 'spocz', 'czujnik', 'zakres'].includes(co))
      return { blad: 'komenda testera - na stronie ze sterownika nie ma testera' };
    return { blad: 'nieznana komenda: ' + co };
  }

  /* ---------------------------------------------------------- [5] KLIENT AP */
  const M = {
    tryb: null,            /* null = nieaktywny, 'ap' = strona ze sterownika */
    obieg: 0,
    ost: { mb: null, mn: null, t: null, k: null, rej: {} },
    /* liczy pakiet z surowych danych (uzywa tez probe parytetu pod bridge'em) */
    swiatZ(mbTxt, mnTxt, rej, o) {
      const mb = Array.isArray(mbTxt) ? mbTxt : parsujLinie(mbTxt, 'MB;');
      const mn = Array.isArray(mnTxt) ? mnTxt : parsujLinie(mnTxt, 'MN;');
      if (!mb) return null;
      if (o === undefined || o === null) o = obiegZBloku(mb);
      const s = swiatZBloku(mb, mn, o);
      if (!s) return null;
      return Object.assign(s, dodatki(rej || {}, mn, o));
    },
    komendaNaZapisy, nastawaNaRejestr, nastawyZMn, harmZRejestrow, cichyZRejestrow, swiatZBloku, parsujLinie, dodatki, obiegZBloku,
    MN_NASTAWY, MN_UKLAD, WYLACZNIKI,

    /* pobierz rejestry /rej po 16 (jak bridge po USB) do M.ost.rej */
    async rejestry(o) {
      const zakresy = [[4300 + o * 60, 56], [4500 + o * 10, 7], [4560 + o * 20 + 1, 1], [4024, 28], [3061 + 2 * o, 2],
                       /* TRYB CICHY [D-495]: stan (oba obiegi), zadanie/sposob/czas, harmonogram */
                       [CICHY_STAN, 4], [CICHY_NAST + o * CICHY_NAST_KROK, 3], [CICHY_HARM + o * CICHY_HARM_KROK, 56]];
      /* nazwy kanałów [D-493] - 160 słów, rzadko się zmieniają: co minutę, nie co 10 s */
      if (!M.ost.nazwyMs || Date.now() - M.ost.nazwyMs > 60000) { zakresy.push([AKC_NAZWY_REJ, 160]); M.ost.nazwyMs = Date.now(); }
      const c = Object.assign({}, M.ost.rej);
      for (const [adr, ile] of zakresy) {
        for (let start = adr; start < adr + ile; start += 16) {
          const n = Math.min(16, adr + ile - start);
          try {
            const r = await fetch('/rej?adr=' + start + '&ile=' + n, { cache: 'no-store' });
            const d = await r.json();
            if (d && Array.isArray(d.wartosci)) d.wartosci.forEach((x, i) => { if (x !== null) c[start + i] = x; });
          } catch (e) { return; }
        }
      }
      M.ost.rej = c;
    },
    /* TRYB CICHY - STAN CO SEKUNDE [D-495]: kafel stoi na rejestrach, nie na bloku, wiec przy /rej
       co 10 s dotkniecie kafla albo przycisk przy niecce pokazywaly sie po kilku sekundach.
       Dwa krotkie odczyty (stan 3328-3331, zadanie 5120+o*10) i TYLKO gdy funkcja jest. */
    async rejestryCichy(o) {
      if (!((M.ost.rej[CICHY_STAN + o] || 0) & 1)) return;
      const c = Object.assign({}, M.ost.rej);
      for (const [adr, ile] of [[CICHY_STAN, 4], [CICHY_NAST + o * CICHY_NAST_KROK, 1]]) {
        try {
          const r = await fetch('/rej?adr=' + adr + '&ile=' + ile, { cache: 'no-store' });
          const d = await r.json();
          if (d && Array.isArray(d.wartosci)) d.wartosci.forEach((x, i) => { if (x !== null) c[adr + i] = x; });
        } catch (e) { return; }
      }
      M.ost.rej = c;
    },
    /* jedna komenda: zapisy po kolei, wynik z /blok.txt (linia K;nr,adr,wart,wynik) */
    async wyslij(co, wart) {
      const t = komendaNaZapisy(co, wart, M.obieg);
      if (t.blad) return { ok: false, opis: t.blad };
      let ostOpis = '';
      for (const [adr, val] of t.zapisy) {
        let nr = 0;
        try {
          const r = await fetch('/cmd?adr=' + adr + '&wart=' + val, { cache: 'no-store' });
          const txt = await r.text();
          if (!r.ok) return { ok: false, opis: 'sterownik: ' + txt };
          const m = /;(\d+)/.exec(txt); nr = m ? parseInt(m[1], 10) : 0;
        } catch (e) { return { ok: false, opis: 'sterownik nie odpowiada: ' + e }; }
        /* wynik: petla logiki wykonuje kolejke w nastepnym ticku; czekamy max 2 s */
        let wynik = null, zdanie = '';
        for (let i = 0; i < 20 && nr; i++) {
          await new Promise(res => setTimeout(res, 100));
          try {
            const r = await fetch('/blok.txt', { cache: 'no-store' }); const txt = await r.text();
            const k = parsujLinie(txt, 'K;');
            if (k && k[0] >= nr) { wynik = k; zdanie = zdanieOdmowyKT(txt, nr); break; }
          } catch (e) { break; }
        }
        /* [D-533] ZDANIE STEROWNIKA do odmowy (linia KT;) - to samo, co aplikacja dostaje w `wynik`; starszy sterownik
           linii KT; nie wysyla - wtedy jak dawniej sam kod */
        if (wynik && wynik[0] === nr && wynik[3] !== 0)
          return { ok: false, opis: 'sterownik ODMOWIL zapisu ' + adr + '=' + val + (zdanie ? ': ' + zdanie : '') + ' (kod ' + wynik[3] + ')' };
        /*  BRAK POTWIERDZENIA TO NIE JEST SUKCES [D-318, audyt etapu 3 pkt 6; zasada 10].
            Czekamy dwie sekundy na linię `K;` z numerem NASZEJ komendy. Gdy nie przyjdzie - albo
            przyjdzie numer dalszy, czyli nasz wynik już przepadł - sterownik mógł wykonać i mógł
            odmówić, a aplikacja nie wie która. Dawniej wracało wtedy „ok" i użytkownik widział
            „zrobione" nad rzeczą, która się nie stała. Teraz mówimy prawdę i odsyłamy do ekranu. */
        if (!wynik || wynik[0] !== nr)
          return { ok: false, nieznany: true, opis: 'sterownik nie potwierdził zapisu ' + adr + '=' + val + ' - sprawdź na ekranie' };
        ostOpis = 'rejestr ' + adr + ' <- ' + val;
        /* [D-495] przyjety zapis harmonogramu / nastaw trybu cichego od razu w pamieci - inaczej
           ekran po wyjsciu z edytora wracal na 10 s do stanu sprzed zmiany (wyglada jak odmowa) */
        if (cichyAdresLustra(adr)) M.ost.rej = Object.assign({}, M.ost.rej, { [adr]: val & 0xFFFF });
      }
      return { ok: true, opis: ostOpis };
    },
    /* start trybu AP: podaj(d) dostaje {polaczony, swiat, wiek_s} jak z most.html */
    start(podaj) {
      if (M.tryb) return;
      M.tryb = 'ap';
      /* przechwycenie fetch('/cmd?co=...') - makieta ma 9 miejsc, ktore wolaja bridge tak,
         jak most.html; tu tlumaczymy na rejestry i odpowiadamy tym samym JSON-em */
      const f0 = window.fetch.bind(window);
      window.fetch = function (u, opt) {
        const s = String(u);
        if (s.startsWith('/cmd?co=')) {
          const q = new URLSearchParams(s.slice(5));
          return M.wyslij(q.get('co'), q.get('wart')).then(r =>
            new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return f0(u, opt);
      };
      let licz = 0;
      const cykl = async () => {
        let txt = null;
        try { const r = await fetch('/blok.txt', { cache: 'no-store' }); if (r.ok) txt = await r.text(); } catch (e) { txt = null; }
        const mb = parsujLinie(txt, 'MB;'), mn = parsujLinie(txt, 'MN;'), t = parsujLinie(txt, 'T;');
        M.ost.mb = mb; M.ost.mn = mn; M.ost.t = t; M.ost.k = parsujLinie(txt, 'K;');
        if (mb) M.obieg = obiegZBloku(mb);
        if (licz % 10 === 0) await M.rejestry(M.obieg);
        else await M.rejestryCichy(M.obieg);        /* [D-495] stan trybu cichego co 1 s, gdy funkcja jest */
        licz++;
        /* wiek bloku: T;ms_od_MB,ms_od_MN,uptime - sterownik nadaje blok co ~1 s */
        const wiek = t ? t[0] / 1000 : null;
        const polaczony = !!mb && (wiek === null || wiek < 5);
        const swiat = polaczony ? M.swiatZ(mb, mn, M.ost.rej, M.obieg) : null;
        podaj({ polaczony: polaczony && !!swiat, swiat: swiat, wiek_s: wiek === null ? 0 : wiek });
        setTimeout(cykl, 1000);
      };
      cykl();
    }
  };
  /* wystawione dla makiety: dziennik zdarzeń tłumaczy numer rejestru na etykietę nastawy [D-295] */
  M.nastawaNaRejestr = (klucz, wart, o) => nastawaNaRejestr(klucz, wart, o);

  /* ---------------------------------------------------------- [5a] TRWA EDYCJA
     [karta Astry 15, luka 9.1-d z ODPOWIEDZ_NA_ROZWOJ_ASTRY.md, 30.09.2026]
     WEJŚCIA:  źródła edycji zgłoszone przez makiety: `M.edycjaZrodlo(nazwa, czyOtwarty)`, gdzie
               czyOtwarty() mówi, czy TEN edytor jest w tej chwili otwarty (hala: edytor harmonogramu,
               pola rezerwy w oknie USTAWIENIA; serwis: edytor nastawy +/- przed ZAPISZ, wpis sieci,
               zegar, nazwa kanału, nowy PIN);
               dotknięcia i klawisze w dokumencie = ostatnia czynność człowieka.
     CO Z CZEGO WYNIKA: edycja TRWA, gdy którekolwiek źródło odpowiada „otwarty" I od ostatniej
               czynności człowieka minęło mniej niż EDYCJA_WYGASA_MS.
     WYJŚCIA:  `M.trwaEdycja()` - prawda / fałsz; `M.edycjeOtwarte()` - nazwy otwartych (probe'y, testy);
               `M.zajety()` = trwa edycja ALBO komenda czeka na wynik. O `zajety()` pyta nagłówek
               hmi.html (zbuduj_pwa.py), zanim przeładuje stronę po aktualizacji service workera -
               przy „zajęty" ponawia za 10 s.

     PO CO: service worker przeładowuje stronę po 30 s w tle i nie wtedy, gdy komenda czeka na wynik.
       Edytorów to nie obejmowało: człowiek ustawia okno filtracji (najpierw „od", potem „do") albo
       kręci nastawę w serwisie przed ZAPISZ, przełącza się na chwilę do innej aplikacji (telefon,
       hasło z menedżera, zdjęcie tabliczki) - i wraca na ekran główny, bez swojej zmiany.

     ⚠ ŹRÓDŁO JEST PYTANE, A NIE ZGŁASZA SIĘ SAMO. Stan edytora żyje w makiecie (S.ekran, H.edy,
       wpisane pola) i tylko ona wie, co znaczy „otwarty". Pytamy w chwili decyzji, więc marker nie
       może się rozjechać z ekranem (np. zostać „otwarty" po wyjściu drogą, która zapomniała go zdjąć).
     ⚠ WYGASANIE PO BEZCZYNNOŚCI, NIE OD OTWARCIA - I ODNAWIA JE TYLKO CZŁOWIEK. Ekran przerysowuje się
       z każdą paczką ze sterownika (kilka razy na sekundę, także w tle), więc gdyby „jestem otwarty"
       odnawiało czas, edytor zostawiony w kieszeni blokowałby aktualizację bez końca. Zegar odnawiają
       wyłącznie dotknięcie i klawisz - nie rysowanie i nie pytanie o stan.
     ⚠ WYJĄTEK W ŹRÓDLE = ŹRÓDŁO MILCZY (fałsz). Błąd w makiecie nie może zatrzymać aktualizacji,
       która może go właśnie naprawiać. */
  /*  ILE BEZCZYNNOŚCI, ZANIM OTWARTY EDYTOR PRZESTAJE WSTRZYMYWAĆ AKTUALIZACJĘ [ms].
      10 min, bo:
        1. to ten sam czas, po którym menu serwisowe samo wylogowuje (panel4_serwis.html, auto-logout
           10 min od ostatniego dotknięcia - wychodzi na start i zamyka edytor) i po którym sklejka nie
           odtwarza już sesji serwisu (zbuduj_hmi.py, D-225b). Dłuższe czekanie chroniłoby edycję,
           którą aplikacja i tak uznaje za porzuconą;
        2. mieści przerwy dłuższe niż 30 s z nagłówka (rozmowa telefoniczna, szukanie hasła, zejście
           do pompy sprawdzić tabliczkę) - na krótkie przełączenia wystarcza samo 30 s w tle;
        3. telefon odłożony z otwartym edytorem nie siedzi na starym kodzie godzinami: po 10 min
           przeładowanie przechodzi przy najbliższym ponowieniu (co 10 s) - ⚠ o ile przeglądarka nie
           zamroziła strony w tle (Chrome na Androidzie po ~5 min); wtedy przy następnym pobycie w tle. */
  const EDYCJA_WYGASA_MS = 10 * 60 * 1000;
  const zrodlaEdycji = new Map();            /* nazwa -> czyOtwarty() */
  let edycjaOstCzynnosc = Date.now();        /* ostatnie dotknięcie / klawisz człowieka */
  M.edycjaZrodlo = (nazwa, czyOtwarty) => {
    if (typeof czyOtwarty === 'function') zrodlaEdycji.set(String(nazwa), czyOtwarty);
    else zrodlaEdycji.delete(String(nazwa));   /* null = wyrejestruj */
  };
  M.edycjeOtwarte = () => {
    const out = [];
    zrodlaEdycji.forEach((f, n) => { let t = false; try { t = !!f(); } catch (e) { t = false; } if (t) out.push(n); });
    return out;
  };
  /*  [30.09, przegląd k15] Zegar ścienny może się COFNĄĆ (telefon poprawia czas z sieci) - różnica wychodzi wtedy
      ujemna i bez `dt >= 0` edycja „trwałaby” do czasu, aż zegar dogoni dawny timestamp. Ujemna = wygasła. */
  M.trwaEdycja = () => { const dt = Date.now() - edycjaOstCzynnosc;
    return dt >= 0 && dt < EDYCJA_WYGASA_MS && M.edycjeOtwarte().length > 0; };
  M.EDYCJA_WYGASA_MS = EDYCJA_WYGASA_MS;     /* do wglądu dla testów i sond, nie do zmiany */
  /*  Czynność człowieka: tylko zdarzenia, które robi ręka (nie przerysowanie, nie paczka ze sterownika).
      Faza przechwytywania - zanim ekran zdąży przebudować węzeł, w który trafił palec. */
  if (typeof document !== 'undefined' && document.addEventListener)
    ['pointerdown', 'keydown', 'input'].forEach(z =>
      document.addEventListener(z, () => { edycjaOstCzynnosc = Date.now(); }, true));
  /*  Komendy czekające na wynik zna tylko klient chmury [6] - podmienia tę funkcję przy starcie.
      Na AP i pod bridge'em nie ma service workera, więc zostaje sam marker edycji. */
  let komendyCzekaja = () => false;
  M.zajety = () => M.trwaEdycja() || komendyCzekaja();

  /* ---------------------------------------------------------- [5b] HISTORIA POMIARÓW [D-511]
     [Tomasz 30.09.2026: „aplikacja buduje wykres powoli, chciałbym, żeby pobrała i trzymała dane ze sterownika KOMPLETNE
      z całej historii pomiaru”]
     WEJŚCIA:  bajty tematu `<prefiks>/historia` (nagłówek „#H;…\n” + bloki formatu z 21b_historia_pomiarow.h [1]).
     CO Z CZEGO WYNIKA: HI = CZYSTE FUNKCJE (bez przeglądarki - test offline narzedzia_hmi/test_historia_apka.js):
               format (CRC-32 jak zlib, dekoder z resynchronizacją, koder do złotej próbki), odbiór strumienia
               (numer kawałka, luka = wznowienie od ostatniej dobrej próbki, dubel drugą drogą = pomijamy),
               scalanie po czasie, rekord dnia do bazy, serie wykresu, plan dociągania i stan kompletu.
               HiBaza = IndexedDB w telefonie (pełna kopia, rekord na dzień UTC, meta na obiekt).
     WYJŚCIA:  M.HI, M.HiBaza; pobieranie (impure) siedzi w kliencie chmury [6] jako M.historia.
     ⚠ FORMAT JEST TRZECIM ZAPISEM TEGO SAMEGO UKŁADU (firmware 21b, Python historia_format.py, tu) - złota próbka
       z nagłówka firmware spina wszystkie trzy (static_assert, test_historia_format.py, test_historia_apka.js).
     ⚠ Bridge (PC) i strona na AP tego nie używają - funkcje tylko leżą; IndexedDB otwiera się dopiero na prośbę. */
  const HI = (function () {
    const MAGIA0 = 0x48, MAGIA1 = 0x49, WERSJA = 1, NAGL_B = 16, WSP_B = 6, OB_B = 9, OBIEGOW = 2, BLOK_MAX = 255;
    const BRAK = -32768, DOBA = 86400, MIN_S = 60, BEZ_KONCA = 0xFFFFFFFF;
    const B_POMPA = 1, B_GRZANIE = 2, B_PLUKANIE = 4, B_DOLEWANIE = 8, B_OBEJ_SONDY = 16, B_OBEJ_MANO = 32, F_ALARM = 1;
    /*  KODY ODMÓW (21b [6] HI_T_ODMOWA_*): 3 zajęte, 5 obca wersja (nadaje APLIKACJA, nie sterownik), 6 trwa aktualizacja
        [przegląd historii 1, S5] - test_historia_format.py sprawdza, że firmware ma te same liczby. */
    const ODM_ZAJETE = 3, ODM_WERSJA = 5, ODM_AKTUALIZACJA = 6;
    /*  3332 b8 (21b HI_R_KARTA_WSTRZYMANA) [przegląd historii 1, S4]: karta zamontowana, ale chwilowo wstrzymana (aktualizacja
        panelu) - `od_dost` w nagłówku `start` nie jest wtedy prawdziwym początkiem danych sterownika. */
    const R_KARTA_WSTRZYMANA = 0x100;
    /*  3332 b6 / b9 [przegląd historii 2, S3] - dwie RÓŻNE rzeczy: b6 = historia ODCIĘTA po powtarzających się awariach
        (serwis: konsola ODCIECIE), b9 = WYŁĄCZONA W FIRMWARZE sterownika (ENABLE_HISTORIA=0 - świadomie, nie awaria). */
    const R_ODCIETA = 0x40, R_WYL_W_OBRAZIE = 0x200;
    /* serie wykresu (wykres_temp.js SERIE): zapis = round(wartość × skala) + przesunięcie, w 0..46655 */
    const SERIE_DOM = { temp: { skala: 100, przes: 0 }, cis: { skala: 100, przes: 0 }, poz: { skala: 1, przes: 5000 } };
    const ZAPIS_MAX = 46655;
    let TAB = null;
    const tablica = () => {
      if (TAB) return TAB;
      TAB = new Uint32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); TAB[n] = c >>> 0; }
      return TAB;
    };
    /* CRC-32 jak zlib (odbity 0xEDB88320, początek i koniec zanegowane) - ten sam w firmware (hi_crc32) i Pythonie */
    function crc32(u8, crc, od, doK) {
      const T = tablica(); let c = (~(crc || 0)) >>> 0;
      const n = doK === undefined ? u8.length : doK;
      for (let i = od || 0; i < n; i++) c = T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
      return (~c) >>> 0;
    }
    const obiegow = m => { let n = 0; for (let i = 0; i < OBIEGOW; i++) if (m & (1 << i)) n++; return n; };
    const rozmiar = m => WSP_B + OB_B * obiegow(m);
    const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    const s16 = (b, o) => { const v = b[o] | (b[o + 1] << 8); return v >= 0x8000 ? v - 0x10000 : v; };

    /*  DEKODER: ciąg bloków -> {probki, bledy}. Próbka = {czas, flagi, maska, ob: [null | {t, z, c, p, b}]} (indeks =
        obieg sterownika, jak `obieg_nr` w `swiat`); t = temperatura ×100, z = zadana ×10, c = ciśnienie ×100 [bar],
        p = poziom [mm], b = bity (pompa, grzanie, płukanie, dolewanie, obejście sondy, obejście manometru).
        BRAK (-32768) zostaje BRAK - nigdy zero. Śmieć / zły CRC / obca wersja / blok dłuższy niż reszta = szukamy
        następnej magii (jak firmware _hi_kawalek_pliki i Python dekoduj) - dobre bloki za śmieciem nie przepadają. */
    function dekoduj(u8) {
      const probki = []; let bledy = 0, i = 0; const n = u8 ? u8.length : 0;
      const dalej = () => { bledy++; let j = i + 1; while (j + 1 < n && !(u8[j] === MAGIA0 && u8[j + 1] === MAGIA1)) j++; i = (j + 1 < n) ? j : n; };
      while (i + NAGL_B <= n) {
        if (u8[i] !== MAGIA0 || u8[i + 1] !== MAGIA1 || u8[i + 2] !== WERSJA) { dalej(); continue; }
        const maska = u8[i + 3], rozm = u8[i + 4], ile = u8[i + 5];
        if (!maska || (maska >> OBIEGOW) || rozm !== rozmiar(maska) || !ile) { dalej(); continue; }
        const dl = NAGL_B + ile * rozm;
        if (i + dl > n) { dalej(); continue; }
        if (crc32(u8, crc32(u8, 0, i, i + 12), i + NAGL_B, i + dl) !== u32(u8, i + 12)) { dalej(); continue; }
        for (let k = 0; k < ile; k++) {
          let o = i + NAGL_B + k * rozm;
          const p = { czas: u32(u8, o), flagi: u8[o + 4], maska, ob: [] };
          o += WSP_B;
          for (let ob = 0; ob < OBIEGOW; ob++) {
            if (!(maska & (1 << ob))) { p.ob.push(null); continue; }
            p.ob.push({ t: s16(u8, o), z: s16(u8, o + 2), c: s16(u8, o + 4), p: s16(u8, o + 6), b: u8[o + 8] });
            o += OB_B;
          }
          probki.push(p);
        }
        i += dl;
      }
      if (i < n) bledy++;                                     /* resztka krótsza niż nagłówek - urwany zapis */
      return { probki, bledy };
    }
    /*  KODER (złota próbka w teście i ewentualny eksport) - te same bajty co hi_koduj_blok w firmware. */
    function kodujBlok(probki, maska) {
      if (!probki || !probki.length || probki.length > BLOK_MAX) throw new Error('blok ma 1..255 próbek');
      if (!maska || (maska >> OBIEGOW)) throw new Error('zła maska obiegów');
      const rozm = rozmiar(maska), u8 = new Uint8Array(NAGL_B + probki.length * rozm), dv = new DataView(u8.buffer);
      u8[0] = MAGIA0; u8[1] = MAGIA1; u8[2] = WERSJA; u8[3] = maska; u8[4] = rozm; u8[5] = probki.length;
      dv.setUint32(8, probki[0].czas >>> 0, true);
      probki.forEach((p, k) => {
        let o = NAGL_B + k * rozm;
        dv.setUint32(o, p.czas >>> 0, true); u8[o + 4] = p.flagi & 0xFF; o += WSP_B;
        for (let ob = 0; ob < OBIEGOW; ob++) {
          if (!(maska & (1 << ob))) continue;
          const h = p.ob[ob];
          dv.setInt16(o, h.t, true); dv.setInt16(o + 2, h.z, true); dv.setInt16(o + 4, h.c, true); dv.setInt16(o + 6, h.p, true);
          u8[o + 8] = h.b & 0xFF; o += OB_B;
        }
      });
      dv.setUint32(12, crc32(u8, crc32(u8, 0, 0, 12), NAGL_B, u8.length), true);
      return u8;
    }
    /*  Nagłówek wiadomości tematu `historia`: „#H;pola…\n” + bajty bloków. null = to nie nasza wiadomość. */
    function naglowek(u8) {
      if (!u8 || u8.length < 4 || u8[0] !== 0x23 || u8[1] !== 0x48 || u8[2] !== 0x3B) return null;
      let k = 3; while (k < u8.length && u8[k] !== 0x0A) k++;
      if (k >= u8.length) return null;
      let s = ''; for (let i = 3; i < k; i++) s += String.fromCharCode(u8[i]);   /* sterownik pisze ASCII */
      return { pola: s.split(';'), dane: u8.subarray(k + 1) };
    }

    /*  ODBIÓR STRUMIENIA - stan jednej prośby. `przyjmij` zwraca, co zrobić:
          obcy   - inna prośba / śmieć (spóźniony kawałek zastąpionej prośby, druga aplikacja) - nic;
          dubel  - kawałek o numerze, który już był (druga droga, powtórka) - nic;
          start  - nagłówek (początek danych na nośnikach, zegar, wersja formatu);
          dane   - próbki z [od, do] (bloki idą w całości, filtrujemy tu);
          luka   - brakuje kawałka (także na końcu: `koniec` mówi, ile ich było) - wznowić od `od`;
          koniec - komplet; odmowa - kod + tekst sterownika (zasada 10: aplikacja pokazuje go wprost); stop. */
    const odbior = (id, od, dokad) => ({ id, od: od || 0, dokad: dokad || 0, nr: 0, probek: 0, ost: 0, start: null, koniec: false, uszkodzonych: 0 });
    const wznowOd = s => (s.ost ? s.ost + 1 : s.od);
    function przyjmij(s, u8) {
      const h = naglowek(u8);
      if (!h) return { co: 'obcy' };
      const id = +h.pola[0], rodzaj = h.pola[1];
      /* odmowa bez numeru (#H;0;…) = obraz bez historii albo zły format - tylko dopóki nie przyszedł start */
      if (rodzaj === 'odmowa' && (id === s.id || (id === 0 && !s.start && !s.nr)))
        return { co: 'odmowa', kod: +h.pola[2] || 0, tekst: h.pola.slice(3).join(';') };
      if (id !== s.id) return { co: 'obcy' };
      if (rodzaj === 'start') {
        s.start = { od: +h.pola[2], do: +h.pola[3], od_dost: +h.pola[4], teraz: +h.pola[5], wersja: +h.pola[6], rej: +h.pola[7] };
        /* `lokalna` = odmawia aplikacja, sterownik nadaje dalej - klient wysyła `stop` */
        if (s.start.wersja !== WERSJA)
          return { co: 'odmowa', kod: ODM_WERSJA, lokalna: true, tekst: 'sterownik nadaje historię w formacie ' + s.start.wersja + ', a apka zna ' + WERSJA + ' - zaktualizuj apkę' };
        /*  [przegląd historii 1, S4] karta sterownika chwilowo wstrzymana, a prośba sięga PRZED to, co sterownik teraz widzi:
            strumień oddałby tylko część (np. 4 h z RAM zamiast 7 dni), a `koniec` wyglądałby na komplet. Odkładamy jak przy
            aktualizacji (6) - sterownik nadaje, więc odmowa „lokalna” (klient wysyła `stop`) i ponowienie po czasie. */
        if ((s.start.rej & R_KARTA_WSTRZYMANA) && s.od < s.start.od_dost)
          return { co: 'odmowa', kod: ODM_AKTUALIZACJA, lokalna: true, tekst: 'karta sterownika chwilowo wstrzymana (aktualizacja panelu) - starsza historia po jej końcu' };
        return { co: 'start' };
      }
      if (rodzaj === 'stop') return { co: 'stop' };
      if (rodzaj === 'koniec') {
        const kawalkow = +h.pola[6];
        if (kawalkow > s.nr) return { co: 'luka', od: wznowOd(s), brak: 'koniec po ' + kawalkow + ' kawałkach, doszło ' + s.nr };
        s.koniec = true;
        /*  [przegląd historii 2, W1] pole 8 (pola[7]) = bajty uszkodzonego zapisu w plikach dni, dotyczącego prośby, którego
            sterownik NIE uzupełnił z drugiego nośnika (21b [1b] HiSmiec, zgłasza _hi_dzien_koniec) - tych próbek sterownik nie ma. Starszy
            sterownik pola nie wysyła = 0 (jak dotąd). Dziura, którą da się uzupełnić, uzupełnia SAM sterownik (dzień czytany
            drugi raz z drugiego nośnika) - także dla aplikacji sprzed tej poprawki. */
        s.uszkodzonych = Math.max(0, +h.pola[7] || 0);
        return { co: 'koniec', probek: s.probek, uszkodzonych: s.uszkodzonych };
      }
      if (!/^\d+$/.test(rodzaj || '')) return { co: 'obcy' };
      const nr = +rodzaj;
      if (nr < s.nr) return { co: 'dubel' };
      if (nr > s.nr) return { co: 'luka', od: wznowOd(s), brak: 'kawałek ' + nr + ' zamiast ' + s.nr };
      const d = dekoduj(h.dane), g = s.dokad || BEZ_KONCA;
      const probki = d.probki.filter(p => p.czas >= s.od && p.czas <= g);
      s.nr++; s.probek += probki.length;
      for (const p of probki) if (p.czas > s.ost) s.ost = p.czas;
      return { co: 'dane', probki, bledy: d.bledy };
    }
    /*  Postęp pobierania 0..1: od początku danych (późniejszy z `od0` i początku na nośnikach) do końca zakresu.
        `od0` i `ost` z CAŁEGO pobierania (po wznowieniu nowa prośba zaczyna od luki - pasek nie może skakać wstecz). */
    function postep(s, terazUtc, od0, ost) {
      if (!s) return 0;
      if (s.koniec) return 1;
      const st = s.start, a = Math.max(od0 != null ? od0 : s.od, st ? st.od_dost : 0);
      const b = s.dokad || (st ? st.teraz : terazUtc) || terazUtc, o = ost || s.ost;
      if (!o || b <= a) return 0;
      return Math.max(0, Math.min(0.99, (o - a) / (b - a)));
    }

    /*  SCALANIE po czasie: nowsze źródło (`nowe`) wygrywa przy tej samej sekundzie, wynik rosnąco, bez dubli. */
    function scal(stare, nowe) {
      const m = new Map();
      for (const p of stare || []) m.set(p.czas, p);
      for (const p of nowe || []) m.set(p.czas, p);
      return Array.from(m.values()).sort((a, b) => a.czas - b.czas);
    }
    /*  Podział na dni UTC (rekord bazy = dzień). */
    function naDni(probki) {
      const m = new Map();
      for (const p of probki || []) { const d = Math.floor(p.czas / DOBA); if (!m.has(d)) m.set(d, []); m.get(d).push(p); }
      return m;
    }
    /*  Klucz dnia: 6 cyfr z zerami - porządek tekstowy = porządek dni (zakres IDBKeyRange po kluczu). */
    const kluczDnia = (pref, dzien) => pref + '|' + String(dzien).padStart(6, '0');
    /*  REKORD DNIA: tablice typowane (15-24 B na próbkę jak na nośniku, nie ~100 B obiektów JS) - rok jednego obiegu
        to ~8 MB zamiast ~50 MB. Obieg nieobecny w masce = BRAK w wartościach i 0 w bitach. */
    function naRekord(pref, dzien, probki) {
      const n = probki.length;
      const r = { k: kluczDnia(pref, dzien), pref, dzien, n, czas: new Uint32Array(n), fl: new Uint8Array(n), ms: new Uint8Array(n),
                  v: new Int16Array(n * 4 * OBIEGOW), b: new Uint8Array(n * OBIEGOW) };
      probki.forEach((p, i) => {
        r.czas[i] = p.czas; r.fl[i] = p.flagi; r.ms[i] = p.maska;
        for (let ob = 0; ob < OBIEGOW; ob++) {
          const h = p.ob[ob], o = (i * OBIEGOW + ob) * 4;
          r.v[o] = h ? h.t : BRAK; r.v[o + 1] = h ? h.z : BRAK; r.v[o + 2] = h ? h.c : BRAK; r.v[o + 3] = h ? h.p : BRAK;
          r.b[i * OBIEGOW + ob] = h ? h.b : 0;
        }
      });
      return r;
    }
    function zRekordu(r) {
      const out = [];
      if (!r || !r.n) return out;
      for (let i = 0; i < r.n; i++) {
        const p = { czas: r.czas[i], flagi: r.fl[i], maska: r.ms[i], ob: [] };
        for (let ob = 0; ob < OBIEGOW; ob++) {
          const o = (i * OBIEGOW + ob) * 4;
          p.ob.push((p.maska & (1 << ob)) ? { t: r.v[o], z: r.v[o + 1], c: r.v[o + 2], p: r.v[o + 3], b: r.b[i * OBIEGOW + ob] } : null);
        }
        out.push(p);
      }
      return out;
    }
    /*  SERIE WYKRESU dla obiegu `ob`: [minuta, zapis, zadana ×10 (-1 = brak), flagi (b0 grzanie, b1 pompa)] - ten sam
        zapis, co wykres_temp.js zbiera sam z `swiat`. Brak pomiaru i obejście czujnika = bez punktu (nie zero). */
    function naSerie(probki, ob, SERIE) {
      const S = SERIE || SERIE_DOM, wy = { temp: [], cis: [], poz: [] };
      const zap = (v, s) => Math.max(0, Math.min(ZAPIS_MAX, Math.round(v * s.skala) + s.przes));
      for (const p of probki || []) {
        const h = p.ob && p.ob[ob]; if (!h) continue;
        const m = Math.floor(p.czas / MIN_S), f = ((h.b & B_GRZANIE) ? 1 : 0) | ((h.b & B_POMPA) ? 2 : 0);
        if (h.t !== BRAK) wy.temp.push([m, zap(h.t / 100, S.temp), h.z === BRAK ? -1 : h.z, f]);
        if (h.c !== BRAK && !(h.b & B_OBEJ_MANO)) wy.cis.push([m, zap(h.c / 100, S.cis), -1, f]);
        if (h.p !== BRAK && !(h.b & B_OBEJ_SONDY)) wy.poz.push([m, zap(h.p, S.poz), -1, f]);
      }
      return wy;
    }
    /*  Które obiegi niosą próbki (maski) - wykres dokłada tylko tam, gdzie są dane. */
    const obiegiW = probki => { let m = 0; for (const p of probki || []) m |= p.maska; return [0, 1].filter(o => m & (1 << o)); };

    /*  PLAN DOCIĄGANIA I STAN KOMPLETU (meta obiektu w bazie):
          ost      - najnowsza próbka w telefonie; od_start - `od` pierwszej prośby fazy 1 (granica, od której ściągamy);
          od_pelne - od tej chwili do `ost` telefon ma WSZYSTKO, co sterownik miał (null = faza 1 jeszcze nie domknięta);
          od_dost  - początek danych na nośnikach sterownika (z nagłówka start); f2_ost - postęp fazy 2 (wznowienie).
        Faza 1 = od ostatniej próbki (albo ostatnie `naStartS` sekund) do teraz: wykres ma świeże dni od razu.
        Faza 2 = to, co starsze od granicy - w tle, wznawialna między uruchomieniami aplikacji. */
    /*  NAJWIĘKSZE COFNIĘCIE ZEGARA TELEFONU, KTÓRE APLIKACJA JESZCZE TRAKTUJE JAK „ZEGAR STEROWNIKA W PRZÓD” [D-519 pkt 2, N1]
        = najdłuższa powtórka ponownego pobrania historii przy cofniętym zegarze telefonu. JEDNO miejsce: granicaOst() i planuj()
        (test: narzedzia_hmi/test_historia_apka.js [11]). */
    const TEL_WSTECZ_MAX_S = DOBA;
    function planuj(meta, terazUtc, naStartS) {
      if (!meta || !meta.ost) return { faza: 1, od: Math.max(1, terazUtc - naStartS), do: 0 };
      /* [przegląd historii 1, W1] `ost` nie dalej niż zegar telefonu - zapisane przez starszą aplikację mogło leżeć
         w przyszłości (zegar sterownika w przód), a prośba od przyszłości zwraca 0 próbek i kończy się „kompletem”.
         [D-519 pkt 2, N1] ...ale `ost` dalej niż TEL_WSTECZ_MAX_S przed zegarem telefonu = to TELEFON jest cofnięty
         (granicaOst wpuściła je zegarem sterownika) - prosimy od `ost`, nie od zegara telefonu, inaczej każde otwarcie
         ściągałoby od nowa cały odcinek między zegarami. */
      const od = terazUtc > 0 && meta.ost - terazUtc > TEL_WSTECZ_MAX_S ? meta.ost : Math.min(meta.ost, terazUtc);
      return { faza: 1, od: od + 1, do: 0 };
    }
    /*  GRANICA ZAUFANIA DLA `ost` [przegląd historii 1, W1 - zegar sterownika w przyszłości]
        WEJŚCIA:  zegar telefonu (terazUtc = Date.now; telefony biorą czas z sieci), nagłówek `start` (teraz UTC sterownika).
        CO Z CZEGO WYNIKA: próbka PÓŹNIEJSZA niż zegar telefonu albo sterownika = sterownik miał chwilę zegar w przód (ręczne
                  ustawienie, zła strefa). Po korekcie o ponad godzinę w tył 21b zapisuje dalej od nowego czasu, czyli próbki
                  z czasami MNIEJSZYMI niż ta z przyszłości. Gdyby `ost` stanęło na przyszłej próbce, następne dociągnięcie
                  prosiłoby od przyszłości (0 próbek, `koniec`), odcinek od korekty do niej nie przyszedłby NIGDY, a pasek
                  mówiłby „komplet”. Sam `start.teraz` nie wystarcza: w chwili pobierania sterownik wierzy w swój zły zegar -
                  dlatego rozstrzyga niezależny zegar telefonu.
        WYJŚCIA:  najpóźniejszy czas, który wolno zapisać jako `ost` (Infinity = brak obu zegarów). Koszt: gdy zegar sterownika
                  spieszy się o kilka sekund, następne dociągnięcie przyniesie te próbki drugi raz - baza scala po czasie.
        ⚠ [D-519 pkt 2, Tomasz 01.10.2026 - przegląd historii 2, N1] zegar TELEFONU wstecz (tablet ścienny bez NTP, cofnięty
                  o 3 doby): dawniej `ost` przycięte do zegara telefonu, więc KAŻDE dociągnięcie prosiło od nowa o cały odcinek
                  między zegarami (przez chmurę ~100 kB/obieg za każdym razem). Decyzja: ponowne pobranie NAJWYŻEJ OSTATNIA DOBA.
                  Telefon za sterownikiem o więcej niż TEL_WSTECZ_MAX_S = rozstrzyga zegar sterownika (granica = `start.teraz`),
                  a planuj() prosi wtedy od `ost`, nie od telefonu - powtórka 0. Telefon za sterownikiem o mniej = jak dotąd
                  min(tel, ster): powtórka = różnica zegarów, czyli najwyżej doba. Cena (świadoma): sterownik w PRZÓD o więcej
                  niż dobę względem telefonu wygląda tak samo jak telefon wstecz i W1 go nie złapie; o mniej (zła strefa, zła
                  godzina, ręczne +2 h) - łapany jak przedtem. Zegar telefonu w PRZÓD - nic złego (min bierze sterownik). */
    function granicaOst(terazUtc, start) {
      const tel = terazUtc > 0 ? terazUtc : Infinity, ster = start && start.teraz > 0 ? start.teraz : Infinity;
      if (isFinite(tel) && isFinite(ster) && ster - tel > TEL_WSTECZ_MAX_S) return ster;   /* telefon cofnięty [D-519 pkt 2] */
      return Math.min(tel, ster);
    }
    function planujStarsze(meta) {
      if (!meta || meta.od_pelne == null) return null;
      if (meta.od_pelne <= (meta.od_dost || 0)) return null;
      const od = meta.f2_ost ? meta.f2_ost + 1 : 0;
      if (od >= meta.od_pelne) return null;
      return { faza: 2, od, do: meta.od_pelne - 1 };
    }
    /*  STAN ZAPISU W STEROWNIKU (rejestr 3332 z nagłówka `start`, 21b [7]) -> zdanie dla człowieka, gdy sterownik
        historii NIE ZAPISUJE [zasada 10]: pobieranie kończy się „ok”, a wykres i tak rósłby tylko z telefonu - bez tego
        zdania dziury wyglądałyby na awarię aplikacji. '' = zapisuje normalnie. */
    function uwagaRej(rej) {
      if (rej == null || !isFinite(rej)) return '';
      /* [przegląd historii 2, S3] b9 przed b6: obraz bez historii to NIE awaria - nie odsyłamy serwisu do ODCIECIE */
      if (rej & R_WYL_W_OBRAZIE) return 'sterownik nie ma historii pomiarów - wyłączona w tym oprogramowaniu sterownika (świadomie, nie awaria)';
      if (rej & R_ODCIETA) return 'sterownik nie zapisuje historii - wyłączona po awariach w jej kroku (serwis: odcięcie, konsola ODCIECIE)';
      if (rej & 16) return 'sterownik nie zapisuje historii - zegar niepewny (ustaw czas w sterowniku)';
      if (rej & 128) return 'sterownik nie ma gdzie zapisać historii (brak pamięci i karty) - trzyma tylko ostatnie 4 h';
      if ((rej & 4) && !(rej & 2)) return 'błąd zapisu historii w pamięci sterownika - ponawia co minutę, próbki czekają 4 h';
      if (rej & R_KARTA_WSTRZYMANA) return 'karta sterownika chwilowo wstrzymana (aktualizacja panelu) - starsza historia dociągnie się po niej';
      return '';
    }
    /*  [przegląd historii 2, W1] USZKODZONY ZAPIS, KTÓREGO STEROWNIK NIE MIAŁ CZYM UZUPEŁNIĆ (pole 8 `koniec`, bajty) -> zdanie
        na pasek wykresu [zasada 10]: dziura na wykresie w tym miejscu jest w STEROWNIKU (uszkodzony zapis bez drugiej kopii),
        nie w aplikacji i nie w łączu - ponowne pobranie jej nie zapełni. '' = nic nie przepadło. Zakres pobrania domyka się normalnie
        (od_pelne = „wszystko, co sterownik MA”); gdyby się nie domykał, każde otwarcie ściągałoby ten sam zakres od nowa.
        [przegląd historii 3, N2] „w pamięci (karta lub flash)”, nie „na karcie”: sterownik bez karty czyta sam flash, więc
        uszkodzony bywa też flash - pole 8 nie mówi, który nośnik. */
    function uwagaUszk(bajtow) {
      const b = +bajtow || 0;
      if (b <= 0) return '';
      return 'sterownik pominął uszkodzony zapis historii w swojej pamięci (karta lub flash, ' + b + ' B) i nie miał drugiej kopii - '
        + 'tych minut sterownik nie ma, reszta pobrana';
    }
    /*  ILE MIEJSCA W TELEFONIE NA FAZĘ 2 [B]: dni od PRAWDZIWEGO początku danych sterownika (od_dost z nagłówka start)
        do granicy, × BAZA_B_NA_DOBE. ⚠ `od` fazy 2 bywa 0 („wszystko”) - liczone od 1970 dawało ~1,2 GB i odmowę
        „za mało miejsca” na każdym telefonie z mniejszym przydziałem (przegląd 30.09). */
    const BAZA_B_NA_DOBE = 60000;       /* rekord dnia naRekord: 24 B × 1440 próbek = 34,6 kB + narzut IndexedDB, z zapasem */
    function miejsceNaStarsze(meta, plan) {
      if (!plan) return 0;
      const od = Math.max(plan.od || 0, (meta && meta.od_dost) || 0);
      return plan.do > od ? Math.ceil((plan.do - od) / DOBA) * BAZA_B_NA_DOBE : 0;
    }
    function metaStart(meta, faza, prosbaOd, start) {
      const m = Object.assign({}, meta);
      /*  [przegląd historii 1, W2] granica fazy 1 = `od` prośby, która COŚ zapisała. Pobieranie przerwane przed pierwszym
          kawałkiem (błąd bazy, cisza) zostawiało `od_start` sprzed dni, a następna prośba zaczyna się od „teraz - 7 dni” -
          `koniec` ogłosiłby komplet odcinka między nimi, którego nikt nie pobrał. Bez `ost` granica idzie za prośbą. */
      if (faza === 1 && m.od_pelne == null && (m.od_start == null || !m.ost)) m.od_start = prosbaOd;
      /*  [S4] początek danych sterownika TYLKO z nagłówka, w którym widać wszystkie nośniki (karta nie wstrzymana) -
          inaczej planujStarsze uznałby, że starszego nie ma, bo sterownik chwilowo nie widzi swojego archiwum. */
      if (start && start.od_dost && !(start.rej & R_KARTA_WSTRZYMANA)) m.od_dost = start.od_dost;
      if (start && start.rej != null) m.rej = start.rej;
      return m;
    }
    /*  `granica` [W1] = granicaOst(...) z chwili zapisu; null/undefined = bez przycinania (zgodność wołań). */
    function metaDane(meta, faza, probki, granica) {
      const m = Object.assign({}, meta);
      for (const p of probki || []) {
        const t = granica != null && p.czas > granica ? granica : p.czas;   /* próbka z przyszłości nie przesuwa `ost` dalej niż zegary */
        if (!m.ost || t > m.ost) m.ost = t;
        if (!m.pierwsza || p.czas < m.pierwsza) m.pierwsza = p.czas;
        if (faza === 2 && (!m.f2_ost || p.czas > m.f2_ost)) m.f2_ost = p.czas;
      }
      /* licznik PRZYJĘTYCH (z powtórkami ogona i wznowień - baza i tak scala po czasie); do dziennika, nie do liczenia kompletu */
      m.przyjetych = (m.przyjetych || 0) + (probki ? probki.length : 0);
      return m;
    }
    /*  `start` = nagłówek strumienia, który się właśnie skończył [przegląd historii 1, S4]:
          od_pelne = max(od_start, start.od_dost) - telefon ogłasza komplet NIE NIŻEJ niż to, od czego sterownik w tym strumieniu
          naprawdę miał dane. Dawniej od_pelne = od_start (7 dni wstecz), choć sterownik widział np. tylko 4 h z RAM (obraz tylko
          z kartą, karta wstrzymana) - faza 2 brała już tylko starsze, a 7 dni - 4 h zostawało na zawsze „pobrane”. Gdy później
          sterownik pokaże starsze dane (karta wróciła, włożona inna), metaStart obniży od_dost i faza 2 dociągnie resztę.
          Karta wstrzymana (3332 b8) = od_dost niewiarygodny, liczy się sama prośba (i tak nie sięga niżej - HI.przyjmij odkłada). */
    /*  `uszk` [przegląd historii 2, W1] = pole 8 `koniec` (bajty śmiecia bez drugiej kopii w sterowniku): zapamiętane w meta
        (`uszk` = {b, faza, kiedy} - do dziennika i do opisu na pasku), zakres domyka się jak zawsze - tych próbek sterownik
        nie ma, ponowne pobranie ich nie da. */
    function metaKoniec(meta, faza, prosbaOd, start, uszk) {
      const m = Object.assign({}, meta);
      const dost = start && start.od_dost > 0 && !(start.rej & R_KARTA_WSTRZYMANA) ? start.od_dost : 0;
      if (faza === 1 && m.od_pelne == null) m.od_pelne = Math.max(m.od_start != null ? m.od_start : prosbaOd, dost);
      if (faza === 2) { m.od_pelne = Math.min(m.od_pelne == null ? Infinity : m.od_pelne, m.od_dost || 0); delete m.f2_ost; }
      if (+uszk > 0) m.uszk = { b: +uszk, faza, kiedy: Date.now() };
      m.aktual = Date.now();
      return m;
    }
    /*  ZAPIS JEDNEGO POBIERANIA - KOLEJKA, KTÓRA STAJE NA PIERWSZYM BŁĘDZIE [przegląd historii 1, W2]
        WEJŚCIA:  baza {dopisz, ustawMeta} (HiBaza albo atrapa w teście Node), prefiks, faza, `od` pierwszej prośby,
                  granica() - funkcja [W1]: zegar telefonu i nagłówek `start` znane dopiero w trakcie.
        CO Z CZEGO WYNIKA: kawałki zapisują się PO KOLEI, każdy w JEDNEJ transakcji z meta (`ost`, `f2_ost`), więc
                  nieudana transakcja nie przesuwa niczego. Pierwszy błąd (QuotaExceededError przy małym przydziale,
                  transakcja przerwana zamknięciem innej karty aplikacji) ZATRZYMUJE kolejkę: następne kawałki NIE są zapisywane,
                  `koniec` NIE domyka zakresu (`od_pelne`), a `poBledzie` woła się raz - klient kończy pobieranie `stop`-em.
                  Dawniej `.catch` tylko zapamiętywał błąd i łańcuch płynął dalej: późniejsze kawałki (mniejsze albo po
                  zwolnieniu miejsca) przesuwały `ost` ponad dziurę, `koniec` ustawiał `od_pelne` - dziura zostawała na zawsze,
                  a pasek mówił „komplet”.
        WYJŚCIA:  { start(st), dane(probki, poZapisie), koniec(st), blad, obietnica, poBledzie }. Meta stoi na ostatnim
                  ZAPISANYM kawałku, więc następne dociągnięcie (faza 1: `ost` + 1, faza 2: `f2_ost` + 1) zaczyna od dziury. */
    function zapisPobierania(baza, pref, faza, od0, granica) {
      const z = { blad: null, obietnica: Promise.resolve(), poBledzie: null };
      const krok = f => (z.obietnica = z.obietnica
        .then(() => (z.blad ? undefined : f()))
        .catch(e => {
          if (z.blad) return;
          z.blad = e || new Error('zapis historii w telefonie nieudany');
          if (z.poBledzie) { try { z.poBledzie(z.blad); } catch (x) {} }
        }));
      z.start = st => krok(() => baza.ustawMeta(pref, m => metaStart(m, faza, od0, st)));
      z.dane = (probki, poZapisie) => krok(() => baza.dopisz(pref, probki, m => metaDane(m, faza, probki, granica ? granica() : null))
                                                  .then(() => { if (poZapisie) poZapisie(); }));
      z.koniec = (st, uszk) => krok(() => baza.ustawMeta(pref, m => metaKoniec(m, faza, od0, st, uszk)));
      return z;
    }
    return { WERSJA, BRAK, DOBA, ODM_ZAJETE, ODM_WERSJA, ODM_AKTUALIZACJA, R_KARTA_WSTRZYMANA, R_ODCIETA, R_WYL_W_OBRAZIE,
             B_POMPA, B_GRZANIE, B_PLUKANIE, B_DOLEWANIE, B_OBEJ_SONDY, B_OBEJ_MANO, F_ALARM, SERIE_DOM,
             crc32, dekoduj, kodujBlok, naglowek, odbior, przyjmij, wznowOd, postep, scal, naDni, kluczDnia, naRekord, zRekordu,
             naSerie, obiegiW, planuj, planujStarsze, miejsceNaStarsze, uwagaRej, uwagaUszk, metaStart, metaDane, metaKoniec, granicaOst,
             TEL_WSTECZ_MAX_S, zapisPobierania };
  })();
  M.HI = HI;

  /*  BAZA W TELEFONIE (IndexedDB) - pełna kopia historii, niezależna od localStorage wykresu (7 dni, 5 MB na całą
      stronę - tam logowanie ma pierwszeństwo). Magazyny: `dni` (klucz „prefiks|dzień”, rekord naRekord) i `meta`
      (klucz prefiks). Przedrostek aplikacji (APKA_KLUCZ) w nazwie bazy - aplikacja klienta i TEST3 na jednym origin się nie mieszają.
      ⚠ Każde wywołanie może się nie udać (tryb prywatny, brak miejsca) - wtedy wykres żyje z tego, co zbiera telefon,
        a pasek historii mówi, dlaczego (zasada 10). */
  const HiBaza = (function () {
    const nazwa = () => ((typeof window !== 'undefined' && window.APKA_KLUCZ) || '') + 'historia_pomiarow';
    let baza = null, utrwal = null;
    const jest = () => typeof indexedDB !== 'undefined' && !!indexedDB;
    const otworz = () => baza || (baza = new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open(nazwa(), 1); } catch (e) { baza = null; rej(e); return; }
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('dni')) d.createObjectStore('dni', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'pref' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { baza = null; rej(r.error || new Error('IndexedDB nie otwiera bazy')); };
      r.onblocked = () => { baza = null; rej(new Error('baza historii zablokowana przez inną kartę apki')); };
    }));
    const koniec = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('zapis historii przerwany (brak miejsca?)')); });
    async function meta(pref) {
      const d = await otworz();
      return new Promise(res => { const r = d.transaction(['meta'], 'readonly').objectStore('meta').get(pref);
        r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
    }
    /* próbki -> dni (scalanie z tym, co już jest) + meta przez czystą funkcję `zmiana(meta)` - w JEDNEJ transakcji */
    async function dopisz(pref, probki, zmiana) {
      const d = await otworz();
      const t = d.transaction(['dni', 'meta'], 'readwrite'), sd = t.objectStore('dni'), sm = t.objectStore('meta');
      HI.naDni(probki).forEach((pr, dzien) => {
        const g = sd.get(HI.kluczDnia(pref, dzien));
        g.onsuccess = () => { const stare = g.result ? HI.zRekordu(g.result) : []; sd.put(HI.naRekord(pref, dzien, HI.scal(stare, pr))); };
      });
      if (zmiana) { const gm = sm.get(pref); gm.onsuccess = () => { const m = zmiana(gm.result || { pref }); if (m) { m.pref = pref; sm.put(m); } }; }
      return koniec(t);
    }
    async function ustawMeta(pref, zmiana) { return dopisz(pref, [], zmiana); }
    /* próbki z [od, do] (sekundy UTC) - czyta tylko dni zakresu */
    async function czytaj(pref, od, dok) {
      const d = await otworz();
      const zakres = IDBKeyRange.bound(HI.kluczDnia(pref, Math.floor((od || 0) / HI.DOBA)), HI.kluczDnia(pref, Math.floor((dok || 4e9) / HI.DOBA)));
      return new Promise(res => {
        const r = d.transaction(['dni'], 'readonly').objectStore('dni').getAll(zakres);
        r.onsuccess = () => { const wy = []; for (const rek of r.result || []) for (const p of HI.zRekordu(rek)) if (p.czas >= (od || 0) && p.czas <= (dok || 4e9)) wy.push(p); res(wy); };
        r.onerror = () => res([]);
      });
    }
    async function wyczysc(pref) {
      const d = await otworz();
      const t = d.transaction(['dni', 'meta'], 'readwrite');
      t.objectStore('dni').delete(IDBKeyRange.bound(pref + '|', pref + '|￿'));
      t.objectStore('meta').delete(pref);
      return koniec(t);
    }
    /* [Tomasz 30.09: „trzymała”] przeglądarka nie skasuje bazy przy braku miejsca, gdy strona dostanie trwały magazyn
       (Chrome daje go zainstalowanej PWA). Raz na uruchomienie; wynik tylko do opisu na pasku. */
    function utrwalMagazyn() {
      if (utrwal) return utrwal;
      const s = typeof navigator !== 'undefined' && navigator.storage;
      utrwal = (s && s.persist) ? s.persist().then(x => !!x, () => false) : Promise.resolve(false);
      return utrwal;
    }
    async function miejsce() {
      const s = typeof navigator !== 'undefined' && navigator.storage;
      if (!s || !s.estimate) return null;
      try { const e = await s.estimate(); return { zajete: e.usage || 0, limit: e.quota || 0,
                                                   trwaly: s.persisted ? await s.persisted() : null }; } catch (e) { return null; }
    }
    return { jest, meta, dopisz, ustawMeta, czytaj, wyczysc, utrwalMagazyn, miejsce };
  })();
  M.HiBaza = HiBaza;

  /* ---------------------------------------------------------- [6] KLIENT CHMURY (MQTT)
     [Tomasz 2026-09-08: „a gdyby aplikacja budowała się na podstawie MQTT jak HMI?"]
     WEJŚCIA:  broker po WebSocket TLS (HiveMQ 8884), temat `basen/+/+/blok` -
               sterownik publikuje tam DOKŁADNIE to, co daje pod /blok.txt.
     CO Z CZEGO WYNIKA: ten sam swiatZ() co dla strony na AP; obiekt wybiera
               parametr ?obiekt= albo pierwszy, który się odezwie. Świeżość
               liczymy od ODBIORU pakietu, nie z linii T; (ta mówi o wieku
               bloku w sterowniku, nie o drodze przez chmurę).
     WYJŚCIA:  podaj({polaczony, swiat, wiek_s, obiekty}) - jak z bridge'a i z AP.
     ⛔ NIC NIE PUBLIKUJEMY. Każde fetch('/cmd?…') dostaje odmowę z powodem
        „podgląd przez chmurę - sterowanie z panelu w szafie" [D-47]. Kafle
        wyglądają 1:1, ale są martwe - i mówią dlaczego. */
  M.startMqtt = function (podaj, o) {
    if (M.tryb) return;
    M.tryb = 'mqtt';
    const Klient = window.Paho && (Paho.Client || (Paho.MQTT && Paho.MQTT.Client));
    if (!Klient) { podaj({ polaczony: false, swiat: null, wiek_s: null, blad: 'brak biblioteki MQTT (cdnjs)' }); return; }
    /*  KONTO OBIEKTU WIDZI TYLKO SWÓJ OBIEKT [D-306, Tomasz 2026-09-11 00:05: „rozumiem, że ten link prowadzi do
        sadzawki albo basenu"]. Użytkownik brokera = slug nazwy sterownika („Gliczarów wanna" → gliczarow-wanna);
        temat obiektu = 'basen/' + slug z PIERWSZYM myślnikiem zamienionym na '/' → 'basen/gliczarow/wanna' - taki sam
        prefiks wpisuje się w sterowniku (serwis → sieć). Konto bez myślnika (serwisowe: „sterownik") widzi wszystko.
        To filtr po stronie aplikacji; twarde odcięcie tematów per konto da dopiero ACL na własnym Mosquitto. */
    /*  KTO WIDZI CO [D-312]: `serwis` przychodzi z logowania (ptaszek „konto serwisowe"). Gdy go nie ma - zapis
        sprzed 11.09 - zostaje stara zasada (login bez myślnika = serwisowy), żeby zapamiętane logowanie nie padło.
        ⚠ Sama zasada była dziurawa: klient o jednoczłonowej nazwie („Sadzawka") dostawał widok na wszystkie obiekty. */
    /*  ZAKRES TEMATOW - DWIE POSTACI NAZW NARAZ  [D-439, Tomasz 2026-09-18]
        ═══════════════════════════════════════════════════════════════════════════════════════
        WEJSCIA:   nazwa konta na brokerze · ptaszek „konto serwisowe"
        CO Z CZEGO WYNIKA: nowa postac tematu to `obiekt/<nazwa konta>` - DWA poziomy, a nazwa
                   obiektu jest wprost nazwa konta. Stara to `basen/<a>/<b>` - trzy poziomy,
                   gdzie temat powstawal przez zamiane pierwszego myslnika na ukosnik.
        WYJSCIA:   LISTA wzorcow, od najnowszego. Pierwszy sluzy tez za opis na ekranie.

        ⚠ OBA NARAZ, BO FLOTA PRZECHODZI POJEDYNCZO. Sterownik dostaje nowy prefiks przy wizycie
          na obiekcie, wiec przez jakis czas czesc obiektow nadaje pod `basen/`, a czesc pod
          `obiekt/`. Gdyby aplikacja znala tylko jedna postac, wpiecie jednego obiektu odcinaloby
          serwisowi widok na pozostale.
        ⚠ Stara postac ZNIKNIE, gdy ostatni sterownik przejdzie - wtedy zostaje sama pierwsza
          pozycja listy (DOZROBIENIA: migracja prefiksu). */
    const zakresZ = (uzyt, serwis) => { const u = String(uzyt || ''); const i = u.indexOf('-');
      const serw = (serwis === undefined || serwis === null) ? (i <= 0) : !!serwis;
      if (serw) return ['obiekt/+', 'basen/+/+'];
      /*  Klient: nowy temat to wprost nazwa konta; stary wymagal rozbicia po pierwszym mysliku. */
      const stary = i > 0 ? 'basen/' + u.slice(0, i) + '/' + u.slice(i + 1) : 'basen/' + u + '/+';
      return ['obiekt/' + u, stary]; };
    const serwisowe = (o.serwis === undefined || o.serwis === null)
                      ? (String(o.user || '').indexOf('-') <= 0)   /* stary zapis: login bez myslnika = serwisowy */
                      : !!o.serwis;
    /*  [D-439] `temat` zostaje NAPISEM (opis na ekranie, zgodnosc z zapamietanym logowaniem),
        a `tematy` to lista wzorcow, ktorymi naprawde sie zapisujemy. Rozdzielenie jest celowe:
        ekran ma pokazac jedno zdanie, a nasluch ma objac obie postaci nazw. */
    if (!o.temat) { const lista = zakresZ(o.user, o.serwis);
      o.tematy = lista; o.temat = lista[0];
      /*  Konto jednego obiektu (bez `+` w zadnym wzorcu) samo wskazuje, ktory obiekt otworzyc. */
      if (lista.every(t => t.indexOf('+') < 0) && !o.obiekt) o.obiekt = lista[0]; }
    if (!o.tematy) o.tematy = [o.temat];
    M.zakres = o.temat;   /* [D-312] widoczne dla sond i diagnostyki: co to konto ogląda */
    M.zakresy = o.tematy;
    /*  KOMENDY PRZEZ BROKER [D-267, Tomasz: „aplikacja nie musi mieć uprawnień, bo
        serwis za PIN-em, a reszta dla klienta"]. fetch('/cmd?co=…') z makiety
        tłumaczymy jak dla AP (komendaNaZapisy → lista zapisów rejestrów) i
        publikujemy na `<prefiks>/komenda` w formacie sterownika:
          t=<unix>;pin=<gdy trzeba>;w=<adr>:<wart>,…
        Wynik wraca tematem `wynik` (kod + zdanie) — pokazujemy go w pasku.
        PIN: pytamy raz, gdy sterownik odpowie kodem 3 (rejestr serwisowy),
        i trzymamy do zamknięcia karty. Klient (temperatura, grzanie, światło,
        atrakcje) nigdy o PIN nie jest pytany. */
    let pinSerwis = null, czekaWynik = null, czekaWynikPref = null;   /* [PWA-7] wynik bez id: tylko od sterownika, ktorego pytalismy */
    /*  ID KOMENDY [D-289, audyt 3.8]: `wynik` nie mówił, na którą komendę odpowiada - dwie szybkie komendy
        i pierwsza dostawała „nie potwierdził w 5 s". Każda komenda niesie `id=`, sterownik odsyła je
        w `wynik` (i odsiewa powtórki - druga droga/dup QoS1 nie przestawia kanału dwa razy). Mapa
        oczekujących po id; `czekaWynik` zostaje dla starego firmware (wynik bez id).
        POMIAR W APLIKACJI (C6): czas komenda→wynik i komenda→pierwsza paczka zmian po nim idą do dziennika
        („PRZEZ CHMURĘ" na pasku) i do M.pomiar - żeby wiedzieć, jak jest NA TELEFONIE, nie na PC. */
    const oczekuja = new Map(); let idLicz = Math.floor(Math.random() * 9e5) * 1000;
    /* [Astra 15] czy aplikacja czeka na wynik komendy - wtedy przeładowanie po aktualizacji (nagłówek hmi.html) czeka.
       [30.09, luka 9.1-d] Druga połowa `M.zajety()` - otwarte edytory - siedzi w [5a]; tu tylko komendy. */
    komendyCzekaja = () => oczekuja.size > 0 || czekaWynik !== null;
    const nowyId = () => ++idLicz;
    /*  WYNIK NIEZNANY ZAMIAST „NIE WYKONANO”  [Sol S23, 01.10.2026; D-531 pkt 2 - cztery fakty polecenia]
        WEJŚCIA:  command bez `wynik` w 5 s; późniejszy `wynik` z tym samym id i od tego samego sterownika.
        CO Z CZEGO WYNIKA: PUBACK znaczy tylko „broker przyjął” - sterownik mógł command WYKONAĆ (kopia drugą drogą
                  dochodzi do 6 s później, poczekalnia sterownika bywa zajęta), więc brak wyniku w terminie to „wynik
                  nieznany”, nie odmowa; aplikacja nie ponawia sama. Id po terminie pamiętamy przez POZNE_MS (= pamięć id
                  sterownika, 180 s) - spóźniony wynik daje JEDNĄ linię w dzienniku łącza z kodem (zasada 10).
        WYJŚCIA:  {ok: false, nieznany: true, opis} dla ekranu; linia „spóźniony wynik …”. Teksty = szkic. */
    const POZNE_MS = 180000, POZNE_MAX = 50;
    const pozne = new Map();                 // id -> { co, t0, pref, kiedy }
    const pozneDodaj = (id, z) => { const t = Date.now();
      for (const [k, v] of pozne) if (t - v.kiedy > POZNE_MS || pozne.size >= POZNE_MAX) pozne.delete(k); else break;
      pozne.set(id, Object.assign(z, { kiedy: t })); };
    /*  JEDNA OPERACJA KOMENDY - JEDEN KONIEC  [zadanie 13 Astry, 02.10.2026]
        WEJŚCIA:  id commandu, co (do dziennika), sterownik, do którego command idzie (pref - PRZECHWYCONY przy wysyłce),
                  koniec obietnicy (res), termin [ms], wyniki zastępcze {termin, nieWyslano, bladWysylki}.
        CO Z CZEGO WYNIKA:
          • wpis w `oczekuja` i zegar terminu powstają RAZEM, PRZED wysyłką (dawniej zegar zakładany PO kk.send(): wyjątek
            w send zostawiał wpis na zawsze - M.zajety() prawdziwe bez końca, przeładowanie po aktualizacji wstrzymane;
            sprawdzPin dodatkowo wpisywał oczekiwanie przed sprawdzeniem połączenia);
          • zakoncz(wynik) usuwa wpis i zegar, zdejmuje czekaWynik i kończy obietnicę - NAJWYŻEJ RAZ (wynik sterownika,
            termin, błąd wysyłki: który pierwszy); wynik bez id ze starego firmware też kończy przez nie (sprząta wpis);
          • błąd wysyłki: wyjątek „not connected” sprzed wysyłki (AMQJS0011E bez markera `niepewne`) = NA PEWNO nie
            wysłano; każdy inny wyjątek albo marker `niepewne` nakładki (biblioteka wywołana - publikacja mogła wyjść
            którąś drogą) = WYNIK NIEZNANY jak po terminie: id trafia do `pozne` (spóźniony wynik będzie odnotowany),
            aplikacja NIE ponawia sama i nie nadaje nowego id;
          • `pozne` dostaje sterownik z chwili WYSYŁKI - zmiana obiektu w czasie czekania nie przenosi korelacji na inny.
        WYJŚCIA:  { wyslij(kk, msg) } - wysyłka w try/catch; wynik przez res. */
    const operacjaKomendy = (id, co, pref, res, terminMs, wyniki) => {
      const t0 = Date.now();
      let koniec = false, zegarek = null;
      const zakoncz = w => {
        if (koniec) return false;
        koniec = true; clearTimeout(zegarek); oczekuja.delete(id);
        if (czekaWynik === zakoncz) czekaWynik = null;
        res(w); return true;
      };
      const nieznany = (w, linia) => { if (zakoncz(w)) { pozneDodaj(id, { co, t0, pref }); zapisz(linia); } };
      oczekuja.set(id, { res: zakoncz, t0, co, pref }); czekaWynik = zakoncz; czekaWynikPref = pref;
      zegarek = setTimeout(() => nieznany(wyniki.termin, 'bez wyniku ' + Math.round(terminMs / 1000) + ' s: ' + co + ' - wynik nieznany (rozkaz mógł się wykonać)'), terminMs);
      return {
        t0,
        wyslij: (kk, msg) => {
          try { kk.send(msg); }
          catch (e) {
            const txt = String((e && e.message) || e);
            if (!(e && e.niepewne) && /AMQJS0011E/.test(txt)) { if (zakoncz(wyniki.nieWyslano)) zapisz('nie wysłano ' + co + ' - brak połączenia (' + txt.slice(0, 60) + ')'); }
            else nieznany(wyniki.bladWysylki, 'błąd wysyłki ' + co + ' (' + txt.slice(0, 80) + ') - wynik nieznany, rozkaz mógł wyjść');
          }
        },
      };
    };
    M.pomiar = { wynik_ms: null, zmiana_ms: null, ile: 0 };
    let czekamZmiany = null;              /* {t0, co} - pierwsza paczka zm/blok po komendzie = jej skutek */
    const odnotujZmiane = () => { if (!czekamZmiany) return; const ms = Date.now() - czekamZmiany.t0;
      if (ms < 4000) { M.pomiar.zmiana_ms = ms; zapisz('zmiana po komendzie ' + czekamZmiany.co + ': ' + ms + ' ms'); } czekamZmiany = null; };
    /*  LUSTRO Z PEŁNEGO BLOKU I PACZEK ZMIAN [D-277, Tomasz: „jak Loxone - tylko rejestry, które
        uległy zmianie, co minutę wszystkie kontrolnie"]. Pełny blok (retained, co 60 s i na
        `zadanie`) niesie MB;/MN;/T; jak /blok.txt oraz R;<adr>,<ile>,<v>… (rejestry 3000+,
        4000+, 4300+, 4700+) i Z;<seq>,<unix>. Paczki `zm` {seq,t,mb:{i:v},mn:{i:v},r:{adr:v}}
        nakładamy na tablice obiektu. Luka w seq → prosimy o pełny (`zadanie`). Ekrany serwisu
        czytają /rej Z LUSTRA - bez pytania sterownika. */
    const HASLA_REJ = a => (a >= 4767 && a <= 4782) || (a >= 4800 && a <= 4815) || (a >= 4875 && a <= 4890) || (a >= 4970 && a <= 4985);
    /*  ILE WSTECZ TO JESZCZE „spóźniona kopia" [D-338 — liczba miała nazwę dopiero tutaj].
        Mniejszy skok numeru w tył = ta sama paczka, która przyszła drugą drogą później — pomijamy.
        Większy = restart sterownika albo przewinięcie licznika — wtedy to, co przyszło, JEST prawdą. */
    const SEQ_SKOK_RESTART = 1000;
    /*  PROŚBA O PEŁNY BLOK NIE CZĘŚCIEJ NIŻ CO TYLE [ms, D-338 cz. 2 — zmierzone na stanowisku].
        Przy zalewie (20 komend na sekundę) powstawała pętla sprzężenia: luka → prośba o pełny blok
        → blok 4,5–7 kB wchodzi do skrzynki numerowanej sterownika → opóźnia potwierdzenia
        → więcej luk → więcej próśb. Lekarstwo musi być rzadsze niż choroba.
        Dwie sekundy to ta sama liczba, po której zasłaniamy ekran przy nierozwiązanej luce —
        czyli prośba zdąży wrócić, zanim człowiek cokolwiek zauważy. */
    const PELNY_ODSTEP_MS = 2000;
    let _pelnyOst = 0;
    const prosPelny = (powod) => {
        const teraz = Date.now();
        if (teraz - _pelnyOst < PELNY_ODSTEP_MS) return false;   /* już prosiliśmy — blok jest w drodze */
        _pelnyOst = teraz;
        oglos('pelny');
        return true;
    };
    const zastosujPelny = (pref, w, txt) => {
      const mb = parsujLinie(txt, 'MB;'), mn = parsujLinie(txt, 'MN;');
      if (mb) w.mb = mb; if (mn) w.mn = mn;
      const r = {};
      for (const l of txt.split(/\r?\n/)) if (l.startsWith('R;')) {
        const p = l.slice(2).split(','); const a0 = +p[0], n = +p[1];
        for (let i = 0; i < n && 2 + i < p.length; i++) r[a0 + i] = +p[2 + i];
      }
      if (Object.keys(r).length) w.r = r;
      if (nazwyR[pref]) { if (!w.r) w.r = {}; Object.assign(w.r, nazwyR[pref]); }   /* nazwy kanałów spoza bloku [D-493] */
      const z = parsujLinie(txt, 'Z;');
      if (z && z.length) { w.seq = z[0]; if (z[1]) zegarUstaw(pref, z[1]);
                           if (z.length > 2 && z[2] != null) w.u = z[2]; }   /* [D-481] numer uruchomienia sterownika */
      w.txt = txt;
      return !!(z && z.length > 2 && z[2] != null);   /* [R1] blok niósł u - wołający odnotowuje, skąd przyszedł */
    };
    const zegar = {};                       // prefiks -> { czas: unix sterownika, kiedy: Date.now() odbioru }
    /*  ZEGAR STEROWNIKA NIE COFA SIĘ OD SPÓŹNIONEJ PRÓBKI  [B.0z-78, D-530 - mariaż QUIC + TLS]
        ------------------------------------------------------------
        WEJŚCIA:  czas sterownika z trzech źródeł: `stan.czas`, `zm.t`, linia Z; pełnego bloku.
        CO Z CZEGO WYNIKA: z zegara liczymy `t=` każdej komendy (wyslij, sprawdzPin). `zm` i `blok` mają numer
                  (seq + u), `stan` NIE - a przy dwóch drogach `stan` z QUIC potrafi przyjść 6 s po świeższym
                  `zm.t` z TLS (docs/36 §9). Przyjęty bez sprawdzenia cofał `t=`, a następny command na ten sam
                  rejestr dostawał w sterowniku „nowsza wygrywa” (kod 8, luz 5 s). Próbkę przyjmujemy, gdy:
                    • nie jest starsza od naszego szacunku o więcej niż ZEGAR_LUZ_S (sekundy całkowite + rozrzut drogi);
                    • albo cofa o więcej niż ZEGAR_SKOK_S - to przestawiony zegar sterownika (D-505), nie kopia;
                    • albo próbki „za stare” idą bez przerwy dłużej niż ZEGAR_UPOR_MS - zegar sterownika naprawdę
                      cofnął się o mniej niż 2 min (korekta z NTP), a świeżej próbki, która by go potwierdziła, nie ma.
                      Bez tej furtki szacunek zostałby na zawsze przed sterownikiem.
        WYJŚCIA:  zegar[pref] albo nic (próbka odrzucona).
        ⚠ Działa tak samo w aplikacji klienta (Paho) - tam spóźniona próbka przychodzi z drugiego brokera albo jako
          retained blok sprzed minuty; też nie powinna cofać `t=`.
        ⚠ Firmware (po sobocie, opcja): `seq` i `u` w JSON `stan` (20a4) jak w `zm` - wtedy kolejność z numeru,
          nie z szacunku (DOZROBIENIA B.0z-78). */
    const ZEGAR_LUZ_S = 1, ZEGAR_SKOK_S = 120, ZEGAR_UPOR_MS = 15000;
    /*  REWIZJA SNAPSHOTU `stan`  [Sol S21, 01.10.2026 - firmware sol/c-firmware: pola u, boot, stan_seq]
        WEJŚCIA:  JSON `stan`: `boot` (losowy marker uruchomienia), `stan_seq` (numer snapshotu - ten sam na obu drogach),
                  `u` (numer uruchomienia, jak w `zm`/`blok`). Stary sterownik ich nie ma.
        CO Z CZEGO WYNIKA:
          • ten sam boot: przechodzi tylko snapshot o WYŻSZYM numerze - kopia z drugiej drogi albo spóźniona (niższy lub
            równy numer) nie dochodzi do zegara NIGDY (dawniej „upór” przyjmował ją po 15 s - ryzyko R9, B.0z-78);
          • inny boot: boot już ZASTĄPIONY (stary) albo niższe `u` = snapshot poprzedniego uruchomienia - pomijamy;
            inaczej to nowe uruchomienie - przyjmujemy, stary boot trafia na listę zastąpionych;
          • boot porównujemy WYŁĄCZNIE równością (losowy - nie ma porządku); brak pól = jak dotąd (zegarUstaw z uporem).
        WYJŚCIA:  true = snapshot wolno użyć. ⚠ Prawdziwa korekta zegara sterownika w świeżych snapshotach dalej idzie przez
                  upór zegarUstaw (R8 bez zmian - opisane w DOZROBIENIA B.0z-78, nie deklarujemy jego naprawy). */
    const licznikU = x => Number.isInteger(x) && x >= 0 && x <= 65535;
    /*  TOŻSAMOŚĆ ODPOWIEDZI KARTY (rid/part)  [Sol S20, 01.10.2026 - firmware sol/c-firmware, 20a3f_siec_rpc.h]
        WEJŚCIA:  echo probe'a `cap` w ŻYWYM (nie retained) `stan` sterownika, prośby /pliki /okres /plik ekranów.
        CO Z CZEGO WYNIKA:
          • probe: do ZWYKŁEGO odnowienia podglądu (to samo tempo, nic nie włącza samo) dopisujemy `;cap=<32 hex>`
            - stary sterownik czyta liczbę i `niesie=` jak dotąd; nowy odsyła nonce w `stan` (pole cap.n);
          • dopiero echo TEJ sondy (ten sam prefiks, w czasie RPC_SONDA_WAZNA_MS, nie retained, z `boot`) włącza rid:
            prośby karty dostają `;rid=<32 hex>;part=<n>`, a odpowiedź liczy się tylko z tym samym rid i częścią -
            kopia drugą drogą albo odpowiedź na inną (starą, cudzą) prośbę nie kończy bieżącej;
          • inny boot w `stan` (nowe uruchomienie), `stan` BEZ boot (powrót na stary firmware - sceptyk C, W1) albo nowa
            sesja = możliwość skasowana, potwierdzamy od nowa;
          • brak echa = tryb dawny, jawnie (bramki kategorii/nazwy/pozycji BRIDGE jak dotąd - identyczna stara
            odpowiedź może wtedy pasować do nowej prośby; tego tryb dawny nie rozróżni).
        WYJŚCIA:  rpcRid(pref) -> nowy rid albo null; ridZPol(pola) -> {rid, part} albo null. */
    const RPC_SONDA_PONOW_MS = 60000, RPC_SONDA_WAZNA_MS = 70000;
    const rpcCap = {};                          // prefiks -> { stan: 'sonda'|'jest', nonce, od, boot }
    const hex32 = () => { const b = new Uint8Array(16);
      try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
      return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); };
    const rpcRid = pref => (rpcCap[pref] && rpcCap[pref].stan === 'jest') ? hex32() : null;
    const ridZPol = pola => { let rid = null, part = null;
      for (const x of pola) { if (/^rid=[0-9a-fA-F]{32}$/.test(x)) rid = x.slice(4); else if (/^part=[0-9]+$/.test(x)) part = +x.slice(5); }
      return (rid && part != null) ? { rid, part } : null; };
    /* czy odpowiedź pasuje do prośby: prośba z rid - tylko ten rid i ta część; prośba dawna - odpowiedź z rid jest cudza */
    const ridPasuje = (pros, r, part) => pros.rid ? !!(r && r.rid === pros.rid && r.part === part) : !r;
    const rpcSondaDo = (pref, tresc, wymus) => {
      const c = rpcCap[pref], teraz = Date.now();
      /* [sceptyk C runda 2, R2] sonda WYMUSZONA (kandydat na nowe uruchomienie - firmware odsyła wtedy `stan` od razu):
         potwierdzonej możliwości rid nie ruszamy, nonce jednorazowy; inaczej jak zwykła sonda, tylko bez czekania 60 s */
      if (wymus && c && c.stan === 'jest') return tresc + ';cap=' + hex32();
      if (!wymus && c && (c.stan === 'jest' || (c.stan === 'sonda' && teraz - c.od < RPC_SONDA_PONOW_MS))) return tresc;
      const nonce = hex32(); rpcCap[pref] = { stan: 'sonda', nonce, od: teraz, boot: null };
      return tresc + ';cap=' + nonce;
    };
    /*  NOWE URUCHOMIENIE Z NIŻSZYM `u`, DWA STEROWNIKI NA PREFIKSIE  [sceptyk C, S1 - 02.10.2026; runda 2: R1, R2, R3]
        WEJŚCIA:  snapshot `stan` z boot/stan_seq/u; lustro obiektu: w.u, w.seq, w.uBrok = {u, t} (kiedy blok albo `zm`
                  z brokera przyniósł u lustra, także retained - liczy się tylko dla TEGO u); uZyw[pref][u] - ostatnia ŻYWA
                  (nie retained) paczka `zm` albo blok z danym u, także ODRZUCONA (drugi sterownik, stare uruchomienie:
                  odrzucona paczka to też dowód, że ktoś nadaje); zegar apki.
        CO Z CZEGO WYNIKA: `u` to licznik restartów w NVS - po skasowaniu pamięci, wymianie płyty albo przewinięciu
                  licznika NOWE uruchomienie ma `u` NIŻSZE niż zapamiętane. Dotąd taki boot był odrzucany NA ZAWSZE:
                  `stan` (u < r.u), `zm` i `blok` (u < w.u) szły do kosza, lustro stało na starych liczbach, zegar komend
                  nie przyjmował czasu (próba sceptyka A2: 300 zamiast 350 po 3 min). Spóźniony snapshot nieznanego
                  STARSZEGO boot (A3) w pierwszej chwili wygląda tak samo - rozstrzyga więc CZAS: kopia drugą drogą
                  spóźnia się najwyżej o sekundy (docs/36 §9: do 6 s), a martwe uruchomienie nowych numerów nie wyprodukuje.
                    • nieznany boot z niższym u = KANDYDAT: jego snapshoty pomijamy (nie cofają zegara, nie ruszają lustra);
                    • kandydat staje się bieżącym uruchomieniem, gdy jego `stan_seq` ROŚNIE dłużej niż STAN_NOWY_BOOT_MS
                      od pierwszego snapshotu, a bieżące uruchomienie MILCZY od co najmniej STAN_NOWY_BOOT_MS: ani świeżej
                      snapshotu, ani żywej paczki `zm`/bloku z jego u (heartbeat `zm` idzie co 5 s przy podglądzie - 20a6
                      SIEC_ZM_HB_MS - więc 10 s ciszy to nie przerwa między paczkami);
                    • [R3] DWA STEROWNIKI NA JEDNYM PREFIKSIE: inny boot nadaje rosnące numery dłużej niż STAN_NOWY_BOOT_MS
                      od pierwszego snapshotu (a boot ZASTĄPIONY - od swojego pierwszego NOWEGO numeru po zastąpieniu, runda 3
                      niżej), a bieżące uruchomienie też daje znak życia później niż STAN_NOWY_BOOT_MS po tej chwili -
                      spóźniona kopia martwego boot tak nie potrafi.
                      Wtedy JEDNA linia w dzienniku łącza i zostajemy przy uruchomieniu, na którym stoi lustro (zwykle
                      pierwsze przyjęte): drugiego nie przyjmujemy, jego `zm`/bloki pomijamy bez wpisu (60 linii dziennika
                      nie może zalać co sekundę), lustra nie resetujemy - bez przełączania tam i z powrotem i bez serii
                      próśb o pełny blok (dawniej: 71 w 240 s, zegar komend z drugiego sterownika). Gdy bieżące zamilknie
                      na dłużej niż STAN_NOWY_BOOT_MS, a drugie nadaje dalej - przyjmujemy drugie, z linią w dzienniku;
                    • lustro z WYŻSZEGO u niż POTWIERDZONE bieżące uruchomienie (u lustra z kandydata wyżej albo z zasiewu:
                      blok z pamięci telefonu, retained sprzed restartu) - lustro od nowa: w.u = u bieżące, w.seq = null
                      (zasłona do pełnego bloku, D-318) i prośba o pełny blok od ręki; dalej `zm`/`blok` tego u idą zwykłą
                      drogą. [R1] ALE NIE, gdy blok albo `zm` z u lustra przyszedł z brokera w ostatnich STAN_NOWY_BOOT_MS:
                      wtedy spóźniony jest SNAPSHOT (ostatni snapshot starego boot dowieziona QUIC-iem po pełnym bloku
                      nowego uruchomienia, zwykły restart u 6 -> 7), a nie lustro - dawniej lustro wracało na u 6,
                      spóźniona `zm` u 6 nakładała starą temperaturę i szła zbędna prośba o pełny blok;
                    • [R2] SONDA: `stan` idzie co 30 s (20a4 SIEC_MQTT_STAN_MIN_MS, D-320), więc drugi snapshot kandydata
                      przychodziłaby po 30 s. STAN_NOWY_BOOT_MS + STAN_SONDA_ZAPAS_MS po pierwszym snapshocie kandydata aplikacja
                      wysyła zwykłe odnowienie podglądu z sondą `;cap=` (nowy nonce) - firmware odsyła wtedy najbliższe
                      `stan` od razu, najwyżej raz na 5 s (20a4 SIEC_CAP_WYMUS_MIN_MS). Żywe uruchomienie (oba, gdy są
                      dwa sterowniki) odpowiada nowym numerem, martwe milczy - rozstrzygnięcie po ~11 s zamiast ~30 s.
                    • [runda 3, Ś1] OKNO ZASTĄPIONEGO BOOT liczymy od jego PIERWSZEGO NOWEGO numeru po zastąpieniu (pole `od`
                      wpisujemy dopiero wtedy), nie od chwili zastąpienia. Zwykły restart (u 6 -> 7) przy drodze, która stała
                      i oddała zaległe snapshoty starego boot naraz po 12-35 s: dawniej to był „drugi sterownik” (linia „dwa”,
                      a przy ciszy nowego - powrót martwego jako bieżącego; sceptyk: sweep 11/18 źle). Zaległość dowozi
                      snapshoty w jednej chwili, a żywy sterownik nadaje nowe numery dłużej niż STAN_NOWY_BOOT_MS;
                    • [runda 3, Ś3 - zasada 10] stan „dwa sterowniki” jest TRWAŁĄ flagą M.dwaSterowniki[prefiks] (linia
                      w dzienniku wypada po 60 wpisach), zdejmowaną, gdy drugi nie daje snapshotu dłużej niż DWA_CISZA_MS;
                      razem z nią gaśnie `r.dwa` - inaczej kolejny kandydat (skasowany NVS) nie dostałby probe'a (D4);
                    • [runda 3, S21.R3w] zegar komend NIE ze snapshotu uruchomienia o NIŻSZYM u niż żywe lustro (pokazywany
                      sterownik wrócił po ciszy, a rewizja `stan` jeszcze przy drugim) - przy obsłudze tematu `stan`;
                    • [runda 3, D6] snapshot RETAINED z rewizją nie wchodzi tu wcale (firmware nadaje `stan` bez retain;
                      zastany snapshot nie jest znakiem życia ani kandydatem).
        WYJŚCIA:  stanNowszy() jak dotąd (true = snapshot wolno użyć) + reset lustra opisany wyżej.
        ⚠ CZAS PRZEJŚCIA na nowe uruchomienie z niższym u: ~11 s od jego pierwszego snapshotu, gdy sonda doszła; bez odpowiedzi
          na sondę - przy następnym zwykłym snapshocie, ~30 s od pierwszej (do ~40 s od restartu sterownika). Tyle samo czeka
          zegar komend. Z wyższym u, jak dotąd, od pierwszego snapshotu. ⚠ [runda 3, D5 - NIE ruszane] ~30 s także wtedy, gdy
          odpowiedź na sondę przyszła, ale stary jeszcze „żył” kopiami w oknie (szybki restart, RL1), albo gdy sonda trafiła
          w 5 s firmware po zwykłej sondzie nowej sesji (RP1) - druga sonda to nowy mechanizm (pytanie do Tomasza).
        ⚠ Dwa sterowniki z TYM SAMYM u: lustro ich nie rozdzieli (`zm` nie niesie boot) - zostaje linia w dzienniku.
        ⚠ Stary sterownik (bez boot/stan_seq): bez zmian - nie mamy czym odróżnić nowego uruchomienia od spóźnionej kopii.
        Tekst linii w dzienniku = szkic do korekty Tomasza. */
    const STAN_NOWY_BOOT_MS = 10000, STAN_SONDA_ZAPAS_MS = 500, STAN_INNE_MAX = 16;
    /* [runda 3, Ś3] drugi sterownik zniknął = dwa okresy `stan` (20a4 SIEC_MQTT_STAN_MIN_MS = 30 s) bez jego nowego snapshotu */
    const DWA_CISZA_MS = 3 * 30000;   /* [sceptyk 4, drobne 1] 3 okresy `stan`: jeden zgubiony snapshot (QoS 0) drugiego nie gasi flagi
                                        i nie zdejmuje ochrony r.dwa przed jego `zm` (przeskok lustra 300 -> 999) */
    const stanRew = {};       // prefiks -> { boot, seq, u, od, seq0, kiedy, inne: Map(boot -> {seq, seq0, u, od, stary, sonda}), dwa }
    /*  TRWAŁA FLAGA „DWA STEROWNIKI”  [sceptyk C runda 3, Ś3 - zasada 10: każda blokada ma komunikat]
        WEJŚCIA:  dwaSterowniki() (wykrycie), nowe snapshoty drugiego (odświeżają `kiedy`), tyknięcie co 1 s (dwaWygas).
        CO Z CZEGO WYNIKA: commandy z aplikacji trafiają do OBU sterowników na prefiksie, a aplikacja pokazuje jeden - to stan, nie
                  zdarzenie: linia w dzienniku łącza wypada po 60 wpisach. Flaga trwa, póki drugi nadaje; gaśnie, gdy jego
                  snapshotu nie ma dłużej niż DWA_CISZA_MS (naprawiony prefiks, wyłączony sterownik) - z jedną linią w dzienniku.
        WYJŚCIA:  M.dwaSterowniki[prefiks] = { boot, u, od, kiedy } (boot/u DRUGIEGO, od = pierwsze wykrycie) albo brak wpisu;
                  M.dwaNaPasek() = flaga WYBRANEGO obiektu albo null - wywołanie gotowe dla paska.
        [D-535 pkt 3, Tomasz 02.10.2026: „pasek widzi KLIENT i serwis”] M.dwaZdanie() = zdanie paska dla WYBRANEGO obiektu
          ('' = brak flagi) - jedno źródło tekstu; hala (makiety/panel4_hala.html, #chmura-dwa) pokazuje je w pasku aplikacji klienta
          i serwisu bez rozróżniania kont. ⚠ Tekst = SZKIC do korekty Tomasza. */
    M.dwaSterowniki = {};
    M.dwaNaPasek = () => (wybrany && M.dwaSterowniki[wybrany]) || null;
    const DWA_ZDANIE = 'pod tą nazwą nadają dwa sterowniki — rozkazy trafiają do obu, wezwij serwis';
    M.dwaZdanie = () => (M.dwaNaPasek() ? DWA_ZDANIE : '');
    const dwaWygas = (pref, teraz) => {
      const d = M.dwaSterowniki[pref];
      if (!d || teraz - d.kiedy <= DWA_CISZA_MS) return;
      delete M.dwaSterowniki[pref];
      const r = stanRew[pref]; if (r) r.dwa = null;      /* [D4] sonda kolejnego kandydata (sondaKandydata) zależy od r.dwa */
      zapisz('drugiego sterownika na prefiksie ' + pref + ' (boot ' + bootKrotko(d.boot) + ' u ' + d.u + ') nie słychać od '
             + Math.round((teraz - d.kiedy) / 1000) + ' s - flaga zdjęta');
    };
    const uZyw = {};          // prefiks -> { u: Date.now() ostatniej żywej paczki zm/bloku z tym u }
    const odnotujU = (pref, u) => { (uZyw[pref] || (uZyw[pref] = {}))[u] = Date.now(); };
    /* ostatni znak życia BIEŻĄCEGO uruchomienia: jego świeży snapshot albo żywa paczka `zm` / blok z jego u */
    const zyjeOd = (pref, r) => Math.max(r.kiedy || 0, (r.u != null && uZyw[pref] && uZyw[pref][r.u]) || 0);
    const bootKrotko = b => String(b).slice(0, 8) + '…';
    /* bieżące uruchomienie odchodzi na listę innych - jako ZASTĄPIONE. [runda 3, Ś1] `od` (początek okna spóźnionych kopii)
       wpisuje stanNowszy przy PIERWSZYM NOWYM numerze tego boot - dawniej `od: teraz` (chwila zastąpienia): zaległe snapshoty
       martwego boot dowiezione naraz po 12-35 s wyglądały jak drugi sterownik (sweep sceptyka rundy 3) */
    const odlozBoot = r => {
      r.inne.set(r.boot, { seq: r.seq, seq0: r.seq, u: r.u, od: null, stary: true, sonda: false });
      while (r.inne.size > STAN_INNE_MAX) r.inne.delete(r.inne.keys().next().value);
    };
    /* [R2] sonda `;cap=` po STAN_NOWY_BOOT_MS od pierwszego snapshotu kandydata - tylko wybrany obiekt (do niego idzie `zadanie`) */
    const sondaKandydata = (pref, boot, o) => {
      if (o.sonda) return; o.sonda = true;
      setTimeout(() => { const r = stanRew[pref];
        if (!r || r.dwa || r.inne.get(boot) !== o || pref !== wybrany) return;
        oglos(tempo, undefined, true); }, STAN_NOWY_BOOT_MS + STAN_SONDA_ZAPAS_MS);
    };
    /* [R3] drugi sterownik na prefiksie: zostajemy przy uruchomieniu, na którym stoi lustro; true = przełączono na tamto */
    const dwaSterowniki = (pref, r, boot, o, teraz) => {
      const w = obiekty[pref];
      const naTamtym = !!(w && licznikU(w.u) && w.u === o.u && w.u !== r.u);
      if (naTamtym) {
        const a = { boot: r.boot, u: r.u };
        odlozBoot(r); r.inne.delete(boot);
        Object.assign(r, { boot, seq: o.seq, u: o.u, od: o.od, seq0: o.seq0, kiedy: teraz, dwa: a });
      } else r.dwa = { boot, u: o.u };
      const d0 = M.dwaSterowniki[pref];      /* [runda 3, Ś3] trwała flaga - od pierwszego wykrycia, póki drugi nadaje */
      M.dwaSterowniki[pref] = { boot: r.dwa.boot, u: r.dwa.u, od: d0 ? d0.od : teraz, kiedy: teraz };
      zapisz('dwa sterowniki nadają na prefiksie ' + pref + ' (boot ' + bootKrotko(r.boot) + ' u ' + r.u + ' / boot '
             + bootKrotko(r.dwa.boot) + ' u ' + r.dwa.u + ') - pokazuję u ' + r.u + ', drugiego nie; sprawdź prefiks MQTT sterowników');
      return naTamtym;
    };
    const stanNowszy = (pref, s, zastany) => {
      if (typeof s.boot !== 'string' || !s.boot || !Number.isInteger(s.stan_seq)) return true;
      if (zastany) return false;              /* [runda 3, D6] retained z rewizją: nie znak życia, nie kandydat, nie zegar */
      const teraz = Date.now(), u = licznikU(s.u) ? s.u : null;
      let r = stanRew[pref];
      if (!r) r = stanRew[pref] = { boot: s.boot, seq: s.stan_seq, u, od: teraz, seq0: s.stan_seq, kiedy: teraz, inne: new Map(), dwa: null };
      else if (s.boot === r.boot) {
        if (s.stan_seq <= r.seq) return false;
        r.seq = s.stan_seq; r.kiedy = teraz; if (u != null) r.u = u;
      } else {
        const o = r.inne.get(s.boot);
        if (o) {                                /* znany inny boot: kandydat (niższe u) albo zastąpiony */
          if (s.stan_seq <= o.seq) return false;                  /* kopia albo spóźniony snapshot */
          o.seq = s.stan_seq;
          if (o.od == null) o.od = teraz;                         /* [runda 3, Ś1] zastąpiony: okno od 1. NOWEGO numeru */
          { const d = M.dwaSterowniki[pref]; if (d && d.boot === s.boot) d.kiedy = teraz; }   /* [Ś3] drugi nadaje */
          if (teraz - o.od <= STAN_NOWY_BOOT_MS) return false;    /* jeszcze w oknie spóźnionych kopii */
          const zA = zyjeOd(pref, r);
          if (teraz - zA <= STAN_NOWY_BOOT_MS) {                   /* bieżące uruchomienie też żyje */
            if (zA - o.od > STAN_NOWY_BOOT_MS && !(r.dwa && r.dwa.boot === s.boot)) return dwaSterowniki(pref, r, s.boot, o, teraz);
            return false;
          }
          /* bieżące milczy dłużej niż STAN_NOWY_BOOT_MS, ten boot nadaje rosnąco dłużej niż STAN_NOWY_BOOT_MS - przyjmujemy */
          if (r.dwa && r.dwa.boot === s.boot) {
            zapisz('stan: drugi sterownik na prefiksie (u ' + o.u + ') nadaje dalej, a pokazywany (u ' + r.u + ') milczy od '
                   + Math.round((teraz - zA) / 1000) + ' s - przyjmuję drugi');
            /* [sceptyk 4, Ś-1] flaga opisuje DRUGIEGO - po przejęciu drugim jest dotąd pokazywany (zasada 10: serwisant szuka właściwego) */
            const d = M.dwaSterowniki[pref]; if (d) Object.assign(d, { boot: r.boot, u: r.u, kiedy: zA });
          }
          else if (!o.stary && u != null && r.u != null && u < r.u)
            zapisz('stan: nowe uruchomienie sterownika z NIŻSZYM u (' + r.u + ' → ' + u + ', skasowana pamięć?) - nadaje od '
                   + Math.round((teraz - o.od) / 1000) + ' s, przyjmuję');
          else zapisz('stan: uruchomienie boot ' + bootKrotko(s.boot) + ' (u ' + o.u + ') nadaje dalej, a dotychczasowe (u ' + r.u
                      + ') milczy od ' + Math.round((teraz - zA) / 1000) + ' s - przyjmuję');
          odlozBoot(r); r.inne.delete(s.boot);
          Object.assign(r, { boot: s.boot, seq: s.stan_seq, u: u != null ? u : o.u, od: o.od, seq0: o.seq0, kiedy: teraz, dwa: null });
        } else if (u != null && r.u != null && u < r.u) {         /* nieznany boot z niższym u: spóźniony ALBO nowy po skasowaniu NVS */
          const k = { seq: s.stan_seq, seq0: s.stan_seq, u, od: teraz, stary: false, sonda: false };
          r.inne.set(s.boot, k);
          while (r.inne.size > STAN_INNE_MAX) r.inne.delete(r.inne.keys().next().value);
          zapisz('stan: nieznane uruchomienie z niższym u (' + u + ' < ' + r.u + ') - pomijam; jeśli będzie nadawać dalej przez '
                 + Math.round(STAN_NOWY_BOOT_MS / 1000) + ' s, przyjmę je jako nowe');
          sondaKandydata(pref, s.boot, k);
          return false;
        } else {                                /* nieznany boot z wyższym (albo nieznanym) u = nowe uruchomienie od razu */
          odlozBoot(r);
          Object.assign(r, { boot: s.boot, seq: s.stan_seq, u: u != null ? u : r.u, od: teraz, seq0: s.stan_seq, kiedy: teraz, dwa: null });   /* [D4] */
          zapisz('stan: nowe uruchomienie sterownika (u ' + (u != null ? u : '?') + ')');
        }
      }
      /* [S1] lustro z wyższego u niż POTWIERDZONE bieżące uruchomienie (numer rośnie dłużej niż STAN_NOWY_BOOT_MS)
         [R1] ... chyba że u lustra przyszło z brokera przed chwilą - wtedy spóźniony jest ten snapshot, nie lustro */
      const w = obiekty[pref];
      if (u != null && w && licznikU(w.u) && u < w.u && r.seq > r.seq0 && teraz - r.od > STAN_NOWY_BOOT_MS
          && !(w.uBrok && w.uBrok.u === w.u && teraz - w.uBrok.t <= STAN_NOWY_BOOT_MS)) {
        zapisz('lustro z uruchomienia u ' + w.u + ', a sterownik nadaje u ' + u + ' - lustro od nowa, proszę o pełny blok');
        w.u = u; w.seq = null; w.luka = true; w.lukaOd = teraz;
        if (pref === wybrany) prosPelny('nowe uruchomienie (niższe u)');
      }
      return true;
    };
    const zegarUstaw = (pref, czas) => {
      const zg = zegar[pref], teraz = Date.now();
      if (zg) {
        const szac = zg.czas + (teraz - zg.kiedy) / 1000;
        if (czas < szac - ZEGAR_LUZ_S && czas > szac - ZEGAR_SKOK_S) {
          if (!zg.odrzOd) zg.odrzOd = teraz;
          if (teraz - zg.odrzOd < ZEGAR_UPOR_MS) return false;
          zapisz('zegar sterownika cofnął się o ' + Math.round(szac - czas) + ' s (próbki starsze przez '
                 + Math.round((teraz - zg.odrzOd) / 1000) + ' s) - przyjmuję');
        } else if (czas <= szac - ZEGAR_SKOK_S) zapisz('zegar sterownika przestawiony o ' + Math.round(czas - szac) + ' s - przyjmuję');
      }
      zegar[pref] = { czas, kiedy: teraz };
      return true;
    };
    /*  DOSTĘPNOŚĆ TYLKO Z DRÓG, KTÓRE ŻYJĄ [D-481, audyt Astry 20.09 „spójność" P2]. `statusy` trzyma
        ostatni `status` per broker; „online" liczy się, jeśli CHOĆ JEDEN broker tak mówi [D-314]. Ale wpis
        z drogi, która się ZERWAŁA, to „ostatnio online", nie „teraz online" — a przeważał nad świeżym
        „offline" z działającej drogi. Zerwany broker traci głos: jego wpis kasujemy przy zerwaniu
        (`statusBezDrogi`), a status liczymy na nowo z tego, co zostało. Gdy nie zostało nic — „?",
        nie „online" i nie „offline" (nie wiemy, więc nie udajemy). */
    const przeliczStatus = w0 => {
      const lista = Object.values(w0.statusy || {});
      w0.status = lista.indexOf('online') >= 0 ? 'online' : (lista.indexOf('offline') >= 0 ? 'offline' : '?');
    };
    const statusBezDrogi = nr => {
      for (const p in obiekty) { const w0 = obiekty[p]; if (w0 && w0.statusy && (nr in w0.statusy)) { delete w0.statusy[nr]; przeliczStatus(w0); } }
    };
    const f0 = window.fetch.bind(window);
    window.fetch = function (u, opt) {
      const s = String(u);
      if (s.startsWith('/rej')) {                                   /* rejestry z lustra [D-277] */
        const q = new URLSearchParams(s.slice(s.indexOf('?') + 1));
        const adr = +q.get('adr') || 0, ile = Math.max(1, +q.get('ile') || 1);
        const w = wybrany && obiekty[wybrany]; const out = []; let hasla = 1;
        for (let i = 0; i < ile; i++) { const v = (w && w.r) ? w.r[adr + i] : undefined; out.push(v === undefined ? null : v); if (HASLA_REJ(adr + i)) hasla = 0; }
        return Promise.resolve(new Response(JSON.stringify({ adr, ile, wartosci: out, hasla }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      /*  KARTA SD PRZEZ BROKER [D-297]: /pliki?kat= i /plik?kat=&nazwa=[&json=1] - to samo, co daje bridge po USB,
          tu przez `zadanie`=pliki:<kat> / plik:<kat>/<nazwa>:<od> i tematy `pliki`/`plik` (kawałki do końca). */
      if (s.startsWith('/pliki')) {
        const q = new URLSearchParams(s.slice(s.indexOf('?') + 1)); const kat = q.get('kat') || 'zdarzenia';
        const odp = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (!wybrany || !klGot(wybrany)) return Promise.resolve(odp({ karta: null, pliki: [] }));
        /*  [PWA-6, Astra 13] NOWA PROSBA KONCZY POPRZEDNIA - wynikiem „zastapiona", nie porzuceniem (porzucona
            obietnica = ekran na zawsze „odswiezam…"). */
        if (czekaPliki) { const st = czekaPliki; czekaPliki = null; clearTimeout(st.t); st.res(odp({ karta: null, pliki: [], blad: 'prośba zastąpiona nowszą' })); }
        const ridP = rpcRid(wybrany);   /* [Sol S20] */
        return new Promise(res => { czekaPliki = { kat, res, pref: wybrany, rid: ridP, t: setTimeout(() => { if (czekaPliki && czekaPliki.res === res) { czekaPliki = null; res(odp({ karta: null, pliki: [] })); } }, 8000) };
                                    oglos('pliki:' + kat + (ridP ? ';rid=' + ridP + ';part=0' : '')); }).then(r => r);
      }
      if (s.startsWith('/okres')) {               /* zdarzenia z okresu [D-298]: kawałki aż dalej=0 */
        const q = new URLSearchParams(s.slice(s.indexOf('?') + 1)); const kat = q.get('kat') || 'zdarzenia', od = +q.get('od') || 0, dok = +q.get('do') || 0;
        if (!wybrany || !klGot(wybrany)) return Promise.resolve(new Response(JSON.stringify({ blad: 'brak połączenia' }), { status: 200 }));
        const stara = czekaOkres[kat];      /* [D-348] ta sama kategoria pyta ponownie - zamknij poprzednia */
        if (stara) { clearTimeout(stara.t); delete czekaOkres[kat];
                     stara.res(new Response(JSON.stringify({ blad: 'prośba zastąpiona nowszą' }), { status: 200 })); }
        return new Promise(res => {
          const c = { kat, od, dok, poz: 0, linie: [], res, t: null, pref: wybrany, rid: rpcRid(wybrany), part: 0 };   /* pref: kogo pytamy [2026-09-26]; rid/part [Sol S20] */
          czekaOkres[kat] = c;
          const nastepny = () => { oglos('okres:' + kat + ':' + od + ':' + dok + ':' + c.poz + (c.rid ? ';rid=' + c.rid + ';part=' + c.part : ''));   /* poz = kursor z odpowiedzi [D-300] */
            c.t = setTimeout(() => { if (czekaOkres[kat] === c) { delete czekaOkres[kat]; res(new Response(JSON.stringify({ blad: 'sterownik nie odesłał okresu w 10 s' }), { status: 200 })); } }, 10000); };
          c.nastepny = nastepny; nastepny();
        });
      }
      if (s.startsWith('/plik?')) {
        const q = new URLSearchParams(s.slice(s.indexOf('?') + 1)); const kat = q.get('kat') || 'zdarzenia', nazwa = q.get('nazwa') || '', json = q.get('json') === '1';
        if (!wybrany || !klGot(wybrany) || !nazwa) return Promise.resolve(new Response(JSON.stringify({ blad: 'brak połączenia' }), { status: 200 }));
        /*  [PWA-6, Astra 13] drugie pobranie w trakcie pierwszego: pierwsze konczy sie bledem „zastapione" -
            dawniej `czekaPlik` byl po prostu nadpisywany, a obietnica pierwszego nie rozwiazywala sie nigdy. */
        if (czekaPlik) { const st = czekaPlik; czekaPlik = null; clearTimeout(st.t);
                         st.res(new Response(JSON.stringify({ blad: 'prośba zastąpiona nowszą' }), { status: 200 })); }
        return new Promise(res => {
          czekaPlik = { kat, nazwa, od: 0, tekst: '', res, json, t: null, pref: wybrany, rid: rpcRid(wybrany), part: 0 };   /* rid/part [Sol S20] */
          const nastepny = () => { oglos('plik:' + kat + '/' + nazwa + ':' + czekaPlik.od + (czekaPlik.rid ? ';rid=' + czekaPlik.rid + ';part=' + czekaPlik.part : ''));
            czekaPlik.t = setTimeout(() => { if (czekaPlik && czekaPlik.res === res) { czekaPlik = null; res(new Response(JSON.stringify({ blad: 'sterownik nie odesłał pliku w 10 s' }), { status: 200 })); } }, 10000); };
          czekaPlik.nastepny = nastepny; nastepny();
        });
      }
      if (!s.startsWith('/cmd')) return f0(u, opt);
      const q = new URLSearchParams(s.slice(s.indexOf('?') + 1));
      const co = q.get('co') || 'rej', wart = q.get('wart');
      const tr = komendaNaZapisy(co, wart, M.obieg);
      const odp = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (tr.blad) return Promise.resolve(odp({ ok: false, opis: tr.blad }));
      if (!wybrany || !klGot(wybrany)) return Promise.resolve(odp({ ok: false, opis: 'brak połączenia z brokerem' }));
      const wyslij = pin => new Promise(res => {
        /* ZEGAR STEROWNIKA, nie telefonu: DS3231 chodzi w czasie lokalnym, telefon
           liczy UTC - 2 h różnicy odbijało każdą komendę kodem 2 („sprawdź zegar").
           Sterownik nadaje `czas` w `stan`; liczymy od niego + ile minęło u nas. */
        const zg = zegar[wybrany];
        const tSter = zg ? Math.floor(zg.czas + (Date.now() - zg.kiedy) / 1000) : Math.floor(Date.now() / 1000);
        const id = nowyId(), t0 = Date.now(), coTxt = co + (wart != null ? '=' + wart : '');
        const tresc = 't=' + tSter + ';id=' + id + (pin ? ';pin=' + pin : '') + ';w=' + tr.zapisy.map(z => z[0] + ':' + z[1]).join(',');
        const msg = new Paho.Message(tresc); msg.destinationName = wybrany + '/komenda'; msg.qos = 1;
        const kk = klGot(wybrany);   /* [D-313] brokerem, którym ten obiekt nadaje; mógł paść między sprawdzeniem a wysyłką */
        if (!kk) { res({ ok: false, opis: 'brak połączenia z brokerem' }); return; }
        /* [zadanie 13] wpis + termin PRZED wysyłką, jeden koniec; [PWA-7] {sterownik, id}; [Sol S23] po terminie NIEZNANY */
        const op = operacjaKomendy(id, coTxt, wybrany, res, 5000, {
          termin: { ok: false, nieznany: true, opis: 'wynik nieznany - sterownik nie potwierdził w 5 s; rozkaz mógł się wykonać, sprawdź stan przed ponowieniem' },
          nieWyslano: { ok: false, opis: 'nie wysłano - brak połączenia z brokerem' },
          bladWysylki: { ok: false, nieznany: true, opis: 'wynik nieznany - błąd przy wysyłce; rozkaz mógł wyjść, sprawdź stan przed ponowieniem' } });
        czekamZmiany = { t0, co: coTxt };
        op.wyslij(kk, msg);
      });
      return wyslij(pinSerwis).then(r => {
        if (r.kod === 3 && !pinSerwis) {           // rejestr serwisowy - raz zapytaj o PIN i powtórz
          const p = prompt('Ta zmiana wymaga PIN-u serwisowego sterownika:', '');
          if (!p) return odp({ ok: false, opis: 'bez PIN-u serwisowego' });
          pinSerwis = p;
          return wyslij(pinSerwis).then(r2 => { if (r2.kod === 3) pinSerwis = null; return odp(r2); });
        }
        return odp(r);
      });
    };
    const obiekty = {};                 /* prefiks -> {txt, kiedy, status} */
    /*  WŁASNE NAZWY KANAŁÓW [D-493]: temat `nazwy` (retained, „kanał;nazwa" w liniach) zamieniamy na słowa
        rejestrów 4140+ - te same, które strona na AP czyta z /rej - i doklejamy do lustra przy każdym pełnym
        bloku (blok podmienia całe `w.r`). Dekodowanie jest jedno: dodatki() → akc_naz. */
    const nazwyR = {};                  /* prefiks -> {adres: słowo} */
    const zdarzenia = {};               /* prefiks -> {ile, zgubione, wpisy[[czas,kat,kod,zr,ob,a,b,c]]} [D-295] */
    let czekaPliki = null, czekaPlik = null;                      /* prośby o listę / plik z karty SD [D-297] */
    let czekaZapas = null;                                        /* [D-412] kto czeka na report o rezerwie */
    const _spisy = {};                            /* [D-429] obieg -> droga -> {s, kiedy, zastany} */
    /*  Ktoremu spisowi wierzyc, gdy drogi podaja rozne [D-429]:
        1. z drogi, ktora obiekt NADAJE - tylko ona jest z definicji swieza;
        2. najswiezszy NIEZASTANY (sterownik wlasnie go oglosil);
        3. w ostatniej kolejnosci najnowszy jakikolwiek - lepszy niz nic. */
    const _spisWybrany = pref => {
      const d = _spisy[pref]; if (!d) return null;
      const w = obiekty[pref];
      const nios = w && w.kl && w.kl.nr;
      if (nios && d[nios]) return d[nios].s;
      const lista = Object.keys(d).map(k => d[k]);
      const swieze = lista.filter(x => !x.zastany).sort((a, b) => b.kiedy - a.kiedy);
      if (swieze.length) return swieze[0].s;
      return lista.sort((a, b) => b.kiedy - a.kiedy)[0].s;
    };
    /*  PROSBA O OKRES - OSOBNA NA KAZDA KATEGORIE [D-348, 2026-09-12]
        ------------------------------------------------------------
        WEJSCIA:  zadania `/okres?kat=zdarzenia` i `/okres?kat=alarmy`; odpowiedzi z tematu `okres`.
        CO Z CZEGO WYNIKA: kazda kategoria ma WLASNY wpis w tej mapie, wiec dwie prosby moga biec
                  obok siebie; odpowiedz trafia do wlasciwej po nazwie kategorii z naglowka.
        WYJSCIA:  rozwiazana obietnica `fetch` - zawsze, takze gdy prosba zostaje porzucona.

        ⛔ DLACZEGO NIE JEDNA ZMIENNA, JAK BYLO: druga prosba nadpisywala pierwsza, a warownik
        przy jej liczniku czasu sprawdzal `czekaOkres.res === res` - po nadpisaniu rownosc juz nie
        zachodzila, wiec licznik MILCZAL i obietnica pierwszej prosby NIE ROZWIAZYWALA SIE NIGDY.
        Ekran zostawal z `laduje = true`, czyli z napisem „odswiezam..." bez „odswiez" i bez
        „pobierz CSV" - dokladnie to zglosil Tomasz o dzienniku zdarzen.
        ⚠ Wyszlo dopiero teraz, bo do D-346 historia alarmow NIE pytala sama - trzeba bylo kliknac.
        Odkad oba rejestry laduja 24 h same, wejscie w alarmy i zaraz w dziennik daje dwie prosby
        pod rzad i kolizja jest codziennoscia, a nie przypadkiem.
        ⚠ Gdy ta sama kategoria pyta drugi raz, STARA prosbe konczymy bledem zamiast ja porzucac -
        porzucona obietnica to zawieszony ekran, a blad ma przynajmniej przycisk „odswiez". */
    const czekaOkres = Object.create(null);
    /*  BEZPIECZNIK STRON JEDNEJ PROSBY [PWA-6, 29.09]: dziennik tygodnia to kilkadziesiat stron; 300 to zapas,
        ktory nigdy nie zatrzyma prawdziwej prosby, a zatrzyma kazda petle. */
    const OKRES_MAX_STRON = 300;
    let prosZdOst = 0;
    /* prośba o pamięć zdarzeń (RAM sterownika); przed połączeniem NIE liczy się jako próba - inaczej wstępne wczytanie
       ze startu aplikacji (D-308) przepadało i dziennik czekał 15 s na kolejną */
    M.prosZdarzenia = () => { if (!wybrany || !klGot(wybrany)) return; const t = Date.now(); if (t - prosZdOst < 15000) return; prosZdOst = t; oglos('zdarzenia'); };
    /*  HISTORIA POMIARÓW - POBIERANIE STRUMIENIEM [D-511, Tomasz 30.09: „pobrała i trzymała dane ze sterownika
        KOMPLETNE z całej historii pomiaru”]
        ------------------------------------------------------------
        WEJŚCIA:  baza w telefonie (HiBaza: meta obiektu), zegar sterownika (`stan` / `zm` - pole t= prośby), temat
                  `historia` (odpowiedzi TYLKO brokerem, którym poszła prośba - dlatego prosimy jedną drogą, klGot).
        CO Z CZEGO WYNIKA: faza 1 = od ostatniej próbki w telefonie (pierwszy raz: ostatnie HI_NA_START_S) do teraz,
                  potem faza 2 w tle = starsze od granicy kompletu (wznawialna). Kawałki -> HI.przyjmij -> baza (jedna
                  transakcja na kawałek, po kolei) -> zdarzenie `dane` dla wykresu. Luka w numeracji albo cisza =
                  wznowienie `wznow=<id>` od ostatniej dobrej próbki (najwyżej HI_WZNOWIEN_MAX razy); sterownik zajęty
                  innym odbiorcą (3) albo w trakcie aktualizacji (6) = ponowienie po HI_CZEKAJ od ostatniej dobrej próbki;
                  każda inna odmowa = tekst sterownika na pasku wykresu.
        WYJŚCIA:  M.historia = { dociagnij, sluchaj, stan, czytaj, meta, miejsce, przerwij }; zdarzenia
                  {typ: start|postep|dane|koniec|blad, pref, faza, postep, tekst, probki?}.
        ⚠ Jedno pobieranie naraz (sterownik i tak odmówi drugiego) - `dociagnij` w trakcie zwraca tę samą obietnicę. */
    const HI_NA_START_S = 7 * 86400;     /* pierwsze pobranie: tyle wstecz w fazie 1 (wykres ma 7 dni), reszta w fazie 2 */
    const HI_CISZA_START_MS = 15000;     /* od prośby do pierwszej odpowiedzi */
    const HI_CISZA_MS = 12000;           /* między kawałkami - sterownik nadaje co 0,1 s, przez chmurę kawałek to < 1 s */
    const HI_WZNOWIEN_MAX = 6;           /* luk / cisz na jedno pobieranie, potem błąd z opisem */
    const HI_BEZ_ODP_MAX = 2;            /* prośby bez żadnej odpowiedzi (starsze oprogramowanie sterownika) */
    /*  ODMOWY, PO KTÓRYCH CZEKAMY I PONAWIAMY (obiekt, nie stałe - test w przeglądarce skraca czasy, M.historia._czekaj):
        • zajete (kod 3) - sterownik wysyła innemu odbiorcy: 6 × 15 s = 90 s - miesiąc dwóch obiegów (1,1 MB) przez chmurę
          to wg oszacowania w 21b [6] 30-75 s; także nasz własny strumień sprzed przeładowania strony (nowe id, bez `wznow`);
        • aktual (kod 6) [przegląd historii 1, S5] - trwa aktualizacja sterownika albo panelu (radio silence D-458):
          20 × 30 s = 10 min - aktualizacja panelu to ~7 min, sterownika ~2-3 min z restartem; potem błąd z tekstem sterownika. */
    const HI_CZEKAJ = { zajeteMs: 15000, zajeteMax: 6, aktualMs: 30000, aktualMax: 20 };
    const hist = { b: null, trwa: null, sluch: new Set(), ost: null };
    const hiEmit = e => { hist.ost = e; hist.sluch.forEach(f => { try { f(e); } catch (x) {} }); };
    const hiUtc = () => Math.floor(Date.now() / 1000);
    const hiZegar = pref => { const z = zegar[pref]; return z ? Math.floor(z.czas + (Date.now() - z.kiedy) / 1000) : 0; };
    const hiWyslij = (pref, tresc) => {
      const kk = klGot(pref); if (!kk) return false;
      try { const m = new Paho.Message(tresc); m.destinationName = pref + '/zadanie'; m.qos = 1; kk.send(m); return true; } catch (e) { return false; }
    };
    const hiProcent = b => Math.round(100 * HI.postep(b.s, hiUtc(), b.od0, b.ost));
    const hiOpisFazy = b => (b.faza === 1 ? 'pobieram historię ze sterownika' : 'dociągam starszą historię ze sterownika');
    /* jedna prośba (nowa albo wznowienie); false = nie ma czym (broker, zegar) */
    const hiProsba = (b, wznow) => {
      const t = hiZegar(b.pref);
      if (!t) return false;
      const id = nowyId();
      b.s = HI.odbior(id, b.od, b.dok); b.ostMs = Date.now();
      const tresc = 'historia:od=' + b.od + (b.dok ? ';do=' + b.dok : '') + ';t=' + t + ';id=' + id + (wznow ? ';wznow=' + wznow : '');
      if (!hiWyslij(b.pref, tresc)) return false;
      b.prosb++;
      return true;
    };
    const hiZakoncz = (b, wynik) => {
      if (hist.b !== b) return;
      hist.b = null; clearInterval(b.straz);
      /*  Kończymy z błędem, a sterownik mógł jeszcze nadawać (cisza po naszej stronie, zmiana obiektu, błąd bazy) -
          `stop`, żeby nie wysyłał reszty w próżnię i nie odmawiał „zajęte” następnej prośbie. Nie po odmowie i nie po
          `stop` sterownika (tam nic nie leci). */
      if (wynik.blad && b.s && !b.s.koniec && !wynik.bezStop) hiWyslij(b.pref, 'historia:stop;id=' + b.s.id);
      b.zap.obietnica.then(() => {
        if (wynik.blad) { zapisz('historia: ' + wynik.blad); hiEmit({ typ: 'blad', pref: b.pref, faza: b.faza, tekst: wynik.blad, kod: wynik.kod }); }
        b.res(Object.assign({ probek: b.probek, faza: b.faza }, wynik));
      });
    };
    const hiWznow = (b, powod) => {
      if (b.wznowien >= HI_WZNOWIEN_MAX) { hiZakoncz(b, { blad: 'pobieranie historii przerwane po ' + b.wznowien + ' wznowieniach (' + powod + ') - spróbuję przy następnym otwarciu' }); return; }
      b.wznowien++;
      const stary = b.s ? b.s.id : 0;
      if (b.s) b.od = HI.wznowOd(b.s);
      zapisz('historia: ' + powod + ' - wznawiam od ' + new Date(b.od * 1000).toLocaleString('pl-PL'));
      if (!hiProsba(b, stary)) hiZakoncz(b, { blad: 'brak połączenia z brokerem - historia dokończy się przy następnym połączeniu' });
    };
    const hiOdebrano = (pref, u8) => {
      const b = hist.b; if (!b || b.pref !== pref || !b.s || !u8) return;
      const w = HI.przyjmij(b.s, u8);
      if (w.co === 'obcy' || w.co === 'dubel') return;
      b.ostMs = Date.now(); b.odp = true;
      if (w.co === 'start') {
        b.zap.start(b.s.start);                               /* kolejka zapisu [W2] - po pierwszym błędzie nic już nie pisze */
        hiEmit({ typ: 'start', pref, faza: b.faza, postep: hiProcent(b), tekst: hiOpisFazy(b) + '…' });
        return;
      }
      if (w.co === 'dane') {
        for (const p of w.probki) if (p.czas > b.ost) b.ost = p.czas;
        b.probek += w.probki.length;
        if (w.probki.length) {
          const pr = w.probki;
          b.zap.dane(pr, () => hiEmit({ typ: 'dane', pref, faza: b.faza, probki: pr, postep: hiProcent(b), tekst: hiOpisFazy(b) + '…' }));
        } else hiEmit({ typ: 'postep', pref, faza: b.faza, postep: hiProcent(b), tekst: hiOpisFazy(b) + '…' });
        return;
      }
      if (w.co === 'luka') { hiWznow(b, 'luka w strumieniu (' + w.brak + ')'); return; }
      if (w.co === 'stop') { hiZakoncz(b, { blad: 'pobieranie historii zatrzymane', bezStop: true }); return; }
      if (w.co === 'koniec') {
        /* [przegląd historii 2, W1] uszkodzonych > 0 = sterownik nie miał czym uzupełnić uszkodzonego zapisu - meta to pamięta,
           wynik niesie liczbę (hiDociagnij robi z niej zdanie na pasek: HI.uwagaUszk) */
        const uszk = w.uszkodzonych || 0;
        b.zap.koniec(b.s.start, uszk).then(() => {
          if (b.zap.blad) return;                             /* [W2] poBledzie już zakończył pobieranie z opisem */
          zapisz('historia faza ' + b.faza + ': ' + b.probek + ' próbek w ' + Math.round((Date.now() - b.t0) / 100) / 10 + ' s'
                 + (b.wznowien ? ', wznowień ' + b.wznowien : '') + (uszk ? ', sterownik pominął uszkodzony zapis ' + uszk + ' B' : ''));
          if (hist.b !== b) return;
          hist.b = null; clearInterval(b.straz);
          hiEmit({ typ: 'koniec', pref, faza: b.faza, postep: 100, probek: b.probek, tekst: HI.uwagaUszk(uszk) });
          b.res({ ok: true, probek: b.probek, faza: b.faza, uszkodzonych: uszk });
        });
        return;
      }
      if (w.co === 'odmowa') {
        /*  Odmowa „lokalna” (aplikacja sama odrzuciła nagłówek `start`: obca wersja formatu, karta sterownika wstrzymana [S4]) =
            sterownik NADAJE dalej - najpierw `stop`, żeby nie słał reszty w próżnię i nie odmawiał „zajęte” następnej prośbie. */
        if (w.lokalna && b.s) hiWyslij(b.pref, 'historia:stop;id=' + b.s.id);
        /*  Zajęty innym odbiorcą (3) albo AKTUALIZACJA (6) [przegląd historii 1, S5]: czekamy i ponawiamy od ostatniej DOBREJ
            próbki - 6 przychodzi także w środku strumienia, kawałki sprzed niej są już w kolejce zapisu. Pasek pokazuje tekst
            sterownika (zasada 10), nie „ciszę”. */
        const zajete = w.kod === HI.ODM_ZAJETE && b.zajete < HI_CZEKAJ.zajeteMax;
        const aktual = w.kod === HI.ODM_AKTUALIZACJA && b.aktual < HI_CZEKAJ.aktualMax;
        if (zajete || aktual) {
          if (zajete) b.zajete++; else b.aktual++;
          if (b.s) b.od = HI.wznowOd(b.s);
          b.s = null;
          const ms = zajete ? HI_CZEKAJ.zajeteMs : HI_CZEKAJ.aktualMs;
          hiEmit({ typ: 'postep', pref, faza: b.faza, postep: 0,
                   tekst: (zajete ? 'sterownik wysyła historię innemu odbiorcy' : 'sterownik: ' + (w.tekst || 'trwa aktualizacja')) + ' - ponowię za ' + Math.round(ms / 1000) + ' s' });
          setTimeout(() => { if (hist.b === b && !hiProsba(b)) hiZakoncz(b, { blad: 'brak połączenia z brokerem' }); }, ms);
          return;
        }
        hiZakoncz(b, { blad: 'sterownik odmówił historii: ' + (w.tekst || 'kod ' + w.kod), kod: w.kod, bezStop: true });
      }
    };
    /* jedna faza: obietnica wyniku {ok|blad, probek} */
    const hiPobierz = (pref, faza, od, dok) => new Promise(res => {
      const b = { pref, faza, od, od0: od, dok: dok || 0, s: null, res, zap: null, probek: 0, ost: 0,
                  wznowien: 0, zajete: 0, aktual: 0, prosb: 0, odp: false, t0: Date.now(), ostMs: Date.now() };
      /*  [przegląd historii 1] kolejka zapisu tego pobierania: `ost` przycięty do zegarów [W1], stop na pierwszym błędzie
          bazy [W2] - pobieranie kończy się `stop`-em do sterownika i zdaniem, CZEMU (zasada 10); meta stoi na ostatnim
          zapisanym kawałku, więc następne dociągnięcie zaczyna od dziury. */
      b.zap = HI.zapisPobierania(HiBaza, pref, faza, od, () => HI.granicaOst(hiUtc(), b.s && b.s.start));
      b.zap.poBledzie = e => hiZakoncz(b, { blad: 'telefon nie zapisał historii (' + (e && e.message || e) + ') - pobieranie zatrzymane; '
                                                  + 'wykres pokazuje, co zdążył zebrać, następne dociągnięcie zacznie od miejsca błędu' });
      const kc = klDla(pref);
      /*  [INTEGRACJA-2a, Sol Z1/Z2] tylko filtry TEGO obiektu w BIEŻĄCEJ partii bieżącego klienta (histStan wyżej) */
      const hs = histStan(kc, pref);
      if (hs === 'odmowa') {
        res({ blad: 'konto na serwerze nie ma prawa odbierać historii (rola sprzed D-511) - wykres z danych zebranych w telefonie; serwis: dopisz temat historia do roli klienta' });
        return;
      }
      if (hs === 'czeka') {
        res({ blad: 'broker jeszcze nie potwierdził zapisu na historię tego obiektu - spróbuj za chwilę' });
        return;
      }
      if (hs === 'lacze') {
        res({ blad: 'zapis na historię tego obiektu nie potwierdzony (łącze albo brak odpowiedzi brokera) - spróbuj ponownie' });
        return;
      }
      hist.b = b;
      if (!hiProsba(b)) { hist.b = null;
        res({ blad: hiZegar(pref) ? 'brak połączenia z brokerem' : 'nie znam jeszcze zegara sterownika (czekam na pierwszy stan)' }); return; }
      hiEmit({ typ: 'start', pref, faza, postep: 0, tekst: hiOpisFazy(b) + '…' });
      /* GUARD CISZY: brak odpowiedzi = wznowienie (sterownik mógł zgubić prośbę albo stracić brokera);
         prośby bez ŻADNEJ odpowiedzi = starsze oprogramowanie sterownika - kończymy z tekstem, bez męczenia łącza */
      b.straz = setInterval(() => {
        if (hist.b !== b || !b.s || b.s.koniec) return;       /* koniec przyszedł - czekamy tylko na zapis do bazy */
        const cisza = Date.now() - b.ostMs, prog = b.s.start || b.s.nr ? HI_CISZA_MS : HI_CISZA_START_MS;
        if (cisza < prog) return;
        if (!b.odp && b.prosb >= HI_BEZ_ODP_MAX) {
          hiZakoncz(b, { blad: 'sterownik nie odpowiada na prośbę o historię - starsze oprogramowanie sterownika albo brak łączności; wykres pokazuje dane zebrane w telefonie' });
          return;
        }
        hiWznow(b, 'cisza ' + Math.round(cisza / 1000) + ' s');
      }, 2000);
    });
    /* faza 1, potem (gdy trzeba) faza 2 - jedna obietnica na raz */
    const hiDociagnij = powod => {
      if (hist.trwa) return hist.trwa;
      const pref = wybrany;
      if (!pref) return Promise.resolve({ blad: 'nie wybrano obiektu' });
      if (!HiBaza.jest()) return Promise.resolve({ blad: 'ta przeglądarka nie ma bazy IndexedDB - wykres tylko z danych zebranych w telefonie' });
      hist.trwa = (async () => {
        try {
          HiBaza.utrwalMagazyn();
          const meta = await HiBaza.meta(pref);
          const p1 = HI.planuj(meta, hiUtc(), HI_NA_START_S);
          zapisz('historia (' + (powod || 'prośba') + '): faza 1 od ' + new Date(p1.od * 1000).toLocaleString('pl-PL'));
          const w1raw = await hiPobierz(pref, 1, p1.od, p1.do);
          if (w1raw.blad || pref !== wybrany) return w1raw;
          const m2 = await HiBaza.meta(pref), p2 = HI.planujStarsze(m2);
          /* sterownik mówi w nagłówku, czy w ogóle zapisuje - `uwaga` idzie z każdym dalszym wynikiem (wykres ją pokazuje);
             [przegląd historii 2, W1] do tego uszkodzony zapis bez drugiej kopii (pole 8 `koniec`) - dziura jest w sterowniku */
          const uwagaZ = (...u) => u.filter(Boolean).join('; ');
          const uwaga = uwagaZ(HI.uwagaRej(m2 && m2.rej), HI.uwagaUszk(w1raw.uszkodzonych)), w1 = uwaga ? Object.assign({}, w1raw, { uwaga }) : w1raw;
          if (!p2) return w1;
          /* ile miejsca: rok jednego obiegu ~ 8 MB; przy braku miejsca nie zaczynamy (lepiej 7 dni niż zerwana baza) */
          const mj = await HiBaza.miejsce(), potrzeba = HI.miejsceNaStarsze(m2, p2);
          if (mj && mj.limit && mj.limit - mj.zajete < potrzeba) return Object.assign({}, w1, { blad: 'za mało miejsca w telefonie na starszą historię (potrzeba ok. ' + Math.round(potrzeba / 1e6) + ' MB)' });
          const w2 = await hiPobierz(pref, 2, p2.od, p2.do);
          const uwaga2 = uwagaZ(HI.uwagaRej(m2 && m2.rej), HI.uwagaUszk((w1raw.uszkodzonych || 0) + (w2.uszkodzonych || 0)));
          return w2.blad ? Object.assign({}, w1, { blad: w2.blad }) : Object.assign({ ok: true, probek: w1.probek + w2.probek }, uwaga2 ? { uwaga: uwaga2 } : {});
        } catch (e) {
          const t = 'baza historii w telefonie niedostępna (' + (e && e.message || e) + ') - wykres z danych zebranych w telefonie';
          hiEmit({ typ: 'blad', pref, tekst: t }); return { blad: t };
        }
      })().finally(() => { hist.trwa = null; });
      return hist.trwa;
    };
    /* przy zmianie obiektu i na życzenie: grzecznie `stop` do sterownika, obietnica kończy się błędem */
    const hiPrzerwij = powod => {
      const b = hist.b; if (!b) return;
      hiZakoncz(b, { blad: powod || 'przerwano' });              /* `stop` do sterownika wysyła hiZakoncz */
    };
    M.historia = {
      dociagnij: hiDociagnij,
      sluchaj: f => { hist.sluch.add(f); return () => hist.sluch.delete(f); },
      stan: () => hist.ost,
      trwa: () => !!hist.b,
      czytaj: (pref, od, dok) => HiBaza.czytaj(pref, od, dok),
      meta: pref => HiBaza.meta(pref),
      miejsce: () => HiBaza.miejsce(),
      przerwij: hiPrzerwij,
      _czekaj: HI_CZEKAJ                                  /* tylko dla testu offline (_test_historia.html skraca czasy ponowień) */
    };
    /*  STAN BROKERA I WYDAWCÓW NA PASKU [Tomasz 2026-09-09: „aplikacja powinna mieć na górze
        status połączenia z brokerem i status wydawców"]. Trzy rzeczy, trzy źródła:
        - broker: zdarzenia własnego klienta (łączę / połączony / odmowa / zerwane);
        - wydawca (sterownik): temat `status` z flagą retained - „online" pisze sterownik
          po połączeniu, „offline" pisze BROKER z testamentu, gdy sterownik zamilknie
          (20a4_siec_mqtt.h). „offline" jest więc wiarygodne także, gdy płyta padła;
        - świeżość: wiek ostatniego `blok` danego obiektu.
        Wszystko idzie w KAŻDYM podaj(): broker{stan,opis}, wydawcy{prefiks→{status,wiek_s}},
        żeby pasek nie musiał składać stanu z kilku różnych wywołań. */
    /*  DZIENNIK ZDARZEŃ KLIENTA [D-278, Tomasz 2026-09-09: „musimy śledzić, co się dzieje, logami"]:
        ostatnie 60 zdarzeń (połączenia, zerwania, żądania, pełne bloki, luki seq) - pasek pokazuje
        je po dotknięciu „PRZEZ CHMURĘ". Do tego timestampy ostatnich zdarzeń, bo „pakiet N s
        temu" nie mówi, CZEGO brak: bloku, paczki czy odpowiedzi na żądanie. */
    M.dziennik = [];
    const ost = { zm: 0, blok: 0, zadanie: 0 };
    const zapisz = txt => { M.dziennik.push({ t: Date.now(), txt }); if (M.dziennik.length > 60) M.dziennik.shift(); };
    zapisz('start klienta ' + (window.APKA_WERSJA || '(bez wersji)') + ' → ' + o.host);
    /* [D-312] w dzienniku łącza widać, CO to konto ogląda - inaczej „nie widzę obiektu" i „nie mam uprawnień" wyglądają tak samo */
    zapisz('zakres kont' + 'a: ' + o.tematy.join(' + ')
           + (o.temat.indexOf('+') >= 0 ? ' (serwisowe - wszystkie sterowniki)' : ' (jeden obiekt)'));
    const wydawcy = () => { const w = {}; for (const p in obiekty)
      w[p] = { status: obiekty[p].status || '?', wiek_s: obiekty[p].kiedy ? (Date.now() - obiekty[p].kiedy) / 1000 : null }; return w; };
    let czekamPoPowrocie = false;        /* od powrotu na ekran / zerwania do pierwszej paczki [D-279] */
    const wspolne = () => { const broker = brokerOgolem();
      /* [D-314] podglad dla sond i diagnostyki: kto niesie wybrany obiekt i w jakim stanie sa brokery */
      M.ostBrokery = POL.map(c => ({ nr: c.nr, host: c.host, stan: c.stan.stan, opis: c.stan.opis, niesie: klDla(wybrany) === c }));
      return ({ obiekty: Object.keys(obiekty), obiekt: wybrany, broker: broker,
                             /*  [D-366] KTO PATRZY: konto serwisowe czy klient. Aplikacja chowa przed klientem
                                 dziennik lacza, czasy i liste serwerow - jemu ma wystarczyc „sterownik jest,
                                 broker jest". Zrodlo to ten sam ptaszek z logowania, ktory wyznacza zakres
                                 tematow [D-312], wiec nie ma drugiej prawdy o tym, kim jest patrzacy. */
                             serwis: !!serwisowe,
                             /*  [D-425] `slot` = numer slotu STEROWNIKA dla tej drogi (z tematu `serwery`,
                                 pole `ja`). Ekran nazywa wiersze „slot 1/2", wiec musi znac numer, ktorym
                                 posluguje sie sterownik - a nie kolejnosc na naszej liscie polaczen. */
                             brokery: POL.map(c => ({ nr: c.nr, slot: c.slot || 0, host: c.host, user: c.user, temat: c.temat, stan: c.stan.stan, opis: c.stan.opis, niesie: klDla(wybrany) === c })),
                             wydawcy: wydawcy(), ost: ost, dziennik: M.dziennik, wersja: window.APKA_WERSJA || '',
                             lacze: czekamPoPowrocie || broker.stan !== 'ok',
                             blad: (broker.stan === 'ok' || broker.stan === 'laczy') ? null : broker.opis }); };
    /* ostatnio wybrany obiekt pamietany w telefonie - przy dwu obiektach aplikacja otwiera ten, na ktory patrzono */
    /*  KLUCZE PAMIĘCI TELEFONU Z PRZEDROSTKIEM APLIKACJI [izolacja TEST2, 23.09]: aplikacja klienta i TEST2 siedzą
        pod jednym origin (GitHub Pages), a localStorage jest per origin - bez przedrostka logowanie
        w TEST2 nadpisywało konto klienta, a „ostatni obiekt" i bloki na zimny start były wspólne.
        `window.APKA_KLUCZ` ustawia zbuduj_pwa.py ('' klient, 'test2:' TEST2); bridge i strona na AP go nie
        mają - tam przedrostek jest pusty i nic się nie zmienia. */
    const KL = k => ((typeof window !== 'undefined' && window.APKA_KLUCZ) || '') + k;
    const pamiec = k => { try { return localStorage.getItem(KL(k)); } catch (e) { return null; } };
    let wybrany = o.obiekt || pamiec('mqtt_obiekt') || null;
    /*  [D-419] Czy wybor jest CZLOWIEKA (z adresu, z pamieci telefonu albo z listy na pasku),
        czy nasz - automatyczny. Tylko ten drugi wolno nam zmienic, gdy obiekt okaze sie martwy. */
    let wybranyRecznie = !!wybrany;
    /*  ZMIANA OBIEKTU - JEDNO MIEJSCE [2026-09-26, Tomasz: „alarmy w sadzawce sa takie same wraz z godzinami
        jak w basen warsztat" - dane z aplikacji PWA]
        ------------------------------------------------------------
        WEJSCIA:  nowy prefiks (lista na pasku, pierwszy obiekt, automat przy martwym obiekcie).
        CO Z CZEGO WYNIKA: prosby o okres/pliki/plik czekajace na POPRZEDNI sterownik konczymy od razu
                  (inaczej jego spozniona odpowiedz wpadlaby do ekranu nowego), a strona dostaje sygnal
                  `okresZmianaObiektu` - jej tabele rejestrow byly jedne dla wszystkich obiektow.
        WYJSCIA:  `wybrany` = nowy prefiks.
        ⚠ Tylko przy PRAWDZIWEJ zmianie; pierwszy wybor (wybrany = null) niczego nie czysci. */
    const zmienWybrany = pref => {
      if (pref === wybrany) return;
      const byl = wybrany; wybrany = pref;
      const zamknij = (c, tresc) => { clearTimeout(c.t); c.res(new Response(JSON.stringify(tresc), { status: 200 })); };
      for (const k of Object.keys(czekaOkres)) { const c = czekaOkres[k]; delete czekaOkres[k]; zamknij(c, { blad: 'zmieniono obiekt' }); }
      if (czekaPliki) { const c = czekaPliki; czekaPliki = null; zamknij(c, { karta: null, pliki: [] }); }
      if (czekaPlik) { const c = czekaPlik; czekaPlik = null; zamknij(c, { blad: 'zmieniono obiekt' }); }
      hiPrzerwij('zmieniono obiekt');                          /* [D-511] historia poprzedniego sterownika - stop, nie do bazy nowego */
      if (byl && typeof window !== 'undefined' && typeof window.okresZmianaObiektu === 'function') {
        try { window.okresZmianaObiektu(pref); } catch (e) {}
      }
    };
    const cid = 'hmi-' + Math.random().toString(16).slice(2, 10);
    /*  UCHWYT DO GNIAZDA [D-310]: Paho nie udostępnia swojego WebSocketa, a po odmrożeniu karty trzeba móc zamknąć
        gniazdo, które zostało „w locie" - inaczej `connect()` odbija się aż do jego własnego limitu czasu (10 s),
        a po nim czeka jeszcze odstęp rosnący do 128 s. Opakowanie jest przezroczyste: tworzy prawdziwy WebSocket
        i tylko zapamiętuje ostatni. Strona nie ma innych WebSocketów (reszta to fetch i SSE). */
    try { const OWS = window.WebSocket;
      if (OWS && !OWS._opakowany) {
        const WSo = function (u, pr) { const s = (pr === undefined) ? new OWS(u) : new OWS(u, pr); M._gniazdo = s; return s; };
        WSo.prototype = OWS.prototype; WSo._opakowany = true;
        ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(n => { WSo[n] = OWS[n]; });
        window.WebSocket = WSo;
      }
    } catch (e) {}
    /*  DWA BROKERY NARAZ [D-313, Tomasz 2026-09-11: „no i co z obsługą 2 brokerów na raz?"].
        Sterownik ma serwer GŁÓWNY i AWARYJNY (rejestr 3225 mówi, którym nadaje) i komendy przyjmuje z obu.
        Aplikacja trzyma teraz po jednym kliencie na broker: JEDNO lustro obiektów, osobne łączenie i osobne
        ponawianie na każdy, a `zadanie` i komendy idą do tego brokera, którym dany obiekt PRZYSZEDŁ
        (`obiekty[pref].kl`). Dzięki temu przełączenie sterownika na awaryjny jest dla patrzącego niewidoczne,
        a konto serwisowe widzi w jednej aplikacji obiekty z HiveMQ i z własnego brokera naraz. */
    /*  PORT W ADRESIE [D-314, Tomasz 2026-09-11: „drugi na EMQX"]: brokery nie zgadzają się co do portu WebSocketu -
        HiveMQ Cloud słucha na 8884, EMQX Cloud na 8084. Dlatego adres wolno podać jako `host:port`; bez portu
        bierzemy 8884 (HiveMQ), a dla adresów EMQX (`*.emqxsl.com`) 8084, żeby nie trzeba było pamiętać liczby.
        ⚠ To port dla PRZEGLĄDARKI (WebSocket po TLS). Sterownik łączy się natywnym MQTT: HiveMQ i EMQX 8883. */
    const adres = (txt, domyslny) => { const s = String(txt || '').trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
      const i = s.lastIndexOf(':');
      if (i > 0 && /^\d+$/.test(s.slice(i + 1))) return { host: s.slice(0, i), port: +s.slice(i + 1) };
      return { host: s, port: domyslny || (/emqxsl\.com$/i.test(s) ? 8084 : 8884) }; };
    const a1 = adres(o.host, o.port);
    const POL = [{ nr: 1, host: a1.host, port: a1.port, user: o.user, pass: o.pass, temat: o.temat, tematy: o.tematy }];
    /*  DRUGI SERWER MA SIE WYLICZYC SAM [D-350, 2026-09-13; objaw Tomasza: „sadzawka - nie widze jej…
        ani broker ani sterownik", przy dzialajacym basenie]
        ------------------------------------------------------------
        WEJSCIA:  zapis logowania z pamieci telefonu: `host2`, `user2`, `pass2` (dwa ostatnie bywaja PUSTE).
        CO Z CZEGO WYNIKA: puste pola znacza „to samo konto z dwojka na koncu i to samo haslo" - dokladnie
                  tak, jak obiecuje podpis pod polem na ekranie logowania („pusto = ten sam z dwojka na koncu").
        WYJSCIA:  drugie polaczenie na liscie POL - albo jego brak, gdy nie ma adresu.

        ⛔ CO BYLO ZLE: warunek brzmial `o.host2 && o.user2`, a ekran logowania zapisuje `user2` PUSTE,
        dopoki czlowiek nie wpisze go recznie. Wyliczenie „user + 2" istnialo WYLACZNIE w chwili proby
        logowania (index.html), nie w zapisie i nie tutaj. Skutek: aplikacja NIGDY nie tworzyla drugiego
        polaczenia - cicho, bez zadnego komunikatu.
        ⚠ DLACZEGO BOLALO DOPIERO TERAZ: dopoki oba sterowniki trzymaly sie brokera glownego, drugiego
        nikt nie potrzebowal. Sadzawka stracila HiveMQ (134 nieudane proby powrotu) i przeszla na brokera
        AWARYJNEGO - nadaje „tematy tylko serwerem 2". Droga zapasowa w sterowniku zadzialala, ale po
        stronie aplikacji nie bylo jej czym odebrac. Awaryjnosc, ktorej nikt nigdy nie sprawdzil na calej drodze,
        jest warta tyle, co jej brak.
        ⚠ Zakres tematow nadal z PIERWSZEGO konta [D-316] - patrz nizej. */
    /*  ⛔ ADRES DRUGIEGO SERWERA TEZ MA SIE WYLICZYC [D-351, 2026-09-13]
        Poprawka D-350 dolozyla wyliczanie KONTA, ale warunek nadal wymagal `o.host2` - a zapis
        logowania zrobiony PRZED wprowadzeniem drugiego serwera [D-314] w ogole tego pola nie ma.
        Zmierzone na telefonie Tomasza (dziennik lacza aplikacji 04bd5b7f91): JEDNA linia „start klienta
        -> hivemq.cloud", zero drugiego polaczenia - przy sadzawce nadajacej wylacznie na EMQX
        (sprawdzone wlasnym klientem na brokerze zapasowym: paczki status/blok/opis/awaria docieraly).
        Efekt na ekranie: „sterownik offline (broker dostal testament)" - bo aplikacja czytala status
        ze STAREGO brokera, gdzie lezy testament sadzawki, zamiast z tego, ktorym ona nadaje.
        ⚠ SPROSTOWANIE [D-373, 2026-09-16]: do 16.09 pusty napis w `host2` znaczyl tu „swiadomy wybor
        jednego serwera" i byl szanowany. TO ROZROZNIENIE BYLO FALSZYWE. Miedzy D-313 (11.09 09:05)
        a D-317 (11.09 11:50) formularz logowania zapisywal `host2: ''`, bo pole „Serwer 2" bylo
        wtedy domyslnie PUSTE - wiec kazdy zapis z tego okna WYGLADA na swiadomy wybor, a nim nie jest.
        Telefon Tomasza mial dokladnie taki zapis: po zdjeciu sterownikow z HiveMQ (D-369) przestal je
        widziec, a PC (zapis pozniejszy) widzial dalej.
        ⚠ CZEMU APLIKACJA SAMA SIE NIE URATOWALA: HiveMQ ZYJE i wpuszcza - nie ma na nim tylko zadnego
        sterownika. Zadna galaz awaryjna (zerwanie lacza, guard ciszy, powrot sieci) nie patrzy na
        „broker odpowiada, ale jest pusty", wiec aplikacja siedziala na zywym, pustym brokerze bez slowa.
        TERAZ: pusty napis znaczy to samo co brak pola - wstawiamy adres wbudowany. Kto naprawde chce
        jednego serwera, po prostu nie dostanie na drugim konta: proba konczy sie odmowa CONNACK,
        pierwszy broker dziala dalej, a w dzienniku lacza widac dlaczego. To jest tansze niz cisza. */
    /*  ⚠ SPROSTOWANIE DO SPROSTOWANIA [D-410, 17.09] — ADRES WBUDOWANY USUNIĘTY.
        D-373 (wyżej) kazało podstawiać wbudowany adres, bo pusty napis nie dawał się odróżnić od
        „nigdy nie ustawione", a aplikacja siedziała cicho na ŻYWYM, ale PUSTYM brokerze. Powód był dobry,
        ale lekarstwo okazało się gorsze: 17.09 telefon Tomasza wskazywał brokera, na którym NIE MA
        KONTA aplikacji — i aplikacja co dwie sekundy budowała klienta od nowa, przy okazji zrywając połączenie,
        które DZIAŁAŁO („serwer 1: połączony ponownie, przerwa 4 s"), a obiegi znikały z ekranu.
        ⚠ Rozstrzygnięcie nie brzmi „zgadywać czy nie zgadywać": REZERWA MA POCHODZIĆ ZE STEROWNIKA,
        a nie ze stałej w kodzie aplikacji. Brak rezerwy = brak rezerwy, ale POWIEDZIANY wprost
        (`rezerwaBrak` niżej), a nie zastąpiony zgadywanką ani przemilczany. To godzi obie lekcje:
        nie ma cichego siedzenia na pustym brokerze i nie ma burzy ponowień na cudzym.
        ⚠ Ponawianie i tak jest dziś odporne [D-407]: odstęp rośnie, a martwa droga nie każe
        sterownikowi wracać do nadawania równoległego. Ale to zabezpieczenie, nie powód, żeby zgadywać. */
    /*  KONTA ZAPASOWE: DO NAZWY DOKLEJA SIE NUMER SERWERA  [D-416, Tomasz 17.09]
        ------------------------------------------------------------
            nasz broker   `Master`   `wanna-gliczarow`      (bez cyfry = serwer glowny)
            HiveMQ        `Master2`  `wanna-gliczarow2`     (zapas)
            EMQX          `Master3`  `wanna-gliczarow3`     (rezerwa)
        Haslo jest TO SAMO na wszystkich trzech brokerach danego odbiorcy, wiec aplikacja nie musi
        go liczyc - bierze haslo glowne, gdy rubryka zapasu zostala pusta.

        ⛔ BYLA TU PRZEZ POL GODZINY ZASADA „Z ZEREM" (`Master0` -> `Master`, `Master2`) i zostala
        cofnieta, bo WYMAGALA MYSLENIA: trzeba bylo wiedziec, ze zero znaczy „glowny", ze rdzen
        powstaje przez odciecie zera i ze serwis liczy sie inaczej niz klient. Tu nie ma czego
        wiedziec - jedna zasada dla wszystkich, ta sama w aplikacji, w konsoli dostawcy i na kartce.
        Numeracja zgadza sie przy tym ze slotami sterownika: 1 glowny, 2 zapas, 3 rezerwa.
        ⚠ Wpisane recznie pole zawsze wygrywa z wyliczeniem - konwencja to udogodnienie, nie przymus. */
    const _kontoZap = nr => (o.user ? o.user + nr : '');
    const _host2 = (o.host2 || '').trim();
    const _user2 = o.user2 || _kontoZap(2);
    const _pass2 = o.pass2 || o.pass;
    if (_host2 && _user2) { const a2 = adres(_host2, o.port2);
      /*  ⚠ ZAKRES TEMATÓW BIERZEMY Z PIERWSZEGO KONTA, NIE Z DRUGIEGO [D-316, Tomasz 2026-09-11: konto klienta
          na drugim brokerze nazywa się inaczej niż na pierwszym]. To ten SAM obiekt i ten sam
          prefiks tematu w sterowniku - różnią się tylko konta u dwóch dostawców. Liczenie tematu z nazwy drugiego
          konta dawało `basen/wanna/gliczarow2`, czyli nasłuch w próżni. Nazwa konta na drugim brokerze może być
          dowolna; `temat2` zostaje furtką, gdyby kiedyś prefiks naprawdę się różnił. */
      POL.push({ nr: 2, host: a2.host, port: a2.port, user: _user2, pass: _pass2,
                 temat: o.temat2 || o.temat, tematy: o.temat2 ? [o.temat2] : o.tematy }); }
    /*  [D-410] DRUGA REZERWA — sterownik wybiera JEDNĄ z dwóch kandydatek [D-383] i aplikacja nie wie,
        którą akurat wziął. Dlatego słucha obu: obiekt pokaże się niezależnie od tego, przez którą
        nadaje. Konto i hasło jak przy pierwszej rezerwie; zakres tematów ZAWSZE z konta głównego
        (ta sama zasada co w D-316 — to ten sam obiekt, różnią się tylko konta u dostawców). */
    const _host3 = (o.host3 || '').trim();
    const _user3 = o.user3 || _kontoZap(3);
    const _pass3 = o.pass3 || o.pass;
    if (_host3 && _user3) { const a3 = adres(_host3, o.port3);
      POL.push({ nr: 3, host: a3.host, port: a3.port, user: _user3, pass: _pass3,
                 temat: o.temat3 || o.temat, tematy: o.temat3 ? [o.temat3] : o.tematy }); }
    /*  ⚠ „REZERWY NIE MA" MÓWIMY WPROST (zasada 10) — to jest właśnie ta luka, przez którą D-373
        kazało zgadywać adres. Widoczny stan zamiast ciszy albo zgadywanki. */
    M.rezerwaBrak = (POL.length < 2);
    /*  [próba w słabym zasięgu 02.10, Tomasz na LTE; z quic/audyt-wt 40585abf] IDENTYFIKATOR WEDŁUG NUMERU SERWERA, NIE
        POZYCJI NA LIŚCIE. Dawniej `cid-(pozycja+1)`: przy serwerach 1 i 3 serwer 3 dostawał `cid-2`, a serwer 2 dopisany
        później ze spisu sterownika (`dodajSerwer`, niżej) - też `cid-2`. Na TYM SAMYM brokerze dwie sesje z jednym
        identyfikatorem wyrzucały się nawzajem co ~1 s (dziennik: „serwer 2: zerwane … połączony ponownie (przerwa 1 s)”).
        Teraz wszędzie `cid` / `cid-2` / `cid-3` jak w `dodajSerwer`. Sufiks drogi nakładki MQTT 5 (QUIC = `…q`) zostaje
        po stronie nakładki - tu go nie dublujemy. */
    POL.forEach(c => { c.kl = new Klient(c.host, c.port, '/mqtt', cid + (c.nr > 1 ? '-' + c.nr : ''));
                            c.stan = { stan: 'laczy', opis: 'łączę z brokerem…' }; });
    /*  ILE BROKEROW NAPRAWDE MAMY - WPROST W DZIENNIKU [D-353, 2026-09-13]
        Wpis „start klienta ... -> host" jest JEDEN, niezaleznie od liczby brokerow (wyzej, przy `o.host`).
        Przez to ze screenshota nie dalo sie odczytac, czy drugi serwer w ogole powstal - a wlasnie o to
        pytanie rozbila sie diagnostyka znikajacej sadzawki: obiekt nadawal brokerem zapasowym, a z dziennika
        nie wynikalo, czy aplikacja ten broker ma. Teraz kazdy broker ma wlasna linie z numerem, adresem i kontem.
        ⚠ HASLA TU NIE MA I BYC NIE MOZE - dziennik ogląda sie na ekranie i wysyla na zrzutach. */
    zapisz('brokerow na liscie: ' + POL.length);
    POL.forEach(c => zapisz('  serwer ' + c.nr + ': ' + c.host + ':' + c.port + ' jako ' + (c.user || '(bez konta)')));
    const k = POL[0].kl;                    /* pierwszy broker = główny; skrót dla czytelności niżej */
    /*  KTÓRY KLIENT OBSŁUGUJE DANY OBIEKT: ten, którym przyszedł jego blok. Zanim cokolwiek przyjdzie -
        pierwszy połączony. `klGot` oddaje klienta TYLKO gdy jest połączony (inaczej komenda nie ma czym pojechać). */
    const klDla = pref => { const w = pref && obiekty[pref]; return (w && w.kl) || POL.find(c => c.kl.isConnected()) || POL[0]; };
    const klGot = pref => { const c = klDla(pref); return (c && c.kl.isConnected()) ? c.kl : null; };
    /*  STAN DLA PASKA: zielony, gdy broker niosący wybrany obiekt działa; przy dwóch brokerach opis wymienia oba,
        żeby w ustawieniach było widać, który padł. */
    const brokerOgolem = () => {
      const c = klDla(wybrany);
      const ok = POL.filter(x => x.stan.stan === 'ok');
      /*  ⛔ WSZYSTKIE DROGI ODMOWILY TEGO SAMEGO KONTA = JEDEN BLAD, NIE TRZY AWARIE [D-422].
          Konta na trzech brokerach wiaze jedna nazwa [D-416], wiec skasowane albo zle wpisane
          logowanie zabiera je razem. Trzy osobne „broker odmowil" kaza szukac trzech usterek;
          prawda jest jedna i da sie ja naprawic w dziesiec sekund - trzeba tylko ja napisac.
          ⚠ To NIE jest to samo, co „zaden broker nie odpowiada" (brak zasiegu): tam ponawianie
            ma sens, tutaj konta nie przybedzie samo, wiec aplikacja prosi czlowieka, a nie czeka. */
      if (!ok.length && POL.length && POL.every(x => x.odmowaKonta)) {
        return { stan: 'blad', opis: 'żaden serwer nie zna konta „' + (o.user || '') + '" - '
                 + 'to nie awaria łącza, tylko logowanie. Otwórz „Zmień sterownik / hasło" '
                 + 'i wpisz konto jeszcze raz' };
      }
      if (POL.length === 1) return POL[0].stan;
      if (c && c.stan.stan === 'ok') return { stan: 'ok', opis: POL.map(x => 'serwer ' + x.nr + ': ' + x.stan.opis).join(' · ') };
      if (ok.length) return { stan: 'ok', opis: POL.map(x => 'serwer ' + x.nr + ': ' + x.stan.opis).join(' · ') };
      const zly = POL.find(x => x.stan.stan !== 'laczy') || POL[0];
      return { stan: zly.stan.stan, opis: POL.map(x => 'serwer ' + x.nr + ': ' + x.stan.opis).join(' · ') };
    };
    /*  `nowe` [D-280]: prawda tylko, gdy oddaj() woła świeża paczka (zm/blok) albo zmiana obiektu.
        Cykliczne oddaj() co 1 s liczy wiek i stan brokera, ale ekran NIE dostaje wtedy świata -
        stare lustro potwierdzało żądanie kafla (bylo=null) i światło mignęło „zgaszone". */
    const oddaj = (nowe) => {
      const w = wybrany && obiekty[wybrany];
      if (!w || !w.txt) { podaj(Object.assign({ polaczony: false, swiat: null, wiek_s: null }, wspolne())); return; }
      const mb = w.mb || parsujLinie(w.txt, 'MB;'), mn = w.mn || parsujLinie(w.txt, 'MN;');
      M.ost.rej = w.r || {};                 /* rejestry z lustra - harmonogram, wyłączniki, sieć, pilot */
      const wiek = (Date.now() - w.kiedy) / 1000;
      const ob = mb ? obiegZBloku(mb) : 0;
      M.ost.mb = mb; M.ost.mn = mn; M.obieg = ob;
      const swiat = mb ? M.swiatZ(mb, mn, M.ost.rej, ob) : null;
      if (swiat && zdarzenia[wybrany]) swiat.zdarzenia = zdarzenia[wybrany];   /* dziennik zdarzeń do ekranu serwisu [D-295] */
      /* zasiew = liczby z retained bloku (0-60 s stare): ekran je pokazuje pod zasłoną „pobieram stan…", nie pod ciemną planszą [D-281] */
      podaj(Object.assign({ polaczony: !!swiat && wiek < 3 * (o.okres_s || 30) && brokerOgolem().stan === 'ok', swiat, wiek_s: wiek, nowe: !!nowe, zasiew: !!(w && w.zasiew) }, wspolne()));
    };
    /*  OBECNOŚĆ: sterownik nadaje tylko, gdy ktoś patrzy — mówimy mu co 20 s,
        w jakim tempie (ms); po zamknięciu karty milczy sam po 60 s. Przy
        zamykaniu strony wysyłamy 0 = „przestaję patrzeć", żeby nie czekał. */
    const tempo = o.tempo_ms || 1000;
    /*  KTÓRĄ DROGĄ CIĘŻKIE TEMATY [D-321, Tomasz: „to robi aplikacja - pełna zgoda"]: sterownik nadawał
        każdą paczkę na oba brokery, więc jego łącze i limity brokerów płaciły dwa razy. Kto niesie
        obiekt, wie tylko aplikacja - z tego, którym połączeniem paczki naprawdę przychodzą (`w.kl`).
        Mówimy to przy każdym odnowieniu żądania: `1000;niesie=1`. Zero = „nadawaj równolegle" i tak samo
        rozumie to starszy sterownik, który tego dopisku w ogóle nie zna (czyta samą liczbę). */
    /*  ⛔ NUMER MUSI BYC Z JEZYKA STEROWNIKA, NIE Z NASZEGO [D-411, zmierzone 17.09 sonda
        `_sonda_pwa_spis`]. Aplikacja numeruje polaczenia po swojemu (1 = pierwsze na liscie), a sterownik
        czyta `niesie=N` jako SWOJ slot N. W wariancie A te numery sie rozjechaly: nasz broker jest
        u sterownika slotem 2, wiec „niesie=1" kierowalo ciezkie tematy na brokera, ktorego aplikacja
        w ogole nie sluchala. Objaw: obraz zywy, ale rwacy sie co kilka sekund - aplikacja po 8 s ciszy
        prosila „nadawaj równolegle", dostawala dane, znowu wskazywala „serwer 1" i tak w kolko.
        Teraz kazde polaczenie wie, ktorym slotem sterownika jest (`c.slot` z tematu `serwery`,
        pole `ja` - przychodzi TA SAMA droga, ktorej dotyczy, wiec nazwy adresow nie musza pasowac).
        ⚠ STEROWNIK BEZ TEGO POLA (starszy flash) daje `slot` pusty - wtedy 0, czyli „nadawaj
        równolegle". Podwojny ruch zamiast rwacego obrazu; naprawia sie samo po flashu firmware. */
    const niesieNr = () => {
      if (POL.length < 2) return 0;
      const w = wybrany && obiekty[wybrany];
      const c = w && w.kl;
      if (!(c && c.kl && c.kl.isConnected() && c.stan.stan === 'ok')) return 0;
      const nr = c.slot || 0;
      if (!nr) return 0;
      /*  ⛔ NIE PROSIMY O DROGE, NA KTOREJ STEROWNIKA NIE MA [D-428]. Zastany `status` z brokera,
          z ktorego sterownik juz odszedl, potrafi zapisac te droge jako „niosaca". Wtedy prosimy
          o ciezkie tematy WLASNIE TAM, sterownik przestaje nadawac gdziekolwiek indziej i nie
          wysyla nic (bo go tam nie ma), a skoro nic nie przychodzi - aplikacja nie ma jak zmienic
          zdania. Pat podtrzymywal sie sam: „sterownik online", zaslona „pobieram stan" bez konca
          i w dzienniku w kolko ta sama prosba.
          ⚠ Sprawdzamy to POLEM `pol` ze spisu [D-425] - wczesniej aplikacja nie miala tego czym
            stwierdzic. Gdy `pol` nie ma (starsze firmware), nie zgadujemy: prosimy wszystkimi. */
      const sp = M.ostSpisSerwerow;
      const w2 = sp && (nr === 1 ? sp.glowny : nr === 2 ? sp.zapas1 : null);
      if (!w2 || w2.pol !== 1) return 0;
      return nr;
    };
    let niesieOst = -1;
    const oglos = (v, niesie, sonda) => { if (!wybrany) return;   /* sonda = true: wymuszona sonda `;cap=` [R2] */
      let tresc = String(v);
      if (typeof v === 'number') {                     /* dopisek tylko przy tempie, nie przy „pelny"/„okres:" */
        const nr = (niesie === undefined) ? niesieNr() : niesie;
        /*  ⛔ PROSBA `niesie=N` JEST OBIETNICA, ZE NA TEJ DRODZE SLUCHAMY  [D-424, trop Tomasza]
            Aplikacja odpina ciezkie tematy od drogi nadmiarowej [D-315]. Gdy obiekt pozniej „przejdzie"
            na te wlasnie droge, prosilismy sterownik, zeby nadawal ciezkie WLASNIE TAM - a tam
            mielismy je odpiete. Sterownik slucha i przestaje wysylac gdziekolwiek indziej, wiec
            nikt nie dostaje ani bloku, ani zmian. `status` i `stan` sa lekkie i ida dalej, wiec
            wszystko wyglada zdrowo - tylko ekran stoi na „pobieram stan…". */
        if (nr) { const cel = POL.find(x => (x.slot || 0) === nr);
                  if (cel && cel.lekki) { wepnijCiezkie(cel); cel.bliz = 0; } }
        tresc += ';niesie=' + nr;
        tresc = rpcSondaDo(wybrany, tresc, sonda);   /* [Sol S20] sonda możliwości rid - w zwykłym odnowieniu, nic nie włącza */
        if (nr !== niesieOst) { niesieOst = nr;
          /*  ⚠ SKUTEK, NIE MECHANIZM [D-428a, Tomasz: „zamiast «prosze o ciezkie tematy» to
              «odbieram tematy»"]. Pod spodem to nadal dopisek `niesie=N` w `zadanie`, ktory kaze
              sterownikowi kierowac tam `zm` i `blok` - ale czytajacy dziennik chce wiedziec, ktora
              droga PLYNA DANE, a nie jak sie o to prosi. */
          zapisz(nr ? 'odbieram dane przez ' + NAZWA_DROGI(nr) : 'odbieram dane równolegle'); }
      }
      /*  ŻĄDANIE IDZIE WSZYSTKIMI DROGAMI [D-327, uwaga z audytu]: dotąd szło tylko tą, którą uważamy
          za niosącą. Gdy sterownik straci WŁAŚNIE tego brokera, prośba leci w próżnię, a sterownik
          dowie się o stracie dopiero po swoim keepalive - i przez ten czas nie wie, że ma wrócić do
          nadawania równoległego. Powtórkę tej samej treści sterownik odsiewa w oknie 3 s [D-319], więc to
          nic nie kosztuje poza kilkudziesięcioma bajtami. */
      let poszlo = 0;
      POL.forEach(c => { if (!c.kl.isConnected()) return;
        try { const m = new Paho.Message(tresc); m.destinationName = wybrany + '/zadanie'; c.kl.send(m); poszlo++; } catch (e) {} });
      if (!poszlo) return;
      ost.zadanie = Date.now(); if (v === 'pelny') zapisz('żądanie pełnego bloku'); };
    setInterval(() => oglos(tempo), 20000);
    /* `zadanie`=0 przy pagehide ZDJĘTE [D-287]: jeden schodzący do tła podglądacz gasił strumień pozostałym; sterownik gaśnie sam 60 s po ostatnim odnowieniu */
    /*  WZNOWIENIE PODGLĄDU BEZ CZEKANIA [2026-09-09, Tomasz: „jak nie dostanie pakietu na czas,
        to brak połączenia"]. Telefon w tle dławi zegary JS: `zadanie` nie odnawia się, sterownik
        po 60 s milknie, a po powrocie aplikacji najbliższe odnowienie było dopiero za ≤ 20 s -
        tyle trwało „nie nadaje". Teraz: powrót karty na ekran = `zadanie` od razu; a gdy
        broker jest, a blok wybranego obiektu spóźnia się > 4 s - też od razu (nie częściej
        niż co 4 s). */
    let ostOglos = 0;
    const oglosTeraz = () => { const t = Date.now(); if (t - ostOglos < 4000) return; ostOglos = t; oglos(tempo); };
    /*  SZYBKI POWRÓT PO TLE [D-279, Tomasz 2026-09-09: „po powrocie do okna jest rozłączony, ponowne
        łączenie trwa 5–10 s"]. Android zamyka gniazdo w tle; Paho po zerwaniu odczekuje odstęp, który
        po każdej nieudanej próbie w tle ROŚNIE (1→2→4… s), więc po powrocie czekało się na jego zegar.
        Teraz: powrót na ekran = jeśli nie połączony, connect() natychmiast (Paho odrzuci, gdy właśnie
        łączy — łapiemy), a do pierwszej paczki zasłona „łączę ponownie…" zamiast starych liczb bez
        słowa. Utrzymania połączenia w tle przeglądarka nie da - to granica PWA, nie nasza. */
    document.addEventListener('visibilitychange', () => {
      const widoczna = document.visibilityState === 'visible';
      zapisz(widoczna ? 'powrót na ekran' : 'w tle');
      if (!widoczna) return;
      czekamPoPowrocie = true; oddaj();
      const doZrobienia = POL.filter(c => !c.kl.isConnected());
      if (doZrobienia.length) { doZrobienia.forEach(c => {
        /* [D-354] czlowiek wrocil i czeka - jesli poprzednie proby padly, nie reanimujemy, tylko budujemy od zera */
        if (c.stan.stan === 'blad' || c.byloZerwane) odnowKlienta(c);
        c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.odstepNr = 0; c.polaczTeraz('powrót na ekran'); }); oddaj(); }
      /*  ⚠ POŁĄCZENIE, KTÓRE TWIERDZI, ŻE ŻYJE, A MILCZY — NIE CZEKAJ NA GUARDA [D-409,
          Tomasz 17.09: „wraca po zmianie okna już dłużej niż się uruchomił"].
          Powyższa pętla naprawia tylko te drogi, które SAME przyznają się, że padły. Gniazdo
          zamrożone razem z kartą nadal zgłasza gotowość, więc trafiało pod guarda ciszy —
          a ten czeka 75 s. Efekt był absurdalny: powrót na ekran trwał dłużej niż uruchomienie
          aplikacji od zera (~3 s), bo świeży start buduje klienta od razu.
          75 s zostaje dla PRACY W TLE (nie dobijamy brokera, gdy nikt nie patrzy), ale gdy człowiek
          wrócił i patrzy — 8 s ciszy wystarczy za dowód. Sterownik nadaje co 5 s, więc ośmiu sekund
          nie da się pomylić z normalną pracą. */
      const TERAZ = Date.now();
      POL.filter(c => c.kl.isConnected() && c.ostOdbior && (TERAZ - c.ostOdbior) > 8000).forEach(c => {
        zapisz(etyk(c) + 'powrót na ekran, a cisza ' + Math.round((TERAZ - c.ostOdbior) / 1000)
               + ' s mimo „połączony" - buduję klienta od nowa, zamiast czekać na strażnika');
        odnowKlienta(c);
        c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.odstepNr = 0; c.polaczTeraz('powrót - martwe gniazdo');
      });
      oddaj();
      if (POL.some(c => c.kl.isConnected())) oglosTeraz();
    });
    window.addEventListener('focus', oglosTeraz);
    /*  ⚠ W DZIENNIKU Z TELEFONU NIE BYŁO WPISU „w tle" [D-310], choć karta stała 7 min w tle: Chrome na Androidzie
        potrafi ZAMROZIĆ kartę (freeze) bez zdarzenia `visibilitychange` - wtedy nie wykona się żaden nasz kod.
        Te trzy zdarzenia zostawiają ślad, kiedy karta zasnęła i kiedy wstała; `resume` dodatkowo łączy od ręki,
        bo po zamrożeniu `visibilitychange` bywa nie do zobaczenia. */
    window.addEventListener('pagehide', () => zapisz('karta schowana (pagehide)'));
    document.addEventListener('freeze', () => zapisz('karta zamrożona przez przeglądarkę'));
    /*  ZERWANIE DROGI = OD RAZU „OBA" [D-321]: gdy padnie połączenie, którym obiekt do nas dociera,
        nie ma na co czekać - prosimy pozostałym, żeby sterownik wrócił do nadawania na oba serwery. */
    M.niesieReset = () => { if (niesieOst !== 0 && POL.some(c => c.kl.isConnected())) oglos(tempo, 0); };
    /*  PRÓBA BRZEGOWA [D-322]: sonda musi umieć zerwać JEDNĄ drogę, żeby zmierzyć, po ilu sekundach
        obraz wraca drugą. Zamykamy gniazdo dokładnie tak, jak robi to sieć - reszta dzieje się sama
        (Paho zgłasza zerwanie, aplikacja prosi sterownik o nadawanie równoległe). Nie wystawiamy tu kont ani
        haseł - tylko tę jedną czynność. */
    M._zerwij = nr => { const c = POL.find(x => x.nr === nr); if (!c || !c.gniazdo) return false;
      try { c.gniazdo.close(); zapisz('próba brzegowa: zerwano serwer ' + nr); return true; } catch (e) { return false; } };
    document.addEventListener('resume', () => { zapisz('karta odmrożona'); czekamPoPowrocie = true;
      POL.filter(c => !c.kl.isConnected()).forEach(c => {
        odnowKlienta(c);   /* [D-354] karta byla zamrozona - gniazdo i sesja u brokera sa nie do odzyskania */
        c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.odstepNr = 0; c.polaczTeraz('odmrożenie'); }); oddaj(); });
    setInterval(() => { const w = wybrany && obiekty[wybrany];
      for (const p in M.dwaSterowniki) dwaWygas(p, Date.now());   /* [runda 3, Ś3] flaga „dwa sterowniki” gaśnie po ciszy drugiego */
      /*  [D-321] PROGI CISZY PODNIESIONE: sterownik nadaje heartbeat co 5 s (było 2 s), więc cztery
          sekundy bez paczki to teraz normalna praca, a nie kłopot. Dopytujemy po 10 s. */
      if (brokerOgolem().stan === 'ok' && w && w.kiedy && Date.now() - w.kiedy > 7000) oglosTeraz();
      /*  [D-315] cisza u niosącego (6 s) albo jego zerwanie = wpinamy ciężkie tematy z powrotem WSZĘDZIE.
          Lepiej przez chwilę odebrać dwa razy, niż nie odebrać wcale. */
      /*  [D-332] PROG CISZY 12 s -> 8 s. Przy awarii drogi to WLASNIE ten prog wyznacza dziure
          w obrazie, bo aplikacja prosi „nadawaj równolegle" szybciej, niz sterownik zdazy zauwazyc awarie
          (zmierzone: obraz wracal po 14,8-20,2 s, a sterownik wiedzial dopiero po 22,1 s). Heartbeat
          idzie co 5 s, wiec 8 s to poltora heartbeatu - falszywa prosba kosztuje chwile podwojnego
          odbioru i nic wiecej. */
      const cisza = !w || !w.kiedy || Date.now() - w.kiedy > 8000;
      if (POL.length > 1 && (cisza || POL.some(c => c.lekki && c.stan.stan !== 'ok'))) {
        POL.forEach(c => { c.bliz = 0; wepnijCiezkie(c); });
        /*  [D-321] i mówimy o tym STEROWNIKOWI od ręki: niech znowu nadaje równolegle. Bez tego czekałby
            na najbliższe odnowienie żądania, czyli do 20 s ciszy na ekranie. */
        if (niesieOst !== 0) oglos(tempo, 0);
      }
      /*  LUKA BEZ PEŁNEGO BLOKU = ZASŁONA [D-318, audyt etapu 3 pkt 3]: po dziurze w numeracji
          w lustrze brakuje zgubionych zmian, a następne paczki lecą dalej - ekran wyglądał więc
          na świeży, choć część liczb pochodziła sprzed dziury. Pełny blok przychodzi zwykle w pół
          sekundy, dlatego zasłaniamy dopiero po dwóch (bez migania przy jednej zgubionej paczce)
          i prosimy jeszcze raz. Zasłonę zdejmuje dopiero świeży pełny blok. */
      if (w && w.luka && w.lukaOd && Date.now() - w.lukaOd > 2000) {
        w.zasiew = true; w.lukaOd = Date.now();
        zapisz('luka bez pełnego bloku - zasłaniam ekran i proszę jeszcze raz');
        if (wybrany) prosPelny('zasłona');
        oddaj();
      }
    }, 1000);
    k.onMessageArrived = m => {
      const cz = m.destinationName.split('/');
      const rodzaj = cz[cz.length - 1];
      /*  [D-511] HISTORIA = BAJTY, NIE TEKST: tylko `payloadBytes` - `payloadString` na binarnych blokach dałby śmieci
          (a w oryginalnym Paho wyjątek „Malformed UTF”). Musi stać PRZED każdą gałęzią, która czyta tekst. */
      if (rodzaj === 'historia') { hiOdebrano(cz.slice(0, -1).join('/'), m.payloadBytes); return; }
      if (rodzaj === 'stan') {
        let s = null; try { s = JSON.parse(m.payloadString); } catch (e) {}
        const prefS = cz.slice(0, -1).join('/');
        if (s && !stanNowszy(prefS, s, m.retained)) return;         /* [Sol S21] spóźniona kopia snapshotu - bez skutku */
        { /* [Sol S20] echo sondy rid: tylko żywy stan, ten prefiks, ta sonda w terminie, z boot; inny boot kasuje */
          /* [sceptyk C, W1 - 02.10.2026] BRAK `boot` TEŻ KASUJE: sterownik wrócił na STARY firmware (OTA wstecz, rollback
             bootloadera, wymiana płyty) - jego `stan` nie ma pola boot. Dawny warunek kasował tylko przy INNYM boot, więc
             aplikacja dokładała `;rid=` godzinami: stary sterownik odrzuca `pliki:<kat>;rid=…` (_sd_kat_ok), a odpowiedzi
             `okres`/`plik` bez rid nie przechodzą ridPasuje - ekran „brak karty” / „nie odesłał w 10 s” bez prawdziwego
             powodu (próba sceptyka A1, test S20.M7). Każdy snapshot nie z TEGO boot = korelację potwierdzamy od nowa. */
          const c = rpcCap[prefS];
          if (s && c && c.stan === 'jest' && s.boot !== c.boot) {
            delete rpcCap[prefS];
            zapisz(typeof s.boot === 'string' ? 'sterownik uruchomiony na nowo - korelację odpowiedzi karty (rid) potwierdzę od nowa'
                                              : 'sterownik bez znacznika uruchomienia (stary firmware?) - odczyty karty w trybie dawnym, bez rid');
          } else if (s && c && c.stan === 'sonda' && !m.retained && typeof s.boot === 'string' && s.cap && Array.isArray(s.cap.n)
                     && s.cap.n.indexOf(c.nonce) >= 0 && Date.now() - c.od < RPC_SONDA_WAZNA_MS) {
            c.stan = 'jest'; c.boot = s.boot; zapisz('sterownik zna identyfikator odpowiedzi karty (rid) - odczyty karty z korelacją');
          }
        }
        /* [sceptyk C runda 3, S21.R3w] ZEGAR KOMEND TYLKO Z URUCHOMIENIA LUSTRA: snapshot z NIŻSZYM u niż lustro, na którym
           właśnie płyną żywe paczki (zm/blok w STAN_NOWY_BOOT_MS), jest z drugiego sterownika na prefiksie - pokazywany wrócił
           po ciszy, lustro już przy nim (wyższe u), a rewizja `stan` jeszcze przy drugim, póki pokazywany nie nada snapshotów
           przez STAN_NOWY_BOOT_MS (okno Ś1). Bez tego warunku zegar przeskakiwał na drugiego przy każdym jego snapshocie i wracał
           przy paczce pokazywanego - command w tej chwili niósł `t=` z cudzego zegara. Lustro bez żywych paczek (zasiew,
           retained, przejście na nowe uruchomienie z niższym u - S21.R2r) - zegar jak dotąd. */
        const wS = obiekty[prefS], uS = s && licznikU(s.u) ? s.u : null;
        const zInnego = uS != null && wS && licznikU(wS.u) && uS < wS.u
                        && Date.now() - ((uZyw[prefS] && uZyw[prefS][wS.u]) || 0) <= STAN_NOWY_BOOT_MS;
        if (s && s.czas && !zInnego) zegarUstaw(prefS, s.czas);     /* [B.0z-78] bez cofania */
        return;
      }
      if (rodzaj === 'serwery') { spisSerwerow(m.payloadString, cz.slice(0, -1).join('/'), m.retained); return; }   /* [D-411] */
      if (rodzaj === 'zapas') {                     /* [D-412] report sterownika o rezerwie */
        const pref = cz.slice(0, -1).join('/');
        const txt = m.payloadString || '';
        /*  ⛔ TYLKO WYBRANY OBIEKT [poprawka po przegladzie]: `czekaZapas` to JEDNA zmienna, a konto
            serwisowe oglada kilka sterownikow naraz. Bez tego warunku nocna zamiana w sadzawce
            rozwiazywalaby obietnice kliknieta na basenie i czlowiek zobaczylby cudze zdanie jako
            odpowiedz na swoj command. Ten sam blad naprawialismy w D-348 przy prosbach o okres. */
        if (pref !== wybrany) return;
        /*  ⚠ RETAINED TO REPORT ZASTANY, NIE ODPOWIEDZ NA NASZ COMMAND. Leci od razu po
            subskrypcji i potrafi byc sprzed tygodnia - gdyby liczyl sie jako odpowiedz, ekran
            pokazywalby „zrobione" zanim sterownik cokolwiek przeczytal. */
        /*  ⚠ TA SAMA TRESC DRUGA DROGA [D-315]: `zapas` jest tematem lekkim, wiec przy dwoch
            brokerach przychodzi dwa razy. Bez odsiewu dziennik lacza dostawal dwa takie same
            wpisy na jedno zdarzenie - a dziennik czyta sie na zrzucie ekranu. */
        const swiezo = M.ostZapas && M.ostZapas.txt === txt && (Date.now() - M.ostZapas.kiedy) < 3000;
        M.ostZapas = { obiekt: pref, txt, kiedy: Date.now(), zastany: !!m.retained };
        if (!m.retained && !swiezo) { zapisz('rezerwa: ' + txt); if (czekaZapas) czekaZapas(txt); }
        oddaj();
        return;
      }
      if (rodzaj === 'pliki') {                     /* lista plików z karty [D-297]: "#kat\nnazwa;rozmiar\n..." albo "!brak karty" */
        if (!czekaPliki || czekaPliki.pref !== cz.slice(0, -1).join('/')) return;   /* tylko od pytanego sterownika [2026-09-26] */
        const l = m.payloadString.split('\n').filter(x => x.trim()); const brak = l.some(x => x[0] === '!');
        /*  [PWA-6] odpowiedz o INNEJ kategorii (spozniona po zastapieniu) nie konczy biezacej prosby */
        const nag0 = (l[0] && l[0][0] === '#') ? l[0].slice(1).trim().split(';') : null;
        const katOdp = nag0 ? nag0[0] : null;
        if (katOdp !== null && katOdp !== czekaPliki.kat) return;
        if (!ridPasuje(czekaPliki, nag0 ? ridZPol(nag0.slice(1)) : null, 0)) return;   /* [Sol S20] cudza / stara / kopia */
        const c = czekaPliki; czekaPliki = null; clearTimeout(c.t);
        const pliki = l.filter(x => x[0] !== '#' && x[0] !== '!').map(x => { const [nazwa, rozmiar] = x.split(';'); return { nazwa, rozmiar: +rozmiar }; }).sort((a, b) => a.nazwa < b.nazwa ? 1 : -1);
        c.res(new Response(JSON.stringify({ karta: !brak, pliki }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        return;
      }
      if (rodzaj === 'okres') {                     /* "#kat;od;do;pomin;n;dalej\n<linie>" [D-298] */
        const nl = m.payloadString.indexOf('\n'); const nag = m.payloadString.slice(1, nl).split(';');
        /*  [D-348] kategoria z NAGLOWKA odpowiedzi wskazuje, ktora prosbe obslugujemy - dzieki temu
            odpowiedz o alarmach nie konczy prosby o zdarzenia (i odwrotnie). */
        const c = czekaOkres[nag[0]];
        if (!c) return;                             /* spozniona odpowiedz na porzucona prosbe - do kosza */
        /*  ⛔ TYLKO OD STEROWNIKA, KTOREGO PYTALISMY [2026-09-26]. Konto serwisowe slucha kilku obiektow naraz
            (TEMATY na kazdy prefiks), a kategoria z naglowka nie mowi, KTO odpowiada - odpowiedz sadzawki
            konczyla prosbe zadana warsztatowi i jej wiersze szly do tabeli warsztatu. Ten sam blad co przy
            `zapas` (tam naprawiony wczesniej warunkiem `pref !== wybrany`). */
        if (c.pref !== cz.slice(0, -1).join('/')) return;
        /*  ⛔ ODPOWIEDZ MUSI BYC NA PROSBE, KTORA JEST W DRODZE: od, do i kursor [PWA-6, Astra 02/13, 29.09]
            ------------------------------------------------------------
            WEJSCIA:  naglowek „#kat;od;do;pomin;n;dalej;nast" (sterownik odsyla pola prosby bez zmian,
                      21_karta_sd.h) i prosba w drodze `c` (od, dok, poz).
            CO Z CZEGO WYNIKA: tylko odpowiedz z tymi samymi od/do/pomin dopisuje linie, zatrzymuje licznik
                      czasu i prosi o nastepna strone. Duplikat z drugiego brokera (sterownik nadaje
                      odpowiedz na WSZYSTKIE drogi) albo spozniona strona nie zmienia NICZEGO.
            WYJSCIA:  kolejna prosba albo rozwiazana obietnica.
            ⛔ DLACZEGO: dawniej `c.nastepny()` szlo takze po odpowiedzi, ktora nie pasowala - kazdy duplikat
            dokladal prosbe o strone, ktora juz byla w drodze, i liczba prosb PODWAJALA SIE co strone.
            28.09 21:35 trzy aplikacje wyslaly po 256 = 2^8 prosb w minute, a sterownik warsztatu dwa razy
            zatrzymal supervisor rdzenia 0 (dowody/2026-09-28, paczka 02). */
        if (+nag[1] !== c.od || +nag[2] !== c.dok || +nag[3] !== c.poz) return;
        if (!ridPasuje(c, ridZPol(nag.slice(7)), c.part)) return;    /* [Sol S20] ta prośba i TA część - przed zegarem i danymi */
        clearTimeout(c.t);
        const n = +nag[4], dalej = +nag[5], nast = +nag[6] || 0;
        if (n < 0) { delete czekaOkres[c.kat]; c.res(new Response(JSON.stringify({ blad: 'brak karty' }), { status: 200 })); return; }
        c.linie = c.linie.concat(m.payloadString.slice(nl + 1).split('\n').filter(x => x.trim()));
        c.strony = (c.strony || 0) + 1;
        /*  kursor MUSI isc naprzod (ten sam = sterownik stoi w miejscu) i stron jest skonczenie wiele -
            bezpiecznik na wypadek bledu po drugiej stronie; ucieta odpowiedz mowi o tym wprost */
        if (dalej && nast && nast !== c.poz && c.strony < OKRES_MAX_STRON) { c.poz = nast; c.part++; c.nastepny(); return; }   /* [Sol S20] część przesunięta PRZED prośbą */
        if (dalej && nast) zapisz('okres ' + c.kat + ': zatrzymane po ' + c.strony + ' stronach (kursor ' + nast + ')');
        delete czekaOkres[c.kat];
        c.res(new Response(JSON.stringify({ kat: c.kat, od: c.od, do: c.dok, linie: c.linie }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        return;
      }
      if (rodzaj === 'plik') {                      /* kawałek pliku: "#kat/nazwa;rozmiar;od;n\n<linie>" */
        if (!czekaPlik || czekaPlik.pref !== cz.slice(0, -1).join('/')) return;   /* tylko od pytanego sterownika [2026-09-26] */
        const c = czekaPlik;
        const nl = m.payloadString.indexOf('\n'); const nag = m.payloadString.slice(1, nl).split(';');
        const rozmiar = +nag[1], od = +nag[2], n = +nag[3]; const dane = m.payloadString.slice(nl + 1);
        /*  [PWA-6, Astra 13] kawalek MUSI byc tego pliku (kat/nazwa z naglowka) i z tego miejsca (offset) -
            sprawdzone PRZED licznikiem czasu i buforem. Odpowiedz A.csv nie konczy pobierania B.csv, a duplikat
            z drugiego brokera nie prosi drugi raz o ten sam kawalek (ta sama petla co przy `okres`). */
        if (nag[0] !== c.kat + '/' + c.nazwa || od !== c.od) return;
        if (!ridPasuje(c, ridZPol(nag.slice(4)), c.part)) return;    /* [Sol S20] */
        clearTimeout(c.t);
        if (n < 0) { czekaPlik = null; c.res(new Response(JSON.stringify({ blad: 'brak pliku albo karty' }), { status: 200 })); return; }
        c.tekst += dane; c.od = od + n;
        if (n > 0 && c.od < rozmiar) { c.part++; c.nastepny(); return; }   /* [Sol S20] następna część */
        czekaPlik = null;
        if (c.json) c.res(new Response(JSON.stringify({ kat: c.kat, nazwa: c.nazwa, linie: c.tekst.split('\n').filter(x => x.trim()) }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        else c.res(new Response(c.tekst, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } }));
        return;
      }
      if (rodzaj === 'zdarzenia' || rodzaj === 'zd') {
        /*  DZIENNIK ZDARZEŃ [D-295]: `zdarzenia` = cały (na prośbę), `zd` = nowe wpisy na żywo; linie
            „czas,kat,kod,zrodlo,obieg,a,b,c" od najnowszego. Trzymamy do 200 na obiekt. */
        const pref = cz.slice(0, -1).join('/'); const z = zdarzenia[pref] || (zdarzenia[pref] = { ile: 0, zgubione: 0, wpisy: [] });
        const nowe = m.payloadString.split('\n').filter(l => l.trim()).map(l => l.split(',').map(Number)).filter(x => x.length === 8);
        if (rodzaj === 'zdarzenia') z.wpisy = nowe; else z.wpisy = nowe.concat(z.wpisy).slice(0, 200);
        z.ile = Math.max(z.ile, z.wpisy.length); z.kiedy = Date.now();
        if (pref === wybrany) oddaj(true);
        return;
      }
      if (rodzaj === 'nazwy') {                                       /* [D-493] */
        const pref = cz.slice(0, -1).join('/'); const r = {};
        for (const l of m.payloadString.split('\n')) {
          const i = l.indexOf(';'); if (i < 0) continue;
          const k = parseInt(l.slice(0, i), 10); if (!(k >= 0 && k < 16)) continue;
          nazwaNaSlowa(l.slice(i + 1)).forEach((s, j) => { r[AKC_NAZWY_REJ + k * AKC_NAZWA_SLOW + j] = s; });
        }
        nazwyR[pref] = r;
        const w = obiekty[pref]; if (w && w.r) Object.assign(w.r, r);
        if (pref === wybrany) oddaj(true);
        return;
      }
      if (rodzaj === 'wynik') {
        /*  [PWA-7, Astra 13] WYNIK = PARA {sterownik, id}, TYLKO SWIEZY.
            - retained to wynik zastany (sprzed subskrypcji) - nigdy odpowiedz na biezaca komende;
            - ten sam numer id od INNEGO sterownika (konto serwisowe slucha kilku) nie jest nasz;
            - wynik bez id (starsze firmware) konczy komende tylko od sterownika, ktorego pytalismy. */
        if (m.retained) return;
        const prefW = cz.slice(0, -1).join('/');
        let w = {}; try { w = JSON.parse(m.payloadString); } catch (e) { w = { kod: 1, opis: m.payloadString }; }
        const r = { ok: w.kod === 0, kod: w.kod, opis: w.opis || (w.kod === 0 ? 'wykonano' : 'odmowa') };
        if (w.id != null) {
          const p = oczekuja.get(w.id);
          if (!p || p.pref !== prefW) {                    /* cudza komenda, inny sterownik albo powtórka wyniku (dwie drogi) */
            const z = pozne.get(w.id);                     /* [Sol S23] spóźniony wynik commandu, który dostał „wynik nieznany” */
            if (z && z.pref === prefW) { pozne.delete(w.id);
              zapisz('spóźniony wynik ' + z.co + ' po ' + (Date.now() - z.t0) + ' ms: ' + (w.kod === 0 ? 'wykonano' : 'odmowa kod ' + w.kod + (w.opis ? ' (' + w.opis + ')' : '')));
              oddaj(); }
            return;
          }
          oczekuja.delete(w.id); if (czekaWynik === p.res) czekaWynik = null;
          const ms = Date.now() - p.t0; M.pomiar.wynik_ms = ms; M.pomiar.ile++;
          zapisz('wynik ' + p.co + ': ' + ms + ' ms' + (w.kod ? ' kod ' + w.kod : ''));
          p.res(r); return;
        }
        if (czekaWynik && czekaWynikPref === prefW) { const f = czekaWynik; czekaWynik = null; f(r); }
        return;
      }
      if (rodzaj === 'zm') {
        const pref = cz.slice(0, -1).join('/');
        const w = obiekty[pref]; if (!w || !w.mb) return;          /* bez pełnego bloku nie ma na co nakładać */
        let d = null; try { d = JSON.parse(m.payloadString); } catch (e) { return; }
        if (!d) return;
        /*  NUMER URUCHOMIENIA `u` [D-481, audyt Astry 20.09 „spójność po restarcie" P1]. Sterownik dokłada
            do każdej paczki licznik restartów (ten sam, co w `awaria`), a do bloku trzecie pole linii Z;.
            Dotąd restart zgadywaliśmy ze skoku numeru o ≥1000 — i myliło się w OBIE strony: mały prawdziwy
            skok wstecz po restarcie (250 → 1) odrzucany jako „spóźniona kopia" (aplikacja trzymała stare 28 °C,
            choć sterownik nadawał 31), a duży fałszywy (stary retained z zapasu) przyjmowany jako restart.
              • u < nasze  → paczka ze STAREGO uruchomienia (spóźniona, z drugiej drogi) — pomijamy;
              • u > nasze  → NOWE uruchomienie: lustro jest z poprzedniego życia, więc prosimy o pełny blok
                             i do jego przyjścia trzymamy zasłonę (luka); nowe wartości NAKŁADAMY — są
                             prawdziwsze niż to, co mamy;
              • u == nasze → zwykła numeracja niżej; spóźniona kopia = KAŻDY numer nie nowszy (bez progu 1000).
            Bez `u` (stary release sterownika) zostaje dawna heurystyka skoku 1000. */
        /*  [Sol S21] PACZKA Z NUMEREM URUCHOMIENIA MUSI MIEĆ KOMPLET: u w zakresie licznika (uint16 z NVS) i seq.
            Dawniej `zm` z u, ale bez seq ustawiało nowe u i zerowało seq lustra - potem spóźniony pełny blok
            starego uruchomienia przechodził bramkę bloku (patrzyła na u tylko przy znanym seq). */
        if (typeof d.u === 'number' && (!licznikU(d.u) || !Number.isInteger(d.seq))) {
          zapisz('paczka zmian z niepełnym numerem (u ' + d.u + ', seq ' + d.seq + ') - pomijam'); return;
        }
        if (typeof d.u === 'number') {
          if (!m.retained) odnotujU(pref, d.u);   /* [R3] znak życia uruchomienia z tym u - także przed odrzuceniem niżej */
          /* [sceptyk C runda 2, R3] drugi sterownik na tym prefiksie (stanNowszy): jego paczki pomijamy bez wpisu - linia
             „dwa sterowniki" już jest, a 60 linii dziennika zalałby co sekundę; lustro nie przeskakuje na jego u */
          { const rr = stanRew[pref]; if (rr && rr.dwa && rr.dwa.u === d.u && d.u !== w.u) return; }
          if (w.u != null && d.u < w.u) { zapisz('paczka z poprzedniego uruchomienia sterownika (u ' + d.u + ' < ' + w.u + ') - pomijam'); return; }
          if (w.u == null || d.u > w.u) {
            zapisz(w.u == null ? 'pierwsza paczka z numerem uruchomienia u ' + d.u + ' - proszę o pełny blok'
                               : 'sterownik uruchomiony na nowo (u ' + w.u + ' → ' + d.u + ') - proszę o pełny blok');
            w.u = d.u; w.seq = null; w.luka = true; w.lukaOd = Date.now();
            if (pref === wybrany) prosPelny('nowe uruchomienie');
          }
          /* [R1] u lustra przyszło z brokera przed chwilą (paczka z u lustra) */
          w.uBrok = { u: w.u, t: Date.now() };
        }
        if (typeof d.seq === 'number') {
          /*  TA SAMA PACZKA DRUGĄ DROGĄ [D-313]: przy dwóch brokerach (i przy powtórce QoS 1) ten sam `seq`
              potrafi przyjść dwa razy. Bez tego wyglądało to jak dziura w numeracji i aplikacja prosiła o pełny
              blok w kółko. Powtórkę po prostu pomijamy - lustro już ją ma. */
          /*  SPÓŹNIONA KOPIA TO TEŻ NIE LUKA [D-316]: przy dwóch brokerach ta sama paczka bywa dostarczona
              w innej kolejności (zmierzone: „luka seq 6213→6212"), a starą już mamy nałożoną. Odsiewamy każdy
              numer NIE NOWSZY od naszego - ale tylko gdy różnica jest mała; duży skok w dół to restart
              sterownika albo przewinięcie licznika i wtedy naprawdę trzeba poprosić o pełny blok. */
          if (w.seq != null && d.seq < w.seq && (typeof d.u === 'number' || w.seq - d.seq < SEQ_SKOK_RESTART)) return;   /* z `u` każdy numer nie nowszy = kopia [D-481] */
          if (w.seq === d.seq) {
            /*  DOWÓD, ŻE TEN BROKER JEST NADMIAROWY [D-315]: przyniósł paczkę, którą już mamy. Po pięciu takich
                z rzędu odpinamy od niego ciężkie tematy - ale tylko wtedy, gdy NIE jest tym, który niesie obiekt. */
            if (_zrodlo !== w.kl && ++_zrodlo.bliz >= 5) odepnijCiezkie(_zrodlo);
            return;
          }
          _zrodlo.bliz = 0;
          if (w.seq != null && d.seq !== w.seq + 1) { w.luka = true; w.lukaOd = Date.now(); if (pref === wybrany) { zapisz('luka seq ' + w.seq + '→' + d.seq); prosPelny('luka'); } }   /* luka → pełny blok od ręki; do niego lustro = zasiew [chwila luki: D-318] */
          w.seq = d.seq;
        }
        if (d.t) zegarUstaw(pref, d.t);   /* [B.0z-78] */
        if (d.mb) for (const k in d.mb) w.mb[+k] = d.mb[k];
        if (d.mn) { if (!w.mn) w.mn = []; for (const k in d.mn) w.mn[+k] = d.mn[k]; }
        if (d.r)  { if (!w.r) w.r = {};  for (const k in d.r)  w.r[+k]  = d.r[k]; }
        w.kiedy = Date.now(); w.kl = _zrodlo;   /* [D-314] paczki zmian też mówią, którym brokerem obiekt nadaje TERAZ */
        if (!w.luka) w.zasiew = false; if (pref === wybrany) { ost.zm = w.kiedy; czekamPoPowrocie = false; if (d.mn || d.r || d.mb) odnotujZmiane(); }
        if (pref === wybrany) oddaj(true);
        return;
      }
      if (rodzaj !== 'blok') return;
      const pref = cz.slice(0, -1).join('/');
      /*  SPÓŹNIONY PEŁNY BLOK TO TEŻ NIE PRAWDA [D-338]. `zm` odsiewa spóźnione kopie od D-316,
          a `blok` nie odsiewał nic — a bierze numer z tego samego licznika. Blok o numerze niższym
          niż nasze lustro wołał `zastosujPelny`, które cofało `w.seq` i podmieniało mb/mn/r STARSZĄ
          snapshotem: świeżo zapalone światło gasło na telefonie, a następna zmiana wyglądała jak luka
          i wymuszała kolejną prośbę o pełny blok. Przy dwóch brokerach blok i zmiana idą równolegle dwiema
          drogami i potrafią się wyminąć w drodze, więc sam porządek po stronie sterownika nie wystarcza.
          Duży skok w dół zostaje przyjęty — to restart sterownika albo przewinięcie licznika. */
      {
        const zS = parsujLinie(m.payloadString, 'Z;');
        const w0 = obiekty[pref];
        const wS = w0 && w0.seq, wU = w0 && w0.u;
        const zU = (zS && zS.length > 2 && zS[2] != null) ? zS[2] : null;
        /*  [Sol S21, łatka 1] STARSZE URUCHOMIENIE = STARY BLOK także wtedy, gdy lustro czeka na pełny obraz (seq null po
            nowym u): bramka niżej patrzyła na u tylko przy znanym seq. Odrzucony blok nie zmienia lustra, zegara, drogi
            (`kl`) ani zasłony. */
        if (licznikU(zU) && !m.retained) odnotujU(pref, zU);   /* [R3] znak życia uruchomienia z tym u */
        { const rr = stanRew[pref]; if (rr && rr.dwa && rr.dwa.u === zU && zU !== wU) return; }   /* [R3] drugi sterownik - bez wpisu */
        if (licznikU(zU) && licznikU(wU) && zU < wU) {
          zapisz('pełny blok z poprzedniego uruchomienia sterownika (u ' + zU + ' < ' + wU + ') - pomijam');
          return;
        }
        if (zS && zS.length && wS != null) {
          if (zU != null && wU != null) {
            /*  [D-481] Z NUMEREM URUCHOMIENIA NIE MA ZGADYWANIA: starsze uruchomienie = stary blok
                (skądkolwiek przyszedł), to samo uruchomienie i niższy numer = spóźniona kopia. */
            if (zU < wU) { zapisz('pełny blok z poprzedniego uruchomienia sterownika (u ' + zU + ' < ' + wU + ') - pomijam'); return; }
            if (zU === wU && zS[0] < wS) { zapisz('spóźniony pełny blok seq ' + zS[0] + ' < ' + wS + ' (to samo uruchomienie) - pomijam, lustro nowsze'); return; }
          } else if (zS[0] < wS && wS - zS[0] < SEQ_SKOK_RESTART) {
            zapisz('spóźniony pełny blok seq ' + zS[0] + ' < ' + wS + ' - pomijam, lustro nowsze');
            return;
          }
        }
        /*  ZASTANY BLOK NIE ZASTĘPUJE ŻYWEGO LUSTRA [D-481, Astra „spójność" P1 przypadek 2]. Retained
            z brokera (np. z zapasu, na którym leży komplet sprzed godzin) wolno przyjąć, gdy nie mamy
            jeszcze żywego lustra (zasiew) ALBO gdy jest naprawdę nowszy: to samo uruchomienie i wyższy
            numer, albo nowsze uruchomienie. Dotąd duży skok w dół uchodził za restart i stary blok
            z zapasu nadpisywał świeży obraz z drogi głównej (30 °C → 21 °C, bez restartu sterownika). */
        if (m.retained && w0 && w0.mb && !w0.zasiew && wS != null && zS && zS.length) {
          const nowszy = (zU != null && wU != null) ? (zU > wU || (zU === wU && zS[0] > wS)) : (zS[0] > wS);
          if (!nowszy) { zapisz('zastany blok (seq ' + zS[0] + (zU != null ? ', u ' + zU : '') + ') nie nowszy niż żywe lustro - pomijam'); return; }
        }
      }
      /*  ⛔ ZASTANY BLOK NIE USTANAWIA, KTO NIESIE OBIEKT  [D-419b, objaw Tomasza: „basen sie
          polaczyl, ale niekompletny, jakby demo"]
          `kl` mowi, ktora droga obiekt NADAJE - stad ida zadania i komendy. Ustawialismy go przy
          KAZDYM pelnym bloku, takze `retained`. A retained lezy na brokerze i po zmianie ukladu
          potrafi byc sprzed godzin: na EMQX (dzis REZERWA, wiec sterownik tam nic nie nadaje)
          lezal caly stary komplet `blok`/`opis`/`status`. Aplikacja brala go za biezacy stan i kierowala
          zadania w martwa droge - ekran mial liczby, ale nieruchome, jak demo.
          ⚠ Zasada: SWIEZE WYGRYWA NAD ZASTANYM. Zastany blok wolno przyjac jako zasiew lustra
            (to robi `zastosujPelny` nizej), ale nie wolno mu przestawiac drogi. */
      const _byl = obiekty[pref] && obiekty[pref].kl;
      obiekty[pref] = Object.assign(obiekty[pref] || {}, { kiedy: Date.now() },
                                    (m.retained && _byl) ? {} : { kl: _zrodlo });   // `kl` = broker, którym przyszedł [D-313]
      /* [R1] blok z brokera z numerem uruchomienia: u lustra przyszło przed chwilą (retained też - spóźniony snapshot starego
         boot nie cofnie lustra; znak ŻYCIA dla stanNowszy daje tylko żywy - odnotujU wyżej). Zasiew z pamięci telefonu - nie. */
      if (zastosujPelny(pref, obiekty[pref], m.payloadString)) obiekty[pref].uBrok = { u: obiekty[pref].u, t: Date.now() };
      /*  RETAINED = ZASIEW, NIE ŚWIEŻY STAN [D-280]: blok z flagą retained ma od 0 do 60 s. Zasiewa
          lustro (rejestry, seq), ale nie zdejmuje planszy - świeży pełny blok przychodzi po `zadanie`
          w ~0,5 s. Bez tego dotknięcie w pierwszej sekundzie po otwarciu szło na starym stanie
          (probe: dwa kliknięcia = jedno przełączenie, ekran odwrotnie niż sterownik). */
      if (m.retained) { obiekty[pref].kiedy = Date.now() - 100000; obiekty[pref].zasiew = true; zapisz('retained blok ' + pref.split('/').slice(1).join('/') + ' - czekam na świeży'); }
      else { obiekty[pref].zasiew = false; obiekty[pref].luka = false; try { localStorage.setItem(KL('blok_' + pref), m.payloadString); } catch (e) {}   /* pamięć na zimny start [C4] */
             if (pref === wybrany) { ost.blok = Date.now(); czekamPoPowrocie = false; odnotujZmiane(); } }
      zapisz('pełny blok ' + pref.split('/').slice(1).join('/') + ' ' + m.payloadString.length + ' B seq ' + obiekty[pref].seq + (m.retained ? ' (retained)' : ''));
      if (!wybrany) { zmienWybrany(pref); oglos(tempo); }
      if (pref === wybrany) oddaj(true);
    };
    /*  KODY PAHO PO POLSKU [D-309, Tomasz 2026-09-11: „AMQJS0007E pojawia się w dzienniku łącza jako błąd"]:
        surowy kod biblioteki wyglądał jak awaria. AMQJS0007E „Socket error" = system zamknął gniazdo WebSocket
        (telefon w tle, zmiana WiFi→LTE, chwilowy brak zasięgu) - Paho wraca sam, więc to informacja, nie błąd.
        Zapamiętujemy chwilę zerwania, żeby przy powrocie dopisać, ile trwała przerwa (dane do prób brzegowych). */
    const rcZ = r => { const m = /return code:\s*(\d)/i.exec((r && r.errorMessage) || ''); return m ? +m[1] : null; };
    const pahoTekst = r => { const m = (r && (r.errorMessage || r.message)) || String((r && r.errorCode) || r || '');
      if (/AMQJS0007E/.test(m)) return 'gniazdo zerwane przez system (tło / zmiana sieci / zasięg)';
      /* 0011E „Invalid state" = wyjątek z connect()/send() w złym stanie - u nas: connect() po powrocie na ekran, gdy Paho
         właśnie sam łączy ponownie [Tomasz 02:30: „albo z końcówką 11E"]; informacja, nie błąd */
      if (/AMQJS0011E/.test(m)) return /already connect/i.test(m) ? 'ponowne łączenie już trwa (Paho łączy sam)' : /not connect/i.test(m) ? 'jeszcze bez połączenia' : 'zły stan klienta: ' + m.replace(/^AMQJS0011E\s*/, '');
      if (/AMQJS0008I/.test(m)) return 'połączenie zamknięte' + (document.visibilityState === 'hidden' ? ' (telefon w tle)' : ' (telefon na ekranie: sieć albo broker)');
      if (/AMQJS0004E/.test(m)) return 'broker nie odpowiedział na ping (zasięg?)';
      if (/AMQJSC0001E/.test(m)) return 'brak odpowiedzi brokera (limit czasu)';
      if (/AMQJS0006E/.test(m)) return 'broker odrzucił połączenie' + (rcZ(r) !== null ? ' (kod ' + rcZ(r) + ')' : '');
      return m.replace(/^AMQJS[C]?\d+[EI]\s*/, '') || 'powód nieznany'; };
    /*  PONAWIANIE JEST NASZE, NIE PAHO [D-310] - `reconnect:false` w opcjach niżej.
        Dlaczego: z `reconnect:true` biblioteka po zamrożeniu karty zostaje ze stanem „łączę ponownie"
        i martwym gniazdem, z którego nie ma wyjścia jej własnym API (connect rzuca „already connected",
        zamknięcie gniazda jest wtedy ignorowane, a disconnect wywala się na pustym zegarze) - czekało się
        na jej limit czasu i odstęp, czyli kilkanaście sekund po każdym powrocie do aplikacji.
        Teraz: każdy powód (zerwane, nieudana próba, powrót na ekran, odmrożenie) prowadzi do jednej
        drogi - `polaczTeraz`. Odstępy 1, 2, 5, 10, 20, 30, 60 s; powrót na ekran zeruje je i próbuje od razu.
        [D-313] KAŻDY BROKER MA SWÓJ komplet: stan, odstęp, zegar i gniazdo siedzą w jego wpisie `c` z POL;
        wspólne są tylko lustro obiektów, dziennik i ekran. */
    const ODSTEPY = [1, 2, 5, 10, 20, 30, 60];
    /*  GDY CZLOWIEK PATRZY, PROBUJEMY OD RAZU [D-345, Tomasz 2026-09-12: „od razu bez czekania"]
        ------------------------------------------------------------
        OBJAW: „na PC polaczona i widze, a na telefonie caly czas lacze ponownie" - i dalej:
        „musze zrestartowac i dziala". To nie bylo zerwane polaczenie, tylko ZABLOKOWANE PONAWIANIE:
        po kilku nieudanych probach odstep dochodzi do 60 s, wiec aplikacja probuje raz na minute.
        Restart zerowal licznik, wiec laczyla od razu - stad zludzenie, ze pomaga tylko restart.
        Odstep zerowal sie przy POWROCIE NA EKRAN i po odmrozeniu karty, ale kto trzyma aplikacje
        otwarta i patrzy, ten zadnego z tych momentow nie wywoluje.
        ⛔ ROZDZIELAMY DWIE SYTUACJE: gdy aplikacja jest WIDOCZNA, czlowiek czeka i musi widziec proby -
        odstep nie ma prawa urosnac ponad kilka sekund. Gdy jest w tle, nikt nie patrzy i liczy sie
        oszczedzanie baterii oraz niedobijanie brokera - tam zostaja stare odstepy.
        ⚠ Brokera i tak nie dobijemy: `polaczTeraz` pilnuje 1,5 s miedzy probami niezaleznie od tego. */
    const ODSTEPY_PATRZY = [1, 2, 3, 5];
    /*  ⛔ ODMOWA KONTA TO NIE ZERWANE LACZE [21.09.2026, objaw z Gliczarowa].
        ------------------------------------------------------------
        OBJAW: „przeladowuje sie co sekunde, pokazuje OK, rozlacza sie i tak w kolko" - przy czym
        dwa pozostale serwery dzialaly. Dziennik aplikacji: „serwery: 1:ok 2:zerwane 3:ok".
        PRZYCZYNA: po odmowie KONTA aplikacja ponawiala z `ODSTEPY_PATRZY`, czyli co 5 s bez konca.
        ⚠ Tamta tabela powstala dla zerwanego lacza i tam jest sluszna - lacze wraca samo, wiec
          warto probowac czesto. **Konto, ktorego broker nie zna, nie pojawi sie od probowania.**
          Moze je stworzyc tylko czlowiek, a do tego potrzebuje spokojnego ekranu i komunikatu,
          nie migotania co piec sekund.
        ⚠ Marker `odmowaKonta` zdejmuje sie przy pierwszym udanym polaczeniu [D-422], wiec po
          poprawieniu konta aplikacja wraca do normalnego rytmu sama - bez restartu. */
    const ODSTEPY_KONTO = [5, 15, 30, 60, 120, 300];
    /*  [D-427a] JEDNA NAZWA DROGI dla dziennika i dla ekranu. `slot` to numer slotu STEROWNIKA
        (z tematu `serwery`), a gdy go jeszcze nie znamy - pozycja na naszej liscie polaczen.
        Trzeci adres nie jest „slotem 3": to drugi kandydat do slotu 2. */
    const NAZWA_DROGI = nr => (nr === 1 ? 'slot 1' : nr === 2 ? 'slot 2 serwer 1'
                               : nr === 3 ? 'slot 2 serwer 2' : 'droga ' + nr);
    M.nazwaDrogi = NAZWA_DROGI;
    const etyk = c => (POL.length > 1 ? NAZWA_DROGI(c.slot || c.nr) + ': ' : '');
    /*  Komplet tematów obiektu; qos 1 tam, gdzie zgubiona wiadomość to zgubiona odpowiedź (paczki zmian,
        dziennik, karta SD), qos 0 tam, gdzie i tak przyjdzie następna (blok, stan, status, wynik). */
    const TEMATY = [['blok', 0], ['zm', 1], ['status', 0], ['wynik', 0], ['stan', 0],
                    ['zdarzenia', 1], ['zd', 1], ['pliki', 1], ['plik', 1], ['okres', 1],
                    ['serwery', 0], ['zapas', 0], ['nazwy', 1],   /* [D-493] nazwy kanałów, retained */
                    ['historia', 1]];   /* [D-511] strumień historii - tylko na prośbę i tylko drogą prośby (lekki, nie CIEZKIE) */
    /*  [D-411] `serwery` = spis brokerow prosto ze sterownika (retained, przyjdzie od razu).
        [D-412] `zapas`  = REPORTY O REZERWIE, po polsku, pisane przez sterownik. To jedyna droga,
        ktora mowi, co sie stalo z commandem `zapas:...` - odpowiedzi NIE MA w temacie `wynik`
        (sprawdzone na sprzecie 17.09: command z blednym PIN-em odpowiedzial „zmiana rezerwy wymaga
        PIN" wylacznie tematem `zapas`). Bez tej subskrypcji ekran serwisu wysylalby command w cisze.
        ⚠ TEN KOMENTARZ MUSI SIE DOMYKAC. Przez pol dnia nie mial znaku konca i sklejal sie
        z nastepnym - kod dzialal przypadkiem, a kazda linia dopisana tutaj zostalaby po cichu
        zjedzona. Tak wygladala awaria z 17.09 rano: aplikacja pokazywala demo i nie otwierala ustawien.
        ⚠ I JESZCZE JEDNO, ZMIERZONE NA WLASNEJ SKORZE minute pozniej: samo OSTRZEZENIE tez nie
        moze zawierac znaku konca komentarza w cudzyslowie - zamyka go w polowie zdania, a reszta
        zdania staje sie kodem. `sprawdz_apke.ps1` zlapal to numerem linii. */
    /*  CIĘŻKIE I LEKKIE [D-315]: sterownik nadaje każdą paczkę na WSZYSTKIE podłączone brokery (zmierzone:
        zgłoszenie na jednym włącza strumień na obu), więc przy dwóch brokerach telefon odbierał wszystko dwa razy.
        `zm` i `blok` to praktycznie cały ruch - te zostają tylko na brokerze, który NIESIE obiekt. Lekkie
        (`status`, `wynik`, `stan`, dziennik, karta) zostają na obu: są rzadkie, a `status` z obu jest nam potrzebny,
        żeby odróżnić „sterownik padł" od „ten broker już go nie obsługuje" (testament - D-314). */
    const CIEZKIE = ['zm', 'blok'];
    /*  ZAPISANIE SIE NA TEMAT, KTORE PRZEZYWA ODMOWE  [D-439]
        ─────────────────────────────────────────────────────────────────────────────────────
        WEJSCIA:   polaczenie · pelny temat ze wzorcem · jakosc uslugi
        CO Z CZEGO WYNIKA: od 18.09 aplikacja zapisuje sie na DWIE postaci nazw (`obiekt/...` i stara
                   `basen/...`), bo flota przechodzi na nowy prefiks pojedynczo. Uprawnienia na
                   brokerze porownuja WZORZEC, nie tematy - wiec konto majace regule tylko na
                   jedna postac dostanie ODMOWE na druga. To jest normalne i ma przejsc bez
                   sladu na ekranie.
        WYJSCIA:   subskrypcja albo cicha linijka w dzienniku lacza.

        ⛔ BEZ WLASNEJ OBSLUGI NIEPOWODZENIA pierwsza odmowa przerywala petle `forEach` wyjatkiem
           i zabierala WSZYSTKIE pozostale tematy na tej drodze - czyli jedna odmowa na wzorzec,
           ktorego i tak nie potrzebujemy, uciszalaby cale polaczenie.
        ⚠ Odmowy NIE pokazujemy jako bledu uzytkownikowi: to nie usterka, tylko skutek tego, ze
          konto ma prawa do jednej postaci nazw. W dzienniku zostaje, bo serwis ma widziec, czym
          aplikacja naprawde sie zapisala. */
    /*  [Sol S17] WYNIK TYLKO DLA TEJ PARTII ZAPISÓW: wywołanie zwrotne liczy się wyłącznie, gdy `c.kl` to wciąż ten sam
        klient i `c.zakresPartia` ta sama, co przy wysłaniu - SUBACK poprzedniego połączenia (albo starego klienta po
        odnowKlienta) nie dopisuje się do liczników nowej partii. */
    /*  KLASA WYNIKU ZAPISU  [Sol S19, 01.10.2026]
        WEJŚCIA:  obiekt z onFailure biblioteki: nakładka MQTT 5 daje `przyczyna` {klasa, rc} (klasa z PRAWDZIWEGO SUBACK:
                  acl = 0x87, broker = inny kod >= 0x80, transport = brak SUBACK, timeout, mieszany = różne na drogach);
                  Paho 3.1.1 daje `errorCode` = tablica z kodem SUBACK (3.1.1 zna tylko 0x80 = odmowa).
        CO Z CZEGO WYNIKA: tylko 'acl' i 'odmowa311' liczą się jako odmowa ZAKRESU KONTA (D-484); 0x80/0x97 z MQTT 5
                  to odmowa brokera / limit, transport i timeout to łącze - NIE zakres konta. Treści błędu nie parsujemy.
        WYJŚCIA:  'acl' | 'odmowa311' | 'broker' | 'limit' | 'transport' | 'timeout' | 'mieszany' | 'nieprawidlowy' | 'nieznany'.
        ⚠ Zostaje stare zdanie D-484 dla Paho 3.1.1: jego jedyny kod porażki 0x80 to prawdziwa odpowiedź brokera
          (zmierzone 19.09 na koncie klienckim), a nie zerwane łącze - Paho 3.1.1 nie woła onFailure przy zerwaniu. */
    const klasaZapisu = r => {
      const pr = r && r.przyczyna;
      if (pr && pr.klasa) return (pr.klasa === 'broker' && pr.rc === 0x97) ? 'limit' : String(pr.klasa);
      const k = r && r.errorCode, kod = (k && typeof k === 'object' && k.length) ? k[0] : k;
      if (typeof kod === 'number' && kod >= 0x80) return 'odmowa311';
      return 'nieznany';
    };
    M.klasaZapisu = klasaZapisu;              /* do prób i sond */
    /*  ZAPIS NA HISTORIĘ: WYNIK WEDŁUG FILTRA, KLIENTA I PARTII  [Sol INTEGRACJA-2-Z1/Z2, INTEGRACJA-2a, 04.10.2026]
        WEJŚCIA:  wynik SUBACK każdego filtra `…/historia` bieżącej partii zapisów bieżącego klienta: czeka (wysłany, bez
                  odpowiedzi), grant, odmowa (klasa acl / odmowa311 - zakres konta), lacze (transport, timeout, inny kod).
        CO Z CZEGO WYNIKA: o pobraniu dla obiektu `pref` decydują TYLKO filtry pasujące do `<pref>/historia` (konto
                  serwisowe: wzorce `obiekt/+/…`, `basen/+/+/…`). Grant pasującego filtra wygrywa; „konto nie ma prawa”
                  dopiero, gdy WSZYSTKIE pasujące filtry odmówiły - wynik nie zależy od kolejności odpowiedzi i od aliasu
                  innego obiektu (Z1). Nowe połączenie / nowa partia = nowa, pusta mapa - stara odmowa nie przechodzi (Z2).
        WYJŚCIA:  histStan(c, pref) = 'grant' | 'czeka' | 'lacze' | 'odmowa' | 'brak' (żaden pasujący filtr) | 'nieznany'
                  (brak mapy bieżącej partii). Dawna jedna flaga `c.bezHistorii` usunięta. */
    const pasujeFiltr = (filtr, temat) => {
      const f = String(filtr).split('/'), t = String(temat).split('/');
      for (let i = 0; i < f.length; i++) {
        if (f[i] === '#') return true;
        if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) return false;
      }
      return f.length === t.length;
    };
    const histUstaw = (c, kl, nr, temat, wynik) => {
      let h = c.histZapisy;
      if (!h || h.kl !== kl || h.partia !== nr) h = c.histZapisy = { kl, partia: nr, t: {} };
      h.t[temat] = wynik;
    };
    const histStan = (c, pref) => {
      const h = c && c.histZapisy;
      if (!h || h.kl !== c.kl || h.partia !== c.zakresPartia) return 'nieznany';
      const temat = pref + '/historia';
      let jest = false, czeka = false, lacze = false;
      for (const f in h.t) {
        if (!pasujeFiltr(f, temat)) continue;
        jest = true;
        const w = h.t[f];
        if (w === 'grant') return 'grant';
        if (w === 'czeka') czeka = true; else if (w === 'lacze') lacze = true;
      }
      return !jest ? 'brak' : czeka ? 'czeka' : lacze ? 'lacze' : 'odmowa';
    };
    M.pasujeFiltr = pasujeFiltr; M.histStan = histStan;   /* do prób */
    const KLASA_TXT = { transport: 'łącze przerwane', timeout: 'brak odpowiedzi brokera', broker: 'odmowa brokera',
                        limit: 'limit brokera', mieszany: 'wynik mieszany', nieprawidlowy: 'niespójna odpowiedź', nieznany: 'powód nieznany' };
    const DROGA_TXT = { tls: 'TLS', quic: 'QUIC' };
    /* opis wyniku „mieszany” po drogach: „QUIC brak uprawnień, TLS brak odpowiedzi” */
    const drogiTxt = d => Object.keys(d || {}).map(n => (DROGA_TXT[n] || n) + ' ' + (d[n].klasa === 'acl' ? 'brak uprawnień'
                          : d[n].klasa === 'grant' ? 'przyjęła' : (KLASA_TXT[d[n].klasa] || d[n].klasa))).join(', ');
    /*  [Sol S17] WYNIK TYLKO DLA TEJ PARTII ZAPISÓW: wywołanie zwrotne liczy się wyłącznie, gdy `c.kl` to wciąż ten sam
        klient i `c.zakresPartia` ta sama, co przy wysłaniu - SUBACK poprzedniego połączenia (albo starego klienta po
        odnowKlienta) nie dopisuje się do liczników nowej partii.
        [Sol S19] partia liczy WYSŁANE i ZAKOŃCZONE zapisy; ocena po komplecie (albo w terminie), klasy osobno. */
    const _zapisz_sie = (c, temat, qos) => {
      const kl = c.kl, nr = c.zakresPartia;
      const biezaca = () => c.kl === kl && c.zakresPartia === nr;
      const koniec = () => { c.zakresKoniec = (c.zakresKoniec || 0) + 1; if (c.zakresCzeka && c.zakresKoniec >= (c.zakresWyslane || 0)) { c.zakresCzeka = false; ocenZakres(c); } };
      try {
        /*  [D-511] `historia` zapamiętujemy osobno: rola klienta na brokerze v5 sprzed dopisania tematu (kontrakt_rol_v5.py)
            odrzuca subskrypcję, a sterownik i tak nadałby cały strumień w ciszę - aplikacja ma to POWIEDZIEĆ (zasada 10),
            a nie prosić o historię, której nie odbierze.
            [INTEGRACJA-2a, Sol Z1/Z2] wynik zapisuje się PER FILTR w mapie bieżącej partii (histUstaw / histStan wyżej):
            odmowa tylko przy klasie acl / odmowa311; łącze / brak odpowiedzi = osobny stan, nie odmowa roli. */
        const hist = /\/historia$/.test(temat);
        if (hist) histUstaw(c, kl, nr, temat, 'czeka');
        c.zakresWyslane = (c.zakresWyslane || 0) + 1;
        c.kl.subscribe(temat, { qos: qos,
          onSuccess: r => { if (!biezaca()) return; c.zakresOk = (c.zakresOk || 0) + 1; if (hist) histUstaw(c, kl, nr, temat, 'grant');
                            /* [Sol S19] sukces z ograniczeniem jednej drogi (np. QUIC bez uprawnień, TLS ma) - liczymy na drogę */
                            const d = r && r.drogi;
                            if (d) for (const n in d) if (d[n] && d[n].klasa !== 'grant' && d[n].klasa !== 'czeka') (c.zakresDrogi || (c.zakresDrogi = {}))[n] = ((c.zakresDrogi || {})[n] || 0) + 1;
                            koniec(); },
          onFailure: r => { if (!biezaca()) return;
                            const kl0 = klasaZapisu(r);
                            if (kl0 === 'acl' || kl0 === 'odmowa311') { c.zakresOdmowy = (c.zakresOdmowy || 0) + 1; (c.zakresOdmowyTematy || (c.zakresOdmowyTematy = [])).push(temat);
                                                                         if (hist) histUstaw(c, kl, nr, temat, 'odmowa'); }
                            else { (c.zakresInne || (c.zakresInne = [])).push({ temat, klasa: kl0, drogi: r && r.drogi });
                                   if (hist) histUstaw(c, kl, nr, temat, 'lacze'); }
                            koniec(); } });
      } catch (e) { c.zakresWyslane--; zapisz(etyk(c) + 'nie udało się zapisać na ' + temat);
        /*  [Sol INTEGRACJA-2a-P3] wyjątek z subscribe() = SUBSCRIBE w ogóle nie wyszło: filtr historii nie może zostać
            w `czeka` (aplikacja mówiłaby „broker jeszcze nie potwierdził” bez końca) - dostaje `lacze`, czyli zdanie o łączu */
        if (/\/historia$/.test(temat) && biezaca()) histUstaw(c, kl, nr, temat, 'lacze'); }
    };
    /*  JEDNO ZDANIE ZAMIAST LITANII [D-484, B.0z-38, zmierzone na PC Tomasza 19.09]. Konto KLIENCKIE
        z zaznaczonym ptaszkiem „serwisowe" zapisuje się wzorcami `obiekt/+/…` i `basen/+/+/…`, broker
        odrzuca każdy z osobna, a dziennik pisał dwadzieścia razy „bez dostępu do … - to konto ogląda
        inną postać nazw". Każde zdanie prawdziwe, całość myląca: człowiek szukał w NAZWACH obiektu,
        a przyczyną był ZAKRES KONTA (ptaszek). Teraz odmowy zbieramy i oceniamy po komplecie:
          • wszystkie odrzucone, a login ma myślnik (kliencki) → JEDNO zdanie, także na pasku
            (`c.stan`): „to konto jest klienckie - odznacz «serwisowe» i zaloguj się ponownie";
          • wszystkie odrzucone, login bez myślnika → to samo zdanie o zakresie, bez odsyłania do ptaszka;
          • część odrzucona, część przyjęta → dawne linie per temat (to naprawdę jest „inna postać nazw");
          • i odwrotnie [B.0z-38 druga strona]: konto BEZ myślnika (serwisowe) z odznaczonym ptaszkiem
            widzi jeden obiekt - jedna linia w dzienniku, żeby „zniknęły mi sterowniki" miało wyjaśnienie.
        Ocena po 3 s od kompletu zapisów: SUBACK-i wracają szybko, a broker, który milczy, i tak
        nie da żadnej odpowiedzi do oceny. */
    /*  [Sol S19] 3 s to termin ZDANIA „zapisy jeszcze trwają”, nie domknięcie oceny: niepełną partię oceniamy po
        komplecie wyników (nakładka MQTT 5 kończy każdy zapis najpóźniej po 10 s) albo po ZAKRES_OSTATNI_MS - brak
        odpowiedzi to wtedy osobna klasa, nie odmowa konta. */
    const ZAKRES_OSTATNI_MS = 12000;
    const ocenZakres = c => {
      const wysl = c.zakresWyslane || 0, kon = c.zakresKoniec || 0;
      if (kon < wysl && !c.zakresPozno) {
        c.zakresCzeka = true;
        if (!c.zakresTrwaZapisane) { c.zakresTrwaZapisane = true; zapisz(etyk(c) + 'zapisy na tematy jeszcze trwają (' + kon + ' z ' + wysl + ' potwierdzone) - ocenię po komplecie'); }
        const nr = c.zakresPartia;
        setTimeout(() => { if (c.zakresPartia === nr && c.zakresCzeka) { c.zakresCzeka = false; c.zakresPozno = true; ocenZakres(c); } }, ZAKRES_OSTATNI_MS - 3000);
        return;
      }
      const ok = c.zakresOk || 0, odm = c.zakresOdmowy || 0, tematy = c.zakresOdmowyTematy || [];
      const inne = c.zakresInne || [], brak = Math.max(0, wysl - kon), drogiOgr = c.zakresDrogi || {};
      c.zakresOk = 0; c.zakresOdmowy = 0; c.zakresOdmowyTematy = []; c.zakresInne = []; c.zakresDrogi = {};
      c.zakresCzeka = false; c.zakresPozno = false; c.zakresTrwaZapisane = false;
      /* [Sol S19] ograniczenie JEDNEJ drogi przy sukcesie: jedna linia na drogę, nie litania tematów */
      for (const n in drogiOgr) zapisz(etyk(c) + (DROGA_TXT[n] || n) + ': ' + drogiOgr[n] + ' temat(y) bez dostępu na tej drodze - druga je przyjęła, dane idą nią');
      /* [Sol S19] zapisy niepotwierdzone z powodu łącza / brokera / limitu - zgrupowane po klasie, to NIE zakres konta */
      if (inne.length || brak) {
        const gr = {};
        inne.forEach(x => { const k = x.klasa === 'mieszany' ? 'mieszany (' + drogiTxt(x.drogi) + ')' : (KLASA_TXT[x.klasa] || x.klasa); gr[k] = (gr[k] || 0) + 1; });
        if (brak) gr['brak odpowiedzi w ' + Math.round(ZAKRES_OSTATNI_MS / 1000) + ' s'] = brak;
        zapisz(etyk(c) + 'zapisy niepotwierdzone (to nie zakres konta): ' + Object.keys(gr).map(k => k + ' - ' + gr[k]).join('; '));
      }
      if (!odm) {
        if (!serwisowe && String(c.user || '').indexOf('-') < 0 && ok)
          zapisz(etyk(c) + 'konto „' + c.user + '" wygląda na serwisowe, a ptaszek „serwisowe" jest odznaczony - apka widzi tylko jeden obiekt; zaznacz go przy logowaniu, jeśli ma widzieć wszystkie');
        return;
      }
      /* [Sol S19] część przyjęta ALBO część z innego powodu (łącze, limit, brak odpowiedzi) = nie „odrzucił wszystkie” */
      if (ok || inne.length || brak) { tematy.forEach(t => zapisz(etyk(c) + 'bez dostępu do ' + t + ' - to konto ogląda inną postać nazw')); return; }
      const kliencki = String(c.user || '').indexOf('-') > 0;
      const zdanie = serwisowe && kliencki
        ? 'to konto („' + c.user + '") jest klienckie - odznacz „serwisowe" przy logowaniu i zaloguj się ponownie'
        : 'broker odrzucił wszystkie zapisy konta „' + c.user + '" (' + odm + ') - zakres konta nie pasuje do wybranej postaci nazw';
      zapisz(etyk(c) + zdanie);
      c.stan = { stan: 'blad', opis: zdanie };
      oddaj();
    };
    const odepnijCiezkie = c => { if (c.lekki) return; c.lekki = true;
      try { (c.tematy || [c.temat]).forEach(z => CIEZKIE.forEach(tm => c.kl.unsubscribe(z + '/' + tm)));
            zapisz(etyk(c) + 'nie odbieram danych - te same paczki idą drugą drogą'); } catch (e) {} };
    const wepnijCiezkie = c => { if (!c.lekki || !c.kl.isConnected()) return; c.lekki = false;
      try { (c.tematy || [c.temat]).forEach(z => TEMATY.filter(tm => CIEZKIE.indexOf(tm[0]) >= 0)
              .forEach(tm => _zapisz_sie(c, z + '/' + tm[0], tm[1])));
            zapisz(etyk(c) + 'odbieram dane tędy'); } catch (e) {} };
    const zrobDriver = c => {
      /*  ZDARZENIA TYLKO OD AKTUALNEGO KLIENTA [D-483, audyt Astry 20.09 „powrót łączności" P1].
          `odnowKlienta` buduje nowy obiekt Paho, ale stary ma nadal podpięte `onConnectionLost`,
          `onConnected`, `onSuccess/onFailure` i odbiór. Zmierzone przez Astrę na prawdziwym Paho:
          rozłączenie starego wołało jego `onConnectionLost` → `polaczTeraz` → stary łączył się
          PONOWNIE, potem powstawał nowy - dwa żywe klienty na jednej drodze, a błąd gniazda starego
          ustawiał wspólny `c.stan` na „zerwane", choć nowy działał i dostarczał świeże paczki
          (aplikacja: „polaczony=false" przy wieku danych 0 s). Każda obsługa zapamiętuje, KTÓREGO klienta
          dotyczy, i milczy, gdy `c.kl` wskazuje już na innego. */
      const kl = c.kl;
      const moj = () => kl === c.kl;
      c.zerwaneOd = 0; c.byloWTle = false; c.byloZerwane = false; c.odstepNr = 0; c.ponowZegar = null; c.ostProba = 0;
      c.dzialaloOd = 0;   /* [D-407] kiedy to połączenie NAPRAWDĘ stanęło - stąd wiadomo, czy zerować odstęp */
      /*  [B.0z-78, D-530] MARIAŻ QUIC + TLS: zgubienie i powrót JEDNEJ drogi nie są błędem połączenia (aplikacja nadal
          dostaje dane drugą) - nakładka mówi o nich tylko tutaj, w dzienniku łącza (widzi go serwis, D-366).
          Pierwsza linia „mariaż: QUIC + TLS naraz” przy każdym łączeniu = dowód, że kod żyje. Paho (aplikacja klienta)
          tego wywołania nie ma - linia milczy. */
      c.kl.onDroga = t => { if (moj()) zapisz(etyk(c) + t); };
      const ponowPozniej = powod => {
        /* [D-345] tablica zalezy od tego, czy ktos patrzy - patrz uzasadnienie przy ODSTEPY_PATRZY */
        const widac = (typeof document === 'undefined') || document.visibilityState !== 'hidden';
        /*  Kolejnosc ma znaczenie: odmowa konta bije nawet wtedy, gdy czlowiek patrzy -
            bo patrzenie nie zmienia faktu, ze tego konta broker nie zna. */
        const tab = c.odmowaKonta ? ODSTEPY_KONTO : (widac ? ODSTEPY_PATRZY : ODSTEPY);
        const sek = tab[Math.min(c.odstepNr, tab.length - 1)]; c.odstepNr++;
        if (c.ponowZegar) clearTimeout(c.ponowZegar);
        c.ponowZegar = setTimeout(() => { c.ponowZegar = null; c.polaczTeraz(powod); }, sek * 1000);
        return sek;
      };
      c.polaczTeraz = powod => {
        if (!c.kl || c.kl.isConnected()) return;
        /* ⚠ nie dobijamy brokera: seria zdarzeń (powrót + odmrożenie + zerwanie w tej samej chwili) ma dać JEDNĄ próbę */
        /*  ⛔ ODRZUCONA PROBA MUSI ZOSTAWIC ZAPLANOWANA KOLEJNA [D-359, audyt Astry 15.09]:
            pierwsza wersja robila samo `return`. Gdy blad wracal szybciej niz 1,5 s (np. odmowa gniazda
            po 100 ms), zaplanowane ponowienie trafialo w ogranicznik i GINELO - bez zegara, bez sladu.
            Zmierzone przez Astre: po 60 s jedna proba i zero zaplanowanych, mimo napisu „proba za 1 s".
            Teraz odraczamy do najblizszego dozwolonego terminu zamiast porzucac. */
        const teraz = Date.now();
        if (teraz - c.ostProba < 1500) {
            if (!c.ponowZegar) {
              const za = 1500 - (teraz - c.ostProba);
              c.ponowZegar = setTimeout(() => { c.ponowZegar = null; c.polaczTeraz(powod); }, za);
            }
            return;
        }
        c.ostProba = teraz;
        if (c.ponowZegar) { clearTimeout(c.ponowZegar); c.ponowZegar = null; }
        const sprobuj = () => { c.kl.connect(c.opcje); c.gniazdo = M._gniazdo; c.stan = { stan: 'laczy', opis: 'łączę z brokerem…' }; oddaj(); };
        try { sprobuj(); return; }
        catch (e) {
          /*  gniazdo poprzedniej próby wisi (zamrożone razem z kartą): zamykamy je i wołamy obsługę zamknięcia,
              którą Paho sam do niego podpiął - biblioteka od razu wie, że gniazda nie ma. Bez tego czekałaby
              pełny własny limit czasu. Przy `reconnect:false` ta droga zawsze działa. */
          try { const g = c.gniazdo;
            if (g) { try { g.close(); } catch (e2) {} if (typeof g.onclose === 'function') g.onclose({ code: 1006, wasClean: false }); }
          } catch (e3) {}
          try { sprobuj(); zapisz(etyk(c) + 'gniazdo w locie zamknięte - łączę (' + powod + ')'); return; }
          catch (e4) { const s = ponowPozniej(powod); zapisz(etyk(c) + 'próba za ' + s + ' s (' + pahoTekst(e4) + ')'); }
        }
      };
      c.kl.onConnectionLost = r => { const co = pahoTekst(r);
        if (!moj()) { zapisz(etyk(c) + 'zerwanie WYCOFANEGO klienta (' + co + ') - pomijam, nowy klient działa dalej'); return; }   /* [D-483] */
        c.zerwaneOd = Date.now(); c.byloZerwane = true;
        c.byloWTle = (document.visibilityState === 'hidden');
        c.stan = { stan: 'zerwane', opis: 'zerwane: ' + co + ' - łączę ponownie…' };
        statusBezDrogi(c.nr);            /* [D-481] zerwana droga traci głos w „online/offline" obiektów */
        const niosl = (klDla(wybrany) === c);   /* czy TĄ drogą przychodził wybrany obiekt [D-407] */
        if (niosl) czekamPoPowrocie = true;
        zapisz(etyk(c) + 'zerwane: ' + co); oddaj();
        /*  ⚠ TYLKO GDY TO BYŁA DROGA, KTÓRĄ OBIEKT DOCIERAŁ [D-407, objaw zmierzony 17.09].
            Dotąd KAŻDE zerwanie - także serwera, który nigdy nie działał - kazało sterownikowi wrócić
            do nadawania równoległego. Martwy serwer 2 robił to co dwie sekundy i szarpał tym pierwszym:
            w dzienniku „serwer 1: połączony ponownie (przerwa 4 s)", a w aplikacji znikające obiegi. */
        if (niosl && M.niesieReset) M.niesieReset();
        /*  ⚠ ODSTĘP ZERUJEMY TYLKO PO POŁĄCZENIU, KTÓRE NAPRAWDĘ DZIAŁAŁO [D-407].
            Zerowanie przy każdym zerwaniu znaczyło, że serwer NIEOSIĄGALNY nigdy nie wchodzi
            w odstępy - bo każda nieudana próba wygląda jak „zerwane działające połączenie"
            i wraca na początek tablicy. Efekt: próba co 1-2 s w nieskończoność, bateria i broker
            dobijane bez sensu. Dziesięć sekund pracy = połączenie było prawdziwe. */
        if (c.dzialaloOd && (Date.now() - c.dzialaloOd) > 10000) c.odstepNr = 0;
        c.dzialaloOd = 0;
        c.polaczTeraz('zerwane');   /* od razu; gdy sieci nie ma, próba padnie i pójdą odstępy */
      };
      /*  PO KAŻDYM POŁĄCZENIU: `onSuccess` (subskrypcje - cleanSession je kasuje przy zerwaniu) leci przy KAŻDYM
          CONNACK, a `onConnected` podpisuje pasek. Czy to POWRÓT po zerwaniu, wiemy z własnej flagi `byloZerwane`
          - Paho przy `reconnect:false` zawsze podaje „pierwsze połączenie" [D-310]. */
      c.kl.onConnected = () => {
        if (!moj()) { zapisz(etyk(c) + 'połączył się WYCOFANY klient - rozłączam go, nowy ma pierwszeństwo'); try { kl.disconnect(); } catch (e) {} return; }   /* [D-483] */
        const drTxt = M.drogaOpis ? ' [' + M.drogaOpis(c.kl) + ']' + M.diagWT() : '';   /* [audyt WT/QUIC 02.10] którą drogą / które drogi żyją */
        const ponownie = c.byloZerwane;
        const przerwa = (ponownie && c.zerwaneOd) ? ' (przerwa ' + Math.round((Date.now() - c.zerwaneOd) / 1000) + ' s' + (c.byloWTle ? ', telefon był w tle' : '') + ')' : '';
        c.zerwaneOd = 0; c.byloWTle = false; c.byloZerwane = false; c.odstepNr = 0; c.nieudane = 0;
        c.odmowaKonta = false;           /* [D-422] konto jednak jest - zdejmujemy marker */
        c.dzialaloOd = Date.now();       /* [D-407] połączenie NAPRAWDĘ stanęło - dopiero to pozwala zerować odstęp */
        /*  [D-408] report do serwisu - po chwili, gdy subskrypcje i wybor obiektu juz stoja.
            [D-430] PO ZERWANIU idzie PELNY dziennik: wtedy jest po co, bo w nim siedzi przyczyna.
            Inaczej z telefonu widac tylko jedna linie skrotu i szuka sie na oslep - dokladnie tak
            zgubilem dzis wyjatek `m is not defined`, ktory zrywal polaczenie co sekunde.
            ⚠ Nie czesciej niz raz na minute: pelny dziennik to 2-3 kB, a aplikacja ze zrywajacym sie
              laczem zalalaby brokera wlasnie wtedy, gdy lacze ledwo dycha. */
        c.nrPol = (c.nrPol || 0) + 1;    /* [Astra zad. 20] numer połączenia tego serwera w tej sesji (generacja drogi) */
        setTimeout(() => { try {
          if (!M.wyslijDziennik) return;
          const teraz = Date.now();
          const pelny = ponownie && (!M._pelnyLog || teraz - M._pelnyLog > 60000);
          if (pelny) { M._pelnyLog = teraz; M.meldunekKrotki(true); return; }
          M.meldunekKrotki(false);
        } catch (e) {} }, 4000);
        c.ostOdbior = Date.now();        /* [D-355] swiezo polaczony - guard ciszy liczy od teraz */
        if (c.ponowZegar) { clearTimeout(c.ponowZegar); c.ponowZegar = null; }
        c.stan = { stan: 'ok', opis: ponownie ? 'połączony ponownie' + przerwa : 'połączony' };
        zapisz(etyk(c) + (ponownie ? 'połączony ponownie' + przerwa : 'połączony') + drTxt);
        if (ponownie && wybrany && klDla(wybrany) === c) { _pelnyOst = 0; prosPelny('powrót łącza'); }   /* w czasie przerwy paczki zmian przepadły, retained blok bywa 60 s stary [D-278] */
        oddaj();
      };
      c.opcje = { useSSL: true, userName: c.user, password: c.pass, timeout: 10, keepAliveInterval: 30, cleanSession: true, reconnect: false,
        onSuccess: () => { if (!moj()) return;   /* [D-483] */
                           c.lekki = false; c.bliz = 0;
                           for (const k in rpcCap) delete rpcCap[k];   /* [Sol S20] nowa sesja - możliwość rid potwierdzamy od nowa */
                           c.zakresOk = 0; c.zakresOdmowy = 0; c.zakresOdmowyTematy = [];
                           c.zakresInne = []; c.zakresDrogi = {}; c.zakresWyslane = 0; c.zakresKoniec = 0;   /* [Sol S19] */
                           c.zakresCzeka = false; c.zakresPozno = false; c.zakresTrwaZapisane = false;
                           /* [Sol S17] numer partii zapisów: zegar oceny i wyniki SUBACK należą do TEJ partii - zegar
                              z poprzedniego połączenia (zerwanie i powrót w 3 s) nie ocenia nowej, niepełnej partii */
                           const partia = c.zakresPartia = (c.zakresPartia || 0) + 1;
                           (c.tematy || [c.temat]).forEach(z => TEMATY.forEach(tm => _zapisz_sie(c, z + '/' + tm[0], tm[1])));
                           setTimeout(() => { if (moj() && c.zakresPartia === partia) ocenZakres(c); }, 3000);   /* [D-484] jedno zdanie o zakresie konta */
                           if (wybrany) oglos(tempo); },
        onFailure: r => {
          if (!moj()) return;   /* [D-483] nieudana próba WYCOFANEGO klienta nie planuje ponowień ani nie zmienia stanu */
          const rc = rcZ(r);
          /* ZŁE DANE LOGOWANIA NIE PONAWIAJĄ SIĘ - to człowiek musi poprawić (inaczej broker blokuje konto za dobijanie) */
          /*  ⚠ POWIEDZ, JAKIM KONTEM PROBOWALES [17.09, zmierzone na stanowisku]. Konto na brokerze
              zapasowym powstaje u innego dostawcy i czlowiek nadaje mu nazwe recznie - u nas wyszlo
              `apka` przy apce szukajacej `apka2` (pusta rubryka znaczy „ten sam login z dwojka na
              koncu"). Bez nazwy w komunikacie wyglada to na zle HASLO i szuka sie nie tam, gdzie
              trzeba. Nazwa konta nie jest tajemnica - haslo nadal nigdzie nie jedzie. */
          /*  ⚠ TEKST MA PASOWAC DO KAZDEGO SERWERA, NIE TYLKO DO ZAPASU [17.09, wieczor].
              Pierwsza wersja pisala „popraw haslo ZAPASU" - a odmowa przyszla z serwera GLOWNEGO
              (skasowane konto `apka`, zostalo `Master`). Czlowiek czytal o zapasie i szukal bledu
              w rubryce, ktora akurat byla pusta i poprawna. Komunikat nazywa wiec konto i mowi,
              gdzie sie je zmienia - „Zmien sterownik / haslo" dla glownego, „zaawansowane" dla zapasow. */
          if (rc === 4 || rc === 5) {
            const gl = (c.nr === 1);
            c.stan = { stan: 'blad', opis: 'broker nie zna konta „' + (c.user || '(bez konta)') + '"'
                       + (gl ? ' - zaloguj sie jeszcze raz przyciskiem „Zmien sterownik / haslo"'
                             : ' - popraw konto zapasu w zaawansowanych') };
            c.odmowaKonta = true;                       /* [D-422] ta droga odpadla przez KONTO, nie przez lacze */
            zapisz(etyk(c) + 'odmowa: broker nie zna konta „' + c.user + '" (albo haslo inne)');
            oddaj(); return; }
          const powod = rc === 3 ? 'broker niedostępny' : rc === 1 || rc === 2 ? 'broker odrzucił klienta (kod ' + rc + ')'
                      : 'broker nie odpowiada (brak zasięgu?)';
          const sek = ponowPozniej('nieudana próba');
          c.stan = { stan: 'blad', opis: powod + ' - ponowna próba za ' + sek + ' s' }; zapisz(etyk(c) + 'odmowa: ' + powod + ' - próba za ' + sek + ' s'); oddaj();
          /*  [D-354] TRZY NIEUDANE PROBY POD RZAD = cos jest nie do odratowania w tym kliencie
              (utknieta biblioteka albo sesja o tym samym identyfikatorze wciaz zywa u brokera).
              Budujemy od zera; nastepna proba pojdzie juz nowym klientem. */
          c.nieudane = (c.nieudane || 0) + 1;
          if (c.nieudane >= 3) odnowKlienta(c);
        } };
    };
    /*  KLIENT OD ZERA, Z NOWYM IDENTYFIKATOREM [D-354, 2026-09-13]
        ------------------------------------------------------------
        WEJSCIA:  polaczenie `c`, ktore nie wstaje mimo kolejnych prob.
        CO Z CZEGO WYNIKA: zamykamy gniazdo, porzucamy stary obiekt biblioteki i budujemy NOWY,
                  z NOWO WYLOSOWANYM identyfikatorem; obsluge podpina ta sama `zrobDriver`.
        WYJSCIA:  `c.kl` wskazuje na swiezy obiekt gotowy do `polaczTeraz`.

        ⛔ PO CO, skoro `polaczTeraz` juz ponawia [objaw Tomasza 13.09: „nie mam nawet do basenu
        dostepu, robie restart i jest basen"; w dzienniku lacza szesc prob pod rzad, kazda
        „broker nie odpowiada", az do przeladowania strony]:
        1. IDENTYFIKATOR BYL STALY przez cale zycie strony (losowany raz). Telefon wraca z tla,
           a broker jeszcze trzyma STARA sesje z tym samym identyfikatorem - nowe polaczenie leci
           w konflikt i pada. Przeladowanie strony losowalo nowy identyfikator, wiec „restart
           pomagal, a ponawianie nie" - to ten sam mechanizm, nie przypadek.
        2. OBIEKT BIBLIOTEKI BYL TEN SAM. Paho potrafi utknac po zerwaniu w stanie, z ktorego
           `connect` juz nie wychodzi (znane z D-310, dlatego mamy `reconnect:false` i wlasne
           ponawianie). Zamkniecie gniazda w locie leczy tylko czesc przypadkow.
        ⚠ NIE ROBIMY TEGO PRZY KAZDEJ PROBIE - nowy identyfikator to dla brokera nowy klient
        i nowa sesja; przy `cleanSession:true` kosztuje to komplet subskrypcji od nowa. Odnawiamy
        przy POWROCIE NA EKRAN (czlowiek patrzy i czeka) oraz po serii nieudanych prob w tle. */
    const odnowKlienta = c => {
      /*  KOLEJNOŚĆ MA ZNACZENIE [D-483]: NAJPIERW nowy klient staje się `c.kl` i znika zaplanowane
          ponowienie, DOPIERO POTEM zamykamy starego. Wtedy jego `onConnectionLost` (Paho woła je
          także przy zwykłym `disconnect()`) trafia w straż `moj()` i nie robi nic - a dotąd
          uruchamiał drugie połączenie tego samego starego obiektu. */
      const nowy = 'hmi-' + Math.random().toString(16).slice(2, 10) + (c.nr > 1 ? '-' + c.nr : '');
      let nowyKl;
      try { nowyKl = new Klient(c.host, c.port, '/mqtt', nowy); }
      catch (e) { zapisz(etyk(c) + 'nie udalo sie zbudowac klienta: ' + e.message); return false; }
      const stary = c.kl, gniazdo = c.gniazdo;
      if (c.ponowZegar) { clearTimeout(c.ponowZegar); c.ponowZegar = null; }
      c.kl = nowyKl; c.gniazdo = null; c.nieudane = 0;
      try { if (gniazdo && gniazdo.close) gniazdo.close(); } catch (e) {}
      /*  [audyt WT/QUIC 02.10, K6; z quic/audyt-wt d1b43d87] TAKŻE PRÓBA W TOKU: stary klient nakładki v5 (apka3) mógł być
          w środku próby - jednej drogi (`_proba`: WebTransport albo wss) albo mariażu (`_m`: dwie drogi, nic jeszcze nie
          połączone). Dotąd zostawała żywa: dochodziła do końca, otwierała połączenie pod starym identyfikatorem (potem
          „WYCOFANY klient - rozłączam”), a jej uzgodnienie WebTransport zostawało w kolejce przeglądarki. `disconnect()`
          nakładki w trakcie próby ją wycofuje (bez wywołań zwrotnych; porzucone uzgodnienie WT = porażka QUIC). Paho 3.1.1
          (apka/apka2) nie ma `_proba` ani `_m` - zachowanie bez zmian. */
      try { if (stary && (stary.isConnected() || stary._proba || stary._m)) stary.disconnect(); } catch (e) {}
      zrobDriver(c);
      podepnijOdbior(c);        /* [D-359] bez tego nowy klient jest „polaczony", ale gluchy */
      c.odstepNr = 0;
      zapisz(etyk(c) + 'klient od nowa (identyfikator ' + nowy + ')');
      return true;
    };
    POL.forEach(zrobDriver);
    /*  ZIMNY START Z PAMIĘCI TELEFONU [D-289, C4]: ostatni pełny blok wybranego obiektu leży w localStorage.
        Otwarcie aplikacji = liczby OD RAZU pod zasłoną „łączę…/pobieram stan…" (zasiew), nie ciemna plansza;
        świeży blok przychodzi po `zadanie`. Warunki brzegowe: blok z pamięci ma `seq` sprzed godzin →
        pierwsza paczka zm pokaże lukę → `pelny` od ręki, a do jego nadejścia zasłona zostaje (w.luka).
        Zły/obcięty wpis → parsujLinie zwraca null → oddaj() traktuje jak brak bloku. */
    if (wybrany) { const c = pamiec('blok_' + wybrany);
      if (c && c.indexOf('MB;') === 0 || (c && c.indexOf('\nMB;') >= 0)) { obiekty[wybrany] = { kiedy: Date.now() - 100000, zasiew: true, luka: true, status: '?' };
        zastosujPelny(wybrany, obiekty[wybrany], c); zapisz('blok z pamięci telefonu (zasiew)'); } }
    POL.forEach(c => { zapisz(etyk(c) + 'zakres: ' + (c.tematy || [c.temat]).join(' + ')); c.polaczTeraz('start'); });
    oddaj(!!(wybrany && obiekty[wybrany]));   /* od razu: liczby z pamięci pod zasłoną albo plansza „łączę z brokerem…" */
    /* wiek pakietu ma płynąć także między pakietami - kafel ma zblednąć, gdy obiekt zamilkł */
    setInterval(() => oddaj(false), 1000);
    /*  [D-408] DZIENNIK APLIKACJI WRACA DO SERWISU PO MQTT — temat `<obieg>/apka`.
        ⚠ PO CO: gdy klient mówi „nie działa", jedyną drogą do tego, co widzi jego telefon, był
          screenshot. Dziś aplikacja sama odsyła wersję, stan obu serwerów i ostatnie linie dziennika —
          czyli dokładnie to, czego szukaliśmy dziś rano, przepisując ekran po ekranie.
        ⚠ DWA TRYBY, ŚWIADOMIE: KRÓTKI (jedna linia przy połączeniu — tanie, zawsze) i PEŁNY
          (na żądanie człowieka). Ciągłe nadawanie całego dziennika zjadałoby łącze i zamieniło
          temat diagnostyczny w drugi strumień stanu, którego nikt nie czyta.
        ⚠ Wysyłamy na temat WYBRANEGO obiegu: konto klienta ma prawo pisać tylko u siebie, więc
          diagnostyka jednego klienta nie trafi nigdy w cudze poddrzewo. */
    /*  [audyt WT/QUIC 02.10, docs/36 §11; z quic/audyt-wt b758b1b6] DROGA I LICZNIKI PRÓB WebTransport w dzienniku łącza
        i w reporcie do serwisu - z telefonu w słabym zasięgu widać wprost: ile prób WT powstało, ile padło od ręki, ile
        porzucono, ile razy zastój PUBACK, ile startów wss, ile wybaczeń po zmianie sieci i ile wstrzymanych prób
        (pamięć porażki / dzierżawa innej karty). W mariażu: KTÓRE DROGI ŻYJĄ (TLS / QUIC) i czemu QUIC stoi. Kanał T3
        (nakładka v5) ma dziennik zdarzeń prób włączony domyślnie (ring buffer 400 wpisów w RAM, bez treści i PIN-ów);
        apka/apka2 (Paho 3.1.1) nakładki nie mają - pusty napis i „droga TLS/wss”. */
    if (window.Paho && window.Paho.MQTT_WERSJA === 5 && window.APKA_DIAG_WT === undefined) window.APKA_DIAG_WT = true;
    M.diagWT = () => {
      try {
        if (!window.Paho || !window.Paho._diagWT) return '';
        const L = window.Paho._diagWT().liczniki;
        return ' | WT: utw ' + L.wt_utworzone + ', ready ' + L.wt_ready + ', odrz ' + L.wt_odrzucone + ', porz ' + L.wt_porzucone
             + ', zastoj ' + L.puback_zastoj + ', wstrz ' + (L.proby_wstrzymane || 0) + ' | wss ' + L.wss_starty
             + ' | wybacz ' + L.wybaczenia + '/' + L.wybaczenia_wstrzymane;
      } catch (e) { return ''; }
    };
    const DROGA_SLOWO = { ok: 'niesie', laczy: 'łączy', stop: 'leży' };
    M.drogaOpis = kl => {
      try {
        const d = kl && typeof kl.stanDrog === 'function' ? kl.stanDrog() : null;
        if (d && d.mariaz) {
          const wq = d.szczegoly && d.szczegoly.quic && d.szczegoly.quic.wstrzymany;
          return 'drogi: TLS ' + (DROGA_SLOWO[d.tls] || d.tls) + ', QUIC ' + (DROGA_SLOWO[d.quic] || d.quic) + (wq ? ' (' + wq + ')' : '');
        }
        return /^webtransport:/.test(String((kl && kl.droga) || '')) ? 'droga QUIC/WebTransport' : 'droga TLS/wss';
      } catch (e) { return ''; }
    };
    /*  [Astra zad. 20, DLA_OPUSA_PWA_TLS_QUIC.md; 03.10.2026] REPORTY DIAGNOSTYCZNE Z LIMITEM. Dawniej KAŻDE udane
        połączenie dawało po 4 s linię na `<obiekt>/apka` - przy migającym serwerze zapasowym do 119 meldunków/min
        (próba 02.10), czyli zalew brokera dokładnie wtedy, gdy łącze ledwo dycha. Teraz: krótki report najwyżej raz
        na MELDUNEK_KROTKI_MS; połączenia w tym oknie są LICZONE i wychodzą jednym podsumowaniem („+N połączeń w serii”)
        po końcu okna - seria nie ginie, tylko nie zalewa. Pełny dziennik po zerwaniu jak dotąd najwyżej raz na minutę
        (liczy się też jako krótki). Alarmów sterownika to NIE dotyczy (inny temat, inny nadawca).
        Pseudonim sesji (losowy na wczytanie strony) i numer połączenia serwera: dwa telefony na jednym koncie da się
        odróżnić bez haseł, PIN-ów i treści komend (hipoteza migania 02.10: dwie aplikacje na jednym koncie).
        KONTRAKT TEMATU `<obiekt>/apka` - OPÓŹNIENIE I CZAS ZDARZENIA [Sol A0.12, 04.10; pełny opis: DIAGNOSTYKA.md]:
        to DIAGNOSTYKA HISTORII, nie natychmiastowe zgłoszenie awarii. Zerwanie łącza aplikacja zapisuje u siebie, a wysyła
        dopiero PO POWROCIE (w przerwie nie ma czym): najwcześniej ~4 s po ponownym połączeniu; „+N połączeń w serii”
        do 10 s po ostatnim reporcie; po nieudanej wysyłce liczba czeka na następne połączenie. Chwila odbioru na
        brokerze NIE jest chwilą zdarzenia: czas zdarzeń niosą tylko linie pełnego dziennika (zegar telefonu, HH:MM:SS,
        „połączony ponownie (przerwa N s)”); krótki report niesie liczbę połączeń, bez czasu. */
    const MELDUNEK_KROTKI_MS = 10000;
    const SESJA_PSEUDONIM = Math.random().toString(36).slice(2, 8);
    /*  [Sol A0.12-Z1, A0.12a; 04.10.2026] LICZNIK = PRAWDZIWE POŁĄCZENIA BEZ WŁASNEGO REPORTU. Rejestracja połączenia
        (`meldunekKrotki` - woła je TYLKO onConnected, raz na połączenie) jest oddzielona od opróżniania licznika przez
        zegar końca okna (`_meldunekKoniecOkna` - niczego NIE nalicza). Dawniej zegar wołał meldunekKrotki(false): gdy
        pełny report przesunął okno, stary termin trafiał w NOWE okno i zegar liczył SAM SIEBIE jako połączenie
        (próba Sol: wysyłki [1 s, 0] [3 s pełny, 1] [13 s, 2] - ostatnia liczba powinna być 1).
        Teraz: udana wysyłka zabiera dokładnie liczbę, którą podała, i unieważnia stary termin; nowy termin liczy się
        od BIEŻĄCEGO okna; nieudana wysyłka (także wyjątek) zostawia liczbę RAZEM z połączeniem, które ją wywołało
        (dawniej to jedno ginęło, a okno przesuwało się mimo braku reportu). Nieudane podsumowanie czeka na następne
        połączenie - bez ponawiania w kółko. */
    M._pominiete = 0; M._krotkiLog = 0; M._zbiorczyZegar = null;
    const _meldunekTermin = () => {
      if (M._zbiorczyZegar) clearTimeout(M._zbiorczyZegar);
      M._zbiorczyZegar = setTimeout(M._meldunekKoniecOkna, Math.max(0, M._krotkiLog + MELDUNEK_KROTKI_MS - Date.now()));
    };
    const _meldunekWyslij = (pelny, ile, teraz) => {
      let ok = false;
      try { ok = !!M.wyslijDziennik(pelny, ile); } catch (e) { ok = false; }
      if (ok) {
        M._pominiete -= ile; M._krotkiLog = teraz;
        if (M._zbiorczyZegar) { clearTimeout(M._zbiorczyZegar); M._zbiorczyZegar = null; }   /* stary termin nieważny */
      }
      return ok;
    };
    M._meldunekKoniecOkna = () => {                                 /* koniec okna: podsumowanie serii, BEZ naliczania */
      M._zbiorczyZegar = null;
      if (!M._pominiete) return;
      const teraz = Date.now();
      if (M._krotkiLog && teraz - M._krotkiLog < MELDUNEK_KROTKI_MS) { _meldunekTermin(); return; }   /* okno przesunięte */
      _meldunekWyslij(false, M._pominiete, teraz);
    };
    M.meldunekKrotki = pelny => {                                   /* JEDNO prawdziwe połączenie */
      const teraz = Date.now();
      if (!pelny && M._krotkiLog && teraz - M._krotkiLog < MELDUNEK_KROTKI_MS) {
        M._pominiete++;
        if (!M._zbiorczyZegar) _meldunekTermin();
        return false;
      }
      const ok = _meldunekWyslij(pelny, M._pominiete, teraz);
      if (!ok) M._pominiete++;                                      /* to połączenie też czeka na report */
      return ok;
    };
    M.wyslijDziennik = (pelny, pominiete) => {
      const c = klDla(wybrany);
      if (!wybrany || !c || !c.kl || !c.kl.isConnected()) return false;
      const gl = 'apka ' + (window.APKA_WERSJA || '?')
               + ' | sesja ' + SESJA_PSEUDONIM + ' pol. ' + (c.nrPol || 0)
               + ' | serwery: ' + POL.map(x => (x.nr || 1) + ':' + ((x.stan && x.stan.stan) || '?')).join(' ')
               + ' | obiekt ' + wybrany
               + ' | ' + M.drogaOpis(c.kl) + M.diagWT()
               + (pominiete ? ' | +' + pominiete + ' połączeń w serii (meldunki pominięte, limit ' + (MELDUNEK_KROTKI_MS / 1000) + ' s)' : '');
      /*  ⚠ Znak nowej linii składamy z kodu, nie z literału [D-408a]: zapis `'\n'` w napisie
          padł ofiarą narzędzia, którym wstawiałem tę łatkę — ukośnik zniknął, w pliku został
          PRAWDZIWY przełam wiersza w środku napisu i CAŁY skrypt przestał się wykonywać.
          Objaw był mylący: aplikacja pokazywała dane demonstracyjne i nie otwierała ustawień,
          bo nie wykonał się żaden kod, nie tylko ta funkcja. `String.fromCharCode(10)` jest
          odporny na taką pomyłkę i tak samo robi to reszta tego pliku. */
      const NL = String.fromCharCode(10);
      const dwa = n2 => (n2 < 10 ? '0' : '') + n2;
      /* [audyt WT 02.10] przy PEŁNYM: ostatnie zdarzenia prób nakładki (czas ścienny do zestawienia z dziennikiem bramki) */
      let zdWT = '';
      try {
        if (pelny && window.Paho && window.Paho._diagWT) {
          zdWT = window.Paho._diagWT().zdarzenia.slice(-60).map(z => {
            const d = new Date(z.t);
            return dwa(d.getHours()) + ':' + dwa(d.getMinutes()) + ':' + dwa(d.getSeconds()) + ' WT#' + z.gen + ' ' + z.etap + (z.szcz ? ' ' + String(z.szcz).slice(0, 80) : '');
          }).join(NL);
        }
      } catch (e) {}
      const tresc = pelny
        ? gl + NL + M.dziennik.map(w => {
            const d = new Date(w.t);
            return dwa(d.getHours()) + ':' + dwa(d.getMinutes()) + ':' + dwa(d.getSeconds()) + ' ' + w.txt;
          }).join(NL) + (zdWT ? NL + '--- proby nakladki ---' + NL + zdWT : '')
        : gl;
      try {
        const m = new Paho.Message(tresc); m.destinationName = wybrany + '/apka'; m.qos = 0;
        c.kl.send(m); return true;
      } catch (e) { return false; }
    };

    M.wybierzObiekt = pref => { if (obiekty[pref]) { zmienWybrany(pref); wybranyRecznie = true;
      M.ostSpisSerwerow = _spisWybrany(pref);     /* [D-429] spis idzie za wybranym obiegiem */
      try { localStorage.setItem(KL('mqtt_obiekt'), pref); } catch (e) {} oglos(tempo); oddaj(true); } };
    /*  SPRAWDŹ PIN [2026-09-09, Tomasz: „PIN do serwisu taki, jaki jest ustawiony w sterowniku"]:
        publikuje `pin=` bez `w=` (sterownik nic nie zapisuje, tylko odpowiada, czy PIN pasuje).
        Kod 0 → PIN dobry, zapamiętujemy go do kolejnych zmian serwisowych (bez pytania drugi raz).
        Zwraca 'ok' | 'zle' | <komunikat>. Ekran serwisu w aplikacji woła to przy wejściu, więc PIN
        jest JEDEN — ten ze sterownika. */
    /*  REZERWOWY BROKER — OGLADANIE I ZMIANA Z APLIKACJI  [D-412, Tomasz 2026-09-17: „tak brac"
        (na pytanie, czy robic zmiane rezerwy z aplikacji za PIN-em)]
        ═══════════════════════════════════════════════════════════════════════════════════════
        WEJSCIA:   spis serwerow ze sterownika (`M.ostSpisSerwerow`, D-411), reporty z tematu
                   `zapas`, PIN serwisowy sterownika (ten sam, ktory otwiera menu serwisowe).
        CO Z CZEGO WYNIKA: serwis widzi, co sterownik ma w rezerwie, i moze to zmienic bez
                   podchodzenia do szafy — jednym commandem w tym samym temacie `zadanie`,
                   ktorym aplikacja i tak prosi o dane.
        WYJSCIA:   `M.rezerwa.test() / .ustaw() / .kasuj()` — kazda oddaje ZDANIE STEROWNIKA,
                   nie wlasne „wyslano".

        ⚠ ODPOWIEDZI NIE MA W TEMACIE `wynik`. `zapas:` nie idzie droga komend (tam jest `id`
          i kod liczbowy), tylko droga zadan — a sterownik melduje po polsku tematem `zapas`.
          Zmierzone 17.09: bledny PIN odpowiedzial „zmiana rezerwy wymaga PIN" wylacznie tam.
          Dlatego czekamy na report, a nie na kod.

        ⚠ JEDNYM BROKEREM, NIE WSZYSTKIMI. Zwykle zadania aplikacja rozsyla kazda droga [D-327], bo
          powtorka nic nie kosztuje. Tutaj kosztuje: command doszedlby dwa razy, sterownik dwa razy
          zapisalby NVS i dwa razy oglosil wynik, a czlowiek zobaczylby dwa reporty na jedno
          klikniecie. Command idzie wiec TA droga, ktora obiekt naprawde dociera.

        ⚠ BRAMKI NA SKLADNIE SA PO NASZEJ STRONIE, BO STEROWNIK ICH NIE MA. Rozbiera command
          `strchr(':')` i `strstr(";pin=")`, wiec dwukropek w hasle rozjechalby pola, a srednik
          uciąłby PIN — i to bez zadnego bledu, po prostu zapisalaby sie bzdura. Zamiast tego
          mowimy wprost, czego nie wolno (zasada 10).
          LIMIT DLUGOSCI [sceptyk C, D7 - 02.10.2026]: firmware do sol/c-firmware rozbieral command w `char buf[240]`
          (najwyzej 239 B, dluzszy ucinany PO CICHU), po poprawce Sola S20 bufor = SIEC_ODB_TRESC, czyli tyle, ile
          przyjmuje poczekalnia (247 B; dluzszy odrzucony juz przy odbiorze). Aplikacja tnie WCZESNIEJ: 200 BAJTOW UTF-8
          (nie znakow - polska litera to 2 B, a firmware liczy bajty) - miesci sie w obu firmware'ach z zapasem,
          a najdluzszy prawdziwy command (zapas: adres 64 + konto 32 + haslo 32 + port + PIN) ma ok. 155 B ASCII.

        ⛔ HASLO REZERWY TO HASLO STEROWNIKA DO CUDZEGO BROKERA, nie haslo klienta. Idzie tresci
          commandu, wiec wylacznie po szyfrowanym polaczeniu (aplikacja z Pages laczy sie po wss) i
          NIGDY nie trafia do dziennika lacza — w `zapisz()` ponizej jedzie sam adres. */
    const REZ_ZLE_ZNAKI = /[:;\s]/;
    const rezRozkaz = (tresc, coTxt) => new Promise(res => {
      if (!wybrany) { res('nie wybrano sterownika'); return; }
      const kk = klGot(wybrany);
      if (!kk) { res('brak połączenia z brokerem'); return; }
      const bajty = new TextEncoder().encode(tresc).length;   /* [D7] firmware liczy bajty, nie znaki */
      if (bajty > 200) { res('rozkaz za długi (' + bajty + ' bajtów, mieści się 200)'); return; }
      let oddane = false, zegarek = null;
      const oddaj1 = t => { if (oddane) return; oddane = true;
                            if (zegarek) clearTimeout(zegarek);
                            if (czekaZapas === sluchaj) czekaZapas = null; res(t); };
      /*  ⛔ „SPRAWDZAM…" TO JESZCZE NIE ODPOWIEDZ [poprawka po przegladzie]. Sterownik na jeden
          command mowi dwa razy: najpierw „sprawdzam rezerwe <adres>", a werdykt dopiero po probie
          polaczenia - do 40 s pozniej (ZAP_PROBA_MS w firmware, podniesione tam z 15 na 40 s, bo
          uzgadnianie TLS przy zajetym stacku tyle potrafi trwac). Konczenie na pierwszym zdaniu
          oddawalo przyciski w srodku trwajacej proby: kolejne klikniecie w oknie 3 s ginelo
          w odsiewie powtorek sterownika, a po 3 s wracalo „sprawdzanie juz trwa". */
      const przejsciowy = t => /^sprawdzam /.test(t) || /- sprawdzam$/.test(t);
      const sluchaj = t => { if (!przejsciowy(t)) { oddaj1(t); return; }
                             if (zegarek) clearTimeout(zegarek);
                             zegarek = setTimeout(() => oddaj1('sterownik zaczął sprawdzać, ale nie podał wyniku'), 50000); };
      czekaZapas = sluchaj;
      try {
        const msg = new Paho.Message(tresc); msg.destinationName = wybrany + '/zadanie'; msg.qos = 1;
        kk.send(msg);
      } catch (e) { oddaj1('nie udało się wysłać: ' + e); return; }
      zapisz('rezerwa: ' + coTxt);
      /*  ⚠ TEN SAM COMMAND DWA RAZY W CIAGU 3 s STEROWNIK ODRZUCA W MILCZENIU (SIEC_ODB_DUBEL_MS -
          odsiew powtorki idacej druga droga [D-327]). Przyciski gasna na czas czekania, wiec czlowiek
          tego nie wywola; gdyby jednak doszlo do powtorki, skonczy sie ona naszym „sterownik nie
          odpowiedzial w 15 s" - i to jest uczciwa odpowiedz, bo command naprawde nie zostal wykonany. */
      /*  15 s, nie 5 jak przy komendach: `zapas:test` melduje „sprawdzam…" od razu, ale przy
          zajętym stacku pierwszy report potrafi się spóźnić (uzgadnianie TLS - patrz
          ZAP_PROBA_MS w firmware, podniesione z 15 na 40 s z tego samego powodu). */
      zegarek = setTimeout(() => oddaj1('sterownik nie odpowiedział w 15 s'), 15000);
    });
    /*  PIN: ten sam, ktory otwiera menu serwisowe [2026-09-09, Tomasz: „PIN do serwisu taki, jaki
        jest ustawiony w sterowniku"]. Gdy juz byl podany w tej sesji - nie pytamy drugi raz. */
    const rezPin = () => {
      if (pinSerwis) return pinSerwis;
      const p = prompt('Zmiana rezerwy wymaga PIN-u serwisowego sterownika:', '');
      if (!p) return null;
      pinSerwis = p;      /* gdy zly - sterownik powie to wprost, a nastepna proba zapyta znowu */
      return p;
    };
    M.rezerwa = {
      spis: () => M.ostSpisSerwerow || null,
      ostatni: () => M.ostZapas || null,
      test: () => rezRozkaz('zapas:test', 'sprawdź teraz'),
      kasuj: () => { const p = rezPin(); if (!p) return Promise.resolve('bez PIN-u nic nie zmieniam');
                     return rezRozkaz('zapas:kasuj;pin=' + p, 'skasuj rezerwę')
                            .then(t => { if (/wymaga PIN/.test(t)) pinSerwis = null; return t; }); },
      ustaw: (host, port, user, haslo) => {
        const h = String(host || '').trim().replace(/^mqtts?:\/\//, '').replace(/\/.*$/, '');
        const u = String(user || '').trim(), p = String(haslo || '');
        const nr = parseInt(port, 10);
        /*  ⚠ DLUGOSCI Z FIRMWARE, NIE Z OKA [D-412]: sterownik trzyma adres w 64 znakach, konto
            i haslo w 32 (SIEC_TXT_DLUGI / SIEC_TXT_KROTKI), a caly command kopiuje do bufora 240
            znakow i TNIE BEZ SLOWA (stary firmware; po S20 bufor = SIEC_ODB_TRESC - patrz LIMIT DLUGOSCI wyzej
            przy rezRozkaz; dlugosci pol nizej sa w znakach, a firmware liczy bajty - pola ASCII). Urwalby sie
            wtedy ogon z `;pin=`, a sterownik odpowiedzialby „zmiana rezerwy wymaga PIN" - przy PIN-ie, ktory
            przeciez zostal podany. Wolimy odmowic tutaj i nazwac prawdziwy powod. */
        if (!h) return Promise.resolve('podaj adres brokera rezerwowego');
        if (REZ_ZLE_ZNAKI.test(h)) return Promise.resolve('adres bez dwukropka, średnika i spacji - port wpisz w osobnym polu');
        if (h.length > 64) return Promise.resolve('adres dłuższy niż 64 znaki - sterownik tyle nie zapamięta');
        if (!(nr >= 1 && nr <= 65535)) return Promise.resolve('port poza zakresem 1-65535');
        if (!u) return Promise.resolve('podaj użytkownika, którym sterownik ma się logować');
        if (REZ_ZLE_ZNAKI.test(u)) return Promise.resolve('użytkownik bez dwukropka, średnika i spacji - sterownik rozbiera rozkaz po tych znakach');
        if (u.length > 32) return Promise.resolve('użytkownik dłuższy niż 32 znaki - sterownik tyle nie zapamięta');
        if (!p) return Promise.resolve('podaj hasło sterownika do brokera rezerwowego');
        if (REZ_ZLE_ZNAKI.test(p)) return Promise.resolve('hasło bez dwukropka, średnika i spacji - sterownik rozbiera rozkaz po tych znakach');
        if (p.length > 32) return Promise.resolve('hasło dłuższe niż 32 znaki - sterownik tyle nie zapamięta');
        const pin = rezPin(); if (!pin) return Promise.resolve('bez PIN-u nic nie zmieniam');
        return rezRozkaz('zapas:' + h + ':' + nr + ':' + u + ':' + p + ';pin=' + pin, 'ustaw ' + h + ':' + nr)
               .then(t => { if (/wymaga PIN/.test(t)) pinSerwis = null; return t; });
      },
    };
    M.sprawdzPin = pin => new Promise(res => {
      if (!wybrany || !klGot(wybrany)) { res('brak połączenia z brokerem'); return; }
      const zg = zegar[wybrany];
      const tSter = zg ? Math.floor(zg.czas + (Date.now() - zg.kiedy) / 1000) : Math.floor(Date.now() / 1000);
      const id = nowyId();
      const msg = new Paho.Message('t=' + tSter + ';id=' + id + ';pin=' + pin); msg.destinationName = wybrany + '/komenda'; msg.qos = 1;
      /*  [D-510, 30.09] DWA POZIOMY PIN-U: „PIN OK” = serwisowy (menu serwisowe), „PIN OK klient” = PIN obiektu,
          który otwiera tylko nastawy użytkowe - do menu serwisowego NIE wpuszczamy (zapisy i tak byłyby odrzucane);
          blokada zgadywania ma własny tekst (zasada 10), a nie „zły PIN”. */
      const mój = r => {
        const op = r.opis || '';
        if (r.kod === 0 && /PIN OK klient/.test(op)) res('to PIN obiektu (klienta) - otwiera tylko nastawy użytkowe; menu serwisowe otwiera PIN serwisowy (6 cyfr)');
        else if (r.kod === 0) { pinSerwis = pin; res('ok'); }
        else if (r.kod === 3 && /zablokowany/.test(op)) res('PIN zablokowany po złych próbach - spróbuj za kilkanaście minut');
        else if (r.kod === 3) res('zle');
        else res(op || 'sterownik nie przyjął PIN-u');
      };
      /* [zadanie 13] połączenie sprawdzone PRZED wpisem oczekiwania (dawniej wpis zostawał przy braku klienta), wpis + termin
         PRZED wysyłką, jeden koniec; wyniki zastępcze niosą gotowe zdanie (`pin`) */
      const kk = klGot(wybrany); if (!kk) { res('brak połączenia z brokerem'); return; }
      const op = operacjaKomendy(id, 'PIN', wybrany, r => { if (r && r.pin) res(r.pin); else mój(r); }, 5000, {
        termin: { pin: 'sterownik nie odpowiedział w 5 s' },
        nieWyslano: { pin: 'nie wysłano - brak połączenia z brokerem' },
        bladWysylki: { pin: 'nie wiadomo, czy sprawdzenie PIN-u doszło (błąd przy wysyłce) - spróbuj ponownie za chwilę' } });
      op.wyslij(kk, msg);
    });
    /*  ⚠ Bez retained `blok` obiekt „nie istnieje" dla aplikacji, dopóki sam nie nada —
        a nadaje dopiero po `zadanie`. Zamknięte koło rozcina parametr ?obiekt=
        (znany prefiks → ogłaszamy od razu) albo lista z tematu `status`
        (retained) — subskrybujemy ją, żeby poznać obiekty, które milczą. */
    /* (subskrypcja `status` siedzi w onSuccess razem z resztą - dawny setTimeout 500 ms strzelał
       PRZED CONNACK i padał po cichu w try/catch, więc bez ?obiekt= lista bywała pusta [2026-09-09]) */
    /*  [D-313] `_zrodlo` = wpis brokera, którym właśnie przyszła wiadomość. Paho nie podaje klienta w obsłudze,
        więc ustawiamy to tuż przed wejściem w nią - synchronicznie, więc jest prawdziwe przez cały jej przebieg. */
    let _zrodlo = POL[0];
    const _onMsg = k.onMessageArrived;
    const _obsluga = m => {
      const cz = m.destinationName.split('/');
      if (cz[cz.length - 1] === 'status') {
        const pref = cz.slice(0, -1).join('/');
        if (!obiekty[pref]) obiekty[pref] = { txt: '', kiedy: 0 };
        /*  ⚠ ZASTANY `status` NIE USTANAWIA DROGI [D-428]. Retained lezy na brokerze i przezywa
            odejscie sterownika - wiec „pierwszy, ktory sie odezwal" bywa brokerem, z ktorego
            sterownik dawno poszedl. Swiezy `status` owszem: to znaczy, ze wlasnie tam jest. */
        if (!obiekty[pref].kl && !m.retained) obiekty[pref].kl = _zrodlo;   /* [D-313] */
        /*  STATUS JEST PER BROKER [D-314, zmierzone przy przełączaniu]: gdy sterownik przestaje korzystać z jednego
            serwera, TEN broker ogłasza „offline" z testamentu - a sterownik w najlepsze nadaje drugim. Jeden wspólny
            `status` dawał wtedy czerwoną kropkę przy żywym obiekcie. Liczymy: online, jeśli CHOĆ JEDEN broker tak mówi. */
        const w0 = obiekty[pref]; const st = (m.payloadString || '').trim() || '?';
        (w0.statusy || (w0.statusy = {}))[_zrodlo.nr] = st;
        przeliczStatus(w0);                                  /* tylko z dróg, które żyją [D-481] */
        /*  ⛔ AUTOMATYCZNY WYBOR WOLI OBIEKT, KTORY ZYJE  [D-419, objaw Tomasza: „brak sterownika"
            przy dzialajacym basenie - aplikacja otwarla sadzawke, ktora wlasnie padla]
            Dotad brany byl PIERWSZY obiekt, ktory ogłosil status, bez patrzenia, CO ten status mowi.
            Przy zapamietanym wyborze to bez znaczenia, ale po wyczyszczeniu danych albo na nowym
            telefonie decyduje kolejnosc pakietow retained - czyli nic sensownego. Czlowiek dostaje
            martwy ekran i wnioskuje, ze nie dziala CALOSC, choc drugi obieg nadaje.
            ⚠ TYLKO DOPOKI CZLOWIEK NIE WYBRAL SAM. Gdy wybral - recznie albo pamiecia telefonu -
              nie ruszamy mu ekranu, nawet jesli ten obiekt padnie: wtedy „offline" jest wlasnie ta
              informacja, po ktora siegnal. */
        if (!wybrany) { zmienWybrany(pref); oglos(tempo); }
        else if (!wybranyRecznie && st === 'online') {
          const teraz = obiekty[wybrany];
          if (teraz && teraz.status === 'offline' && pref !== wybrany) {
            zapisz('obiekt ' + wybrany.split('/').slice(1).join('/') + ' jest offline - pokazuje '
                   + pref.split('/').slice(1).join('/') + ', ktory nadaje');
            zmienWybrany(pref); oglos(tempo);
          }
        }
        oddaj(); return;
      }
      _onMsg(m);
    };
/*  OBSLUGA ODEBRANEJ WIADOMOSCI - JEDNO MIEJSCE, TAKZE PO ODNOWIENIU KLIENTA [D-359, audyt Astry 15.09]
    ------------------------------------------------------------
    ⛔ CO BYLO ZLE: `odnowKlienta` (D-354) budowal nowy obiekt biblioteki i wolal `zrobDriver`, ktora
    podpina `onConnectionLost`, `onConnected` i opcje - ALE NIE `onMessageArrived`. Ten byl przypisywany
    RAZ, przy starcie strony, na obiektach z pierwszej listy. Skutek: po kazdym odnowieniu klient melduje
    „polaczony", wykonuje komplet subskrypcji, a ZADNA wiadomosc nie dociera do aplikacji - ekran zostaje
    na ostatnim stanie i nic tego nie zglasza. Poprawka D-354 psula wiec to, co miala naprawic.
    ⚠ Dlatego podpiecie ma jedna nazwe i jest wolane w OBU drogach: przy starcie i w `odnowKlienta`. */
    const podepnijOdbior = c => { const kl = c.kl;
      c.kl.onMessageArrived = m => { if (kl !== c.kl) return;   /* [D-483] spóźniona paczka wycofanego klienta */
                                     _zrodlo = c; c.ostOdbior = Date.now(); _obsluga(m); }; };
    POL.forEach(podepnijOdbior);

    /*  ZAPASY BIERZEMY ZE STEROWNIKA, NIE ZGADUJEMY  [D-411, Tomasz 2026-09-17: „można w aplikacji dać
        zapasowy, żeby kopiował się to, co ma w sterowniku 1 do 1"]
        ------------------------------------------------------------
        WEJSCIA:  retained temat `<prefiks>/serwery` - sterownik wypisuje, czym nadaje i co trzyma
                  w rezerwie (adresy, bez kont i bez hasel).
        CO Z CZEGO WYNIKA: pusty „Zapas 1" w ustawieniach przestaje znaczyc „nie masz rezerwy" -
                  znaczy „jeszcze nie wiem, zapytam sterownika". Po pierwszym polaczeniu aplikacja zna
                  adresy i zapisuje je na nastepny raz.
        WYJSCIA:  nowe polaczenie na liscie POL + zapis w pamieci telefonu (`odbior_mqtt`).

        ⚠ TO JEST ZAMKNIECIE SPRAWY Z D-373/D-410. Adres wbudowany w kod aplikacji byl zly (burza ponowien
          na cudzym brokerze), pusty bez slowa tez byl zly (cisza na zywym, ale pustym brokerze).
          Zrodlem prawdy jest ten, kto naprawde wie: STEROWNIK. Aplikacja pyta, a nie zgaduje.

        ⚠ PORTU NIE PRZEPISUJEMY. Sterownik lapie sie natywnym MQTT (8883), przegladarka WebSocketem
          po TLS (HiveMQ 8884, EMQX 8084) - ta sama nazwa, inna liczba. Bierzemy stad SAM ADRES,
          a port dobiera `adres()` po dostawcy. Przepisanie 1:1 dalo by pukanie w gluchy port.

        ⚠ DZIALAJACEGO NIE ZRYWAMY. Gdy sterownik poda inny adres, a nasze polaczenie o tym numerze
          wlasnie dziala - zapisujemy na nastepne uruchomienie i mowimy o tym w dzienniku. Podmiana
          w locie dotyczy tylko polaczen, ktore i tak nie stoja. */
    /*  [Astra 12] ZAPIS TAM, SKĄD PRZYSZŁO LOGOWANIE: sesja bez „zapamiętaj" żyje w sessionStorage (ten sam klucz
        z przedrostkiem aplikacji) - poprawka adresu trafia do niej i znika z kartą; zapamiętane - do localStorage. */
    const zapiszUstawienie = (pole, wart) => {
      try { const mag = sessionStorage.getItem(KL('odbior_mqtt')) ? sessionStorage : localStorage;
            const z = JSON.parse(mag.getItem(KL('odbior_mqtt')) || 'null');
            if (!z || z[pole] === wart) return false;
            z[pole] = wart; mag.setItem(KL('odbior_mqtt'), JSON.stringify(z)); return true;
      } catch (e) { return false; }
    };
    const dodajSerwer = (nr, host, powod) => {
      const a = adres(host);
      const user = nr === 2 ? (o.user2 || _kontoZap(2)) : (o.user3 || _kontoZap(3));
      if (!a.host || !user) return;
      const c = { nr, host: a.host, port: a.port, user,
                  pass: (nr === 2 ? (o.pass2 || o.pass) : (o.pass3 || o.pass)),
                  temat: (nr === 2 ? (o.temat2 || o.temat) : (o.temat3 || o.temat)),
                  tematy: (nr === 2 ? (o.temat2 ? [o.temat2] : o.tematy) : (o.temat3 ? [o.temat3] : o.tematy)) };
      c.kl = new Klient(c.host, c.port, '/mqtt', cid + '-' + nr);
      c.stan = { stan: 'laczy', opis: 'lacze z brokerem…' };
      POL.push(c); POL.sort((x, y) => x.nr - y.nr);
      zrobDriver(c); podepnijOdbior(c);
      M.rezerwaBrak = (POL.length < 2);
      zapisz('serwer ' + nr + ': ' + c.host + ':' + c.port + ' jako ' + user + ' (' + powod + ')');
      c.polaczTeraz(powod);
    };
    /*  ⚠ POZYCJA W SPISIE STEROWNIKA TO NIE POZYCJA W APLIKACJI [zmierzone 17.09, pierwsze ogloszenie
        spisu z basenu]: sterownik podal `glowny 192.168.1.39` i `zapas1 192.168.1.39` - oba adresy
        domowe, bo on siedzi w tej samej sieci co broker. Aplikacja chodzi z Pages po HTTPS i z drogi
        zadnego z nich nie uzyje. Dlatego nie przepisujemy „slot na slot", tylko bierzemy z calego
        spisu te adresy, KTORYCH DA SIE UZYC (`lan:0`), i ustawiamy je po kolei jako Zapas 1 i 2.
        ⚠ STEROWNIK WYGRYWA Z WPISANYM RECZNIE - i tak ma byc [wytyczna: „zeby kopiowal sie to, co
        ma w sterowniku 1 do 1"]. Recznie wpisany zapas jest ziarnem na czas, zanim sterownik sie
        odezwie; potem obowiazuje to, co on mowi. Kazda taka zmiana idzie do dziennika lacza, zeby
        nie byla cicha. */
    const spisSerwerow = (tekst, pref, zastany) => {
      let s = null; try { s = JSON.parse(tekst); } catch (e) { return; }
      if (!s) return;
      /*  ⛔ SPIS JEST WLASNOSCIA OBIEGU, NIE APLIKACJI [D-426a]. Jedno wspolne pole znaczylo, ze ekran
          basenu pokazywal spis sadzawki - ten, ktory przyszedl ostatni. Konto serwisowe oglada
          kilka obiegow naraz, wiec to nie jest przypadek brzegowy, tylko codziennosc. */
      /*  [D-429] spis jest wlasnoscia OBIEGU I DROGI - kazdy broker ma wlasna kopie i wlasny wiek. */
      const nrD = (_zrodlo && _zrodlo.nr) || 0;
      (_spisy[pref] || (_spisy[pref] = {}))[nrD] = { s, kiedy: Date.now(), zastany: !!zastany };
      if (pref === wybrany) M.ostSpisSerwerow = _spisWybrany(pref);
      /*  ⚠ ZASTANY SPIS BYWA SPRZED ZMIANY FIRMWARE [D-426]. Gdy brakuje w nim pola, ktorego
          potrzebujemy do opisania slotow (`pol` = czy sterownik ma tam polaczenie), prosimy
          sterownik o swiezy - raz, zeby nie robic z tego petli. Milczenie o stanie slotu jest
          lepsze niz falsz, ale gorsze niz odpowiedz. */
      if (s.glowny && s.glowny.pol === undefined && !M._spisProszony) {
        M._spisProszony = true;
        try { const kk = klGot(wybrany); if (kk) { const m = new Paho.Message('serwery');
              m.destinationName = wybrany + '/zadanie'; kk.send(m);
              zapisz('spis serwerow bez stanu slotow - proszę sterownik o świeży'); } } catch (e) {}
      }
      /*  KTORYM SLOTEM STEROWNIKA JEST TA DROGA - patrz uzasadnienie przy `niesieNr`. */
      if (_zrodlo && s.ja) { _zrodlo.slot = s.ja;
        if (_zrodlo.slotOst !== s.ja) { _zrodlo.slotOst = s.ja;
          zapisz(etyk(_zrodlo) + 'to jest slot ' + s.ja + ' sterownika'); } }
      /*  [Astra 12] PUNKT KOŃCOWY = transport + host + port efektywny + ścieżka, nie sam host. Stary broker
          (8886/8887) i broker v5 (8888/8889) stoją pod TĄ SAMĄ nazwą - porównanie po hoście sklejało je w jeden
          serwer i drugi nigdy nie wchodził. Sterownik podaje port NATYWNY; aplikacja łączy się WebSocketem po TLS, więc:
          znane pary naszych brokerów tłumaczymy wprost, reszta po dostawcy (adres()), a wpis bez TLS pomijamy
          (aplikacja zna tylko wss - zwykłe TCP i tak by nie wstało). */
      const WS_Z_NATYWNEGO = { 8886: 8887, 8888: 8889 };
      const kluczPK = a => 'wss://' + String(a.host || '').toLowerCase() + ':' + a.port + '/mqtt';
      const nasz = kluczPK(adres(o.host, o.port));
      const kand = [], kandKl = [];
      ['glowny', 'zapas1', 'zapas2'].forEach(k => {
        const w = s[k]; const h = ((w && w.host) || '').trim();
        if (!h || (w && w.lan)) return;                       /* pusto albo adres domowy - nie dla aplikacji */
        if (w && w.tls === 0) return;                         /* bez TLS - nie dla przeglądarki */
        const a = adres(h);
        if (w && WS_Z_NATYWNEGO[w.port]) a.port = WS_Z_NATYWNEGO[w.port];
        const kl = kluczPK(a);
        if (kl !== nasz && kandKl.indexOf(kl) < 0) { kandKl.push(kl); kand.push(a.host + ':' + a.port); }   /* glownego nie dublujemy */
      });
      [2, 3].forEach((nr, i) => {
        const host = kand[i];
        if (!host) return;                    /* sterownik nie ma tylu uzytecznych adresow */
        const nowy = adres(host);
        const c = POL.find(x => x.nr === nr);
        if (c && kluczPK(c) === kluczPK(nowy)) return;         /* juz to mamy - cisza */
        zapiszUstawienie(nr === 2 ? 'host2' : 'host3', host);
        if (!c) { dodajSerwer(nr, host, 'spis ze sterownika'); return; }
        if (c.stan.stan === 'ok') {
          zapisz('serwer ' + nr + ': sterownik podaje ' + nowy.host + ', a obecny (' + c.host
                 + ') dziala - zmieniam po ponownym uruchomieniu apki');
          return;
        }
        zapisz('serwer ' + nr + ': sterownik podaje ' + nowy.host + ' zamiast ' + c.host + ' - podmieniam');
        if (c.ponowZegar) { clearTimeout(c.ponowZegar); c.ponowZegar = null; }
        try { if (c.kl.isConnected()) c.kl.disconnect(); } catch (e) {}
        try { if (c.gniazdo) c.gniazdo.close(); } catch (e) {}
        Object.keys(obiekty).forEach(p => { if (obiekty[p].kl === c) obiekty[p].kl = null; });
        POL.splice(POL.indexOf(c), 1);
        dodajSerwer(nr, host, 'zmiana w sterowniku');
      });
    };

    /*  GUARD CISZY - MARTWE GNIAZDO UDAJE POLACZENIE [D-355, 2026-09-13]
        ------------------------------------------------------------
        WEJSCIA:  czas ostatniej paczki z kazdego brokera (`c.ostOdbior`), stan biblioteki.
        CO Z CZEGO WYNIKA: gdy biblioteka TWIERDZI, ze jest polaczona, a od brokera nie przyszlo nic
                  przez STRAZNIK_CISZY_MS - uznajemy lacze za martwe i budujemy klienta OD ZERA.
        WYJSCIA:  wpis w dzienniku + nowe polaczenie.

        ⛔ PO CO, skoro mamy juz ponawianie [Tomasz 13.09: „aplikacja laczy sie ok, ale podczas pracy jak
        straci internet, juz sie ponownie nie polaczy - trzeba PWA restartowac i laczy sie od razu";
        na ekranie stalo „sterownik online, ale ostatni pakiet 312 s temu"]:
        `polaczTeraz` zaczyna sie od `if (!c.kl || c.kl.isConnected()) return;`. Gdy telefon traci
        internet, gniazdo TCP NIE ZAMYKA SIE od razu - biblioteka dalej uwaza, ze jest polaczona,
        `onConnectionLost` nie przychodzi, wiec CALE ponawianie jest wylaczone. Aplikacja wie, ze od pieciu
        minut nic nie dostala (pokazuje to na ekranie!), i nie robi z ta wiedza nic.
        ⚠ PROG MUSI BYC WIEKSZY NIZ KEEPALIVE (30 s), zeby nie zrywac lacza, ktore po prostu milczy,
        bo nikt nie prosi o ciezkie tematy. Liczymy KAZDA paczke, takze lekka - przy zywym brokerze
        cisza dluzsza niz minuta nie zdarza sie nawet wtedy, gdy sterownik nie nadaje: idzie keepalive
        i odpowiedzi na subskrypcje.
        ⚠ Guard chodzi tylko wtedy, gdy KARTA JEST WIDOCZNA - w tle przegladarka i tak dlawi
        liczniki, a telefon w kieszeni nie musi trzymac lacza. */
    const STRAZNIK_CISZY_MS = 75000;
    setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      const teraz = Date.now();
      POL.forEach(c => {
        if (!c.kl || !c.kl.isConnected()) return;
        /*  ⛔ CISZA NIE ZAWSZE ZNACZY AWARIE [D-359 -> D-363, dwa audyty Astry].
            `ostOdbior` rosnie WYLACZNIE od wiadomosci z tematow; PINGRESP i SUBACK go nie ruszaja -
            sprawdzone na samej bibliotece. Sa wiec trzy powody ciszy, przy ktorych lacze jest ZDROWE:
              1. sterownik jest WYLACZONY albo offline - wtedy nikt nic nie nadaje zadna droga;
              2. sterownik kieruje ciezkie tematy JEDNA droga [D-315] - druga milczy z zalozenia;
              3. dopiero co sie polaczylismy - nie zdazylo przyjsc nic.
            ⛔ PIERWSZA WERSJA PYTALA O `c.lekki` i to bylo zle [audyt Astry 15.09]: `lekki` staje sie
            falszem po KAZDYM polaczeniu (onSuccess), a prawda dopiero po pieciu duplikatach - wiec
            cicha rezerwa, ktora duplikatow nigdy nie zbierze, byla uznawana za „niosaca" i zrywana.
            Pytamy teraz o to, CO SAMI ZAMOWILISMY: `niesieOst` to ostatnie zadanie wyslane do
            sterownika - 0 znaczy „nadawaj równolegle" (wiec obie drogi maja co przynosic), a numer znaczy
            „nadawaj tym jednym". Do tego sprawdzamy, czy sterownik w ogole jest online. */
        const ob = wybrany && obiekty[wybrany];
        const sterownik_zywy = !!ob && ob.status !== 'offline';
        const ma_przynosic = (klDla(wybrany) === c) || (niesieOst === 0);
        if (!sterownik_zywy || !ma_przynosic) { c.ostOdbior = teraz; return; }
        if (!c.ostOdbior) { c.ostOdbior = teraz; return; }
        if (teraz - c.ostOdbior < STRAZNIK_CISZY_MS) return;
        zapisz(etyk(c) + 'cisza ' + Math.round((teraz - c.ostOdbior) / 1000) + ' s, choć połączenie zgłasza gotowość - dane nieaktualne, buduję klienta od nowa');
        if (odnowKlienta(c)) { c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.polaczTeraz('martwe łącze'); oddaj(); }
      });
    }, 15000);

    /*  POWROT SIECI - PROBUJEMY OD RAZU [D-355]
        Przegladarka mowi wprost, kiedy sieć wraca. Bez tego aplikacja czekala na swoj odstep, a po serii
        nieudanych prob potrafil on urosnac - czlowiek patrzy na „laczę ponownie…", chociaz internet
        jest juz od kilkunastu sekund. */
    window.addEventListener('online', () => {
      zapisz('sieć wróciła - próbuję od razu');
      POL.filter(c => !c.kl.isConnected()).forEach(c => {
        c.odstepNr = 0; c.stan = { stan: 'laczy', opis: 'łączę ponownie…' }; c.polaczTeraz('powrót sieci'); });
      oddaj();
    });
    window.addEventListener('offline', () => zapisz('telefon zgłasza brak sieci'));
  };

  window.MOST_JS = M;
})();

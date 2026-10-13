# Roadmap

## ✅ Etap 0 — audyt i plan (2026-10-13)

## ✅ Etap 1 — grywalny fundament (2026-10-13)
Arena, ruch, kolizje, auto-atak ze stabilnym celem, unik, Rozłam, telegrafy, efekty, sterowanie dotykowe, PWA.

## ✅ Etap „dungeon crawler” (2026-10-13) — zakres Etapów 2–5 przyspieszony na prośbę właściciela
Zgłoszenie: chodzenie nierówne, miał być dungeon crawler, wybór postaci i umiejętności, brak dźwięku,
brak statystyk z ulepszaniem.
- [x] naprawa płynności ruchu (4 przyczyny — patrz GAME_DESIGN „Płynność ruchu”) + test regresyjny
- [x] proceduralne podziemia: 3 piętra, 6 typów komnat (wejście, walka, elita, skarbiec, kapliczka, strażnica schodów),
      kraty w drzwiach, mgła, minimapa, seed, walidacja przechodniości (180 pięter w teście bez błędu)
- [x] 2 klasy bohaterów, 4 umiejętności, wybór przed wyprawą
- [x] trzeci typ wroga: Akolita (dystans, pociski)
- [x] XP, poziomy, wybór 1 z 3 spośród 15 ulepszeń, skrzynie, kapliczki, popiół
- [x] karta statystyk (pauza / klawisz C)
- [x] Sanktuarium: stałe rangi statystyk za popiół, zapis IndexedDB (wersja, kopia, obsługa uszkodzenia)
- [x] dźwięk: ambient podziemi + ~25 sygnałów, poprawki iOS (tryb cichy, wznowienie po przerwaniu)
- [x] boty balansujące całą wyprawę dla obu klas
- [x] 87 testów logiki, 12 testów przeglądarkowych (desktop, telefon pion, telefon poziom)

**Do sprawdzenia na fizycznym telefonie:** płynność ruchu po poprawkach, dźwięk na iPhonie (w tym z włączonym
trybem cichym — działa tylko na iOS 17+), wygoda kciuków w pionie i poziomie, instalacja PWA, wibracja.

**Znane ograniczenia:** grafika to proceduralne placeholdery; brak bossa (ostatnie piętro kończy strażnica);
boty w testach kitują słabiej niż człowiek, więc balans Wędrowca wymaga potwierdzenia w prawdziwej grze.

## ⏭ Następny etap — boss i różnorodność
- Strażnik Pustej Korony na 3. piętrze: 2 fazy, wzorce ataków, okna kontry
- wrogowie: szarżujący (linia szarży), wspierający (tarcza dla innych)
- relikty (pasywne efekty z rzadkich skrzyń), pierwsze przedmioty
- samouczek pierwszej komnaty

## Później
Kuźnia i Archiwum w bazie, talenty, więcej typów komnat (pułapki, wyzwania z nagrodą za ryzyko),
finalna oprawa i muzyka, testy wydajności na słabszych telefonach, polish i balans.

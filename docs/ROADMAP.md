# Roadmap

## ✅ Etap 0 — audyt i plan (2026-10-13)

## ✅ Etap 1 — grywalny fundament (2026-10-13)
Arena, ruch, kolizje, auto-atak ze stabilnym celem, unik, Rozłam, telegrafy, efekty, sterowanie dotykowe, PWA.

## ✅ v0.2 — dungeon crawler (2026-10-13)
Proceduralne podziemia (3 piętra, 6 typów komnat, kraty, mgła, minimapa), 2 klasy × 2 umiejętności, Akolita,
XP i 15 ulepszeń, karta postaci, Sanktuarium + zapis IndexedDB, dźwięk, poprawki płynności ruchu.

## ✅ v0.3 — ekwipunek, bossowie, biomy (2026-10-13)
- [x] joystick: pełna prędkość także z palcem daleko poza obwodem (błąd 1/odległość) + pływająca baza + testy
- [x] ekwipunek: 5 slotów, 15 typów bazowych (broń zależna od klasy), 4 rzadkości, poziom przedmiotu = piętro
- [x] 12 legendarnych z efektami: ogień, Skorupa mrozu (zamraża atakujących, odnowienie 10 s), łańcuch błyskawic,
      wysysanie, ciernie, bariera, popielny krok, rozpad, szał, egzekucja
- [x] łup z wrogów, skrzyń i bossów (z promieniem w kolorze rzadkości), ekran ekwipunku z porównaniem statystyk,
      rozbieranie na popiół, ekwipunek trwały (zapis v2 z migracją v1)
- [x] 3 bossowie z 2 fazami (Strażnik Krypt, Królowa Szronu, Pusty Król), pasek zdrowia, nagrody, schody po walce
- [x] 3 biomy: Krypty Popiołu (kolce), Lodowe Groby (lód, Ogar Szronu szarżujący po linii),
      Kuźnie Otchłani (lawa, kraty ognia, Ogniomistrz rzucający bomby)
- [x] opóźnione wybuchy z telegrafem (meteory, lodowe kolce, bomby), szarże, pierścienie pocisków
- [x] 114 testów logiki (w tym 22 nowe), 18 testów przeglądarkowych (desktop, telefon pion i poziom)

**Do sprawdzenia na telefonie:** joystick po poprawce, czytelność telegrafów bossów, wygoda ekranu ekwipunku.

**Znane ograniczenia:** grafika nadal proceduralna; boty balansujące nie zakładają ekwipunku (sprzęt to progresja);
bossowie bazują na sylwetkach zwykłych wrogów w większej skali.

## ⏭ Następny etap — propozycje
- relikty (pasywne dary z rzadkich komnat), ulepszanie przedmiotów w Kuźni za popiół
- więcej typów komnat: wyzwanie (fala za lepszą nagrodę), pułapkowy korytarz, sklep
- wrogowie wspierający (tarcza dla innych), elitarne warianty z modyfikatorami
- samouczek pierwszej komnaty, finalna oprawa i muzyka

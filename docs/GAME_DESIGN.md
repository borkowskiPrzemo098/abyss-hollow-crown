# ABYSS: The Hollow Crown — Game Design

## Filar
**Auto-atak ≠ auto-gra.** Bohater sam uderza najbliższy cel w zasięgu, ale wygrywa ten, kto ustawia
się dobrze, czyta telegrafy, unika w odpowiednim momencie, zarządza cooldownami i wybiera moment na
umiejętność. Pilnują tego boty w testach: `tests/design.test.ts` (fale na arenie) i `tests/run.test.ts`
(cała wyprawa przez 3 piętra) — gracz stojący w miejscu musi wyraźnie przegrywać z grającym.

## Świat i ton
Upadłe królestwo, ruiny pod powierzchnią, pusta korona. Pod ruinami ciągną się podziemia; coś na ich
dnie „wydrąża” ludzi i ciągnie ich ku górze. Historia z otoczenia i krótkich tekstów, nie z długich dialogów.

**Język wizualny:** zimny kamień, kość/popiół na neutralne elementy, **ember (pomarańcz)** = bohater, jego
światło, ataki, nagrody; **hollow (turkus)** = zepsucie, oczy i rany wrogów, dusze; **czerwień** = wyłącznie
zagrożenie (telegrafy, pociski wrogów, kraty zamkniętych drzwi, HP). Fonty: Grenze Gotisch (tytuły),
Alegreya Sans (UI, cyfry tabularne).

## Pętla (zaimplementowana)
1. **Menu** → Nowa wyprawa → **wybór bohatera** (2 klasy) → **wybór umiejętności** (2 na klasę).
2. **Proceduralne podziemia**: 3 piętra, każde to 7–9 komnat połączonych korytarzami, odkrywanych w trakcie
   eksploracji (mgła + minimapa izometryczna).
3. Wejście do komnaty walki **zamyka kraty**; 1–3 fale wrogów; po oczyszczeniu kraty się otwierają,
   wypada popiół, bohater odzyskuje 12% zdrowia.
4. **XP** z wrogów → nowy poziom → **wybór 1 z 3 ulepszeń**. **Skrzynie** (skarbiec, legowisko elity) też dają
   wybór 1 z 3, częściej rzadkie dary. **Kapliczka** leczy 50% raz na piętro.
5. **Strażnica schodów** (najgłębsza komnata) ma najtrudniejsze spotkanie; po nim schody prowadzą niżej.
   Po 3. piętrze — wyjście na powierzchnię = zwycięstwo.
6. Śmierć: zachowujesz 60% popiołu. Zwycięstwo: 100% + 40 premii.
7. **Sanktuarium**: popiół → stałe rangi statystyk (działają na obu bohaterów). Zapis w IndexedDB.

## Bohaterowie
| | Strażnik Popiołu | Wędrowiec Otchłani |
|---|---|---|
| Styl | zwarcie, cięcie wielu wrogów | dystans, odłamki, kitowanie |
| HP / pancerz | 120 / 10% | 95 / 0% |
| Atak | 14 co 0,72 s, zasięg 1,45, cleave 50% w 80° | odłamek 11 co 0,52 s, zasięg 4,6 |
| Ruch | 4,0 | 4,5 |
| Unik | 2,6 kafla, cd 1,1 s | 3,1 kafla, cd 0,9 s |
| Umiejętności | **Rozłam** (AoE wokół, odrzut, ogłuszenie, przerywa ataki) · **Szarża** (taran na linii, nietykalność) | **Salwa Odłamków** (wachlarz 7 przebijających odłamków) · **Pieczęć Pustki** (strefa: −50% prędkości wrogów + obrażenia przez 4 s) |

## Statystyki (karta postaci w pauzie / klawisz C)
Zdrowie, obrażenia, szybkość ataku, zasięg, szybkość ruchu, redukcja obrażeń (maks. 60%), szansa na krytyk
(maks. 75%), mnożnik krytyka, odnowienie umiejętności. Wyliczane w jednym miejscu (`src/sim/stats.ts`):
klasa → rangi Sanktuarium → ulepszenia z wyprawy.

## Ulepszenia z wyprawy (15, każde z limitem stosów)
Statystyczne: +obrażenia, +szybkość ataku, +zdrowie (z leczeniem), +ruch, +krytyk, +obrażenia krytyczne,
+redukcja, −odnowienie, +zasięg. Specjalne: **Przeszywające odłamki** (Wędrowiec), **Szeroki zamach**
(Strażnik), **Żarłoczny popiół** (leczenie za zabójstwo), **Kruche dusze** (wybuch przy śmierci wroga, bez
reakcji łańcuchowej), **Ostatni bastion** (+35% obrażeń poniżej 35% HP), **Kontra z przewrotu** (pierwszy
atak po uniku +100% i krytyk).

## Rangi Sanktuarium (stałe)
Witalność +10 HP (5 rang) · Siła +6% obrażeń (5) · Zręczność +5% szybkości ataku (5) · Zwinność +4% ruchu (3)
· Hart +4% redukcji (4) · Precyzja +3% krytyka (4). Koszty rosną (15 → 150 popiołu).

## Przeciwnicy
| | Wydrążony | Akolita Popiołu | Popielny Kolos |
|---|---|---|---|
| Rola | szybki rój, otacza | dystans, trzyma odległość | wolny czołg, karze błędy |
| Atak | stożek 100° (10 dmg) | ognisty pocisk po linii (11 dmg) | koło przed sobą (28 dmg) |
| Telegraf | 0,6 s | 0,85 s, czerwona linia aż do ściany | 1,0 s |
Pociski wrogów można przeskoczyć unikiem. Lekkie ciosy nie przerywają zamachu (Rozłam/Szarża tak).
Po ciosie faza odpoczynku = okno kontry. Z każdym piętrem: +30% HP, +15% obrażeń wrogów.

## Płynność ruchu (poprawione po zgłoszeniu „raz szybciej, raz wolniej”)
- joystick: pełna prędkość już od ~45% wychylenia (wcześniej liniowo),
- prędkość wyrównana między kierunkami ekranu (izometria 2:1 dawała 2× różnicę → teraz ~1,2×; tak samo dla wrogów),
- brak zamrożeń przy zwykłych trafieniach (hit-stop tylko przy krytykach i umiejętnościach),
- kamera wygładzana niezależnie od liczby klatek.

## Ekwipunek (v0.3)
5 slotów: broń (Strażnik: miecz/topór/buzdygan; Wędrowiec: laska/różdżka/kostur), hełm, zbroja, amulet, pierścień.
Rzadkości: zwykły (1 cecha), rzadki (2), epicki (3), legendarny (3 + unikalny efekt). Liczby rosną z poziomem przedmiotu
(= piętro, na którym wypadł). Przedmioty zostają między wyprawami; nadmiar rozbijasz na popiół. Szczegóły i wartości: `src/config/items.ts`.

## Poziomy podziemi (v0.3)
| Piętro | Biom | Nowi wrogowie | Pułapki | Boss |
|---|---|---|---|---|
| 1 | Krypty Popiołu | — | kolce (cykl 3,2 s, ostrzeżenie czerwienią) | Strażnik Krypt: zamach, uderzenie, szarża; faza 2: pierścień ognia, wezwanie umarłych |
| 2 | Lodowe Groby | Ogar Szronu (szarża po zaznaczonym pasie) | lód (ślizganie) | Królowa Szronu: pierścienie odłamków, spadający lód, ogary; faza 2: gęściej + mroźny oddech |
| 3 | Kuźnie Otchłani | Ogniomistrz (bomba na twoją pozycję) | lawa, kraty ognia | Pusty Król: ostrze, deszcz ognia, szarża; faza 2: pierścień, więcej meteorów, przywołania |
Pułapki ranią także wrogów. Boss w połowie zdrowia ryczy (chwilowo odporny) i przechodzi w drugą fazę.

## Jeszcze nie ma (kolejne etapy)
Relikty, ulepszanie przedmiotów, wrogowie wspierający, talenty, Kuźnia i Archiwum w bazie, samouczek,
finalna grafika i muzyka.

## Umiejętności (v0.4, etap 1 rozbudowy)
Każda klasa ma 10 umiejętności (`src/config/skills.ts`), gracz nosi do 3 naraz (przyciski 1–3, klawisze E/R/F).
Dwie startowe na klasę są dostępne od początku, pozostałe odblokowują się postępem **danej klasy** (wyprawy, zabici wrogowie,
najgłębszy poziom, wygrane) — wymagania w `unlock` każdej umiejętności. Wyposażenie jest zapisane per klasa (zapis v3)
i sprawdzane przy wczytaniu (`src/meta/loadout.ts`). Po każdym rzucie wszystkie sloty blokują się na 0,2 s.
Umiejętności celowane (Miażdżący Cios, Strzał Przeszywający, Gwiezdny Deszcz) nie odpalają się bez wroga i nie zużywają odnowienia.
Jeszcze nie ma: ulepszeń zmieniających działanie umiejętności i synergii (osobne etapy).

## Ulepszenia umiejętności (v0.4, etap 2)
Każda z 20 umiejętności ma 2–4 własne ulepszenia (71 w sumie, `src/config/skillUpgrades.ts`), po 1–2 poziomy.
Zdobywa się je w trakcie wyprawy, obok zwykłych ulepszeń statystyk: awans daje 1 kartę ulepszenia umiejętności i 2 karty statystyk,
skrzynia 2 karty umiejętności i 1 statystykę (tylko dla noszonych umiejętności, najpierw różnych). Karty ulepszeń są turkusowe
i pokazują dokładne liczby („+20% → +40%"). Ulepszenie to dane: lista poziomów, a każdy poziom to *suma* modyfikatorów
(obszar, pociski, przebijanie, wybuch, płonąca ziemia, podpalenie, spowolnienie, ogłuszenie, egzekucja, kontrola, skrócenie
odnowienia, fala po trafieniu, echo, wybuch na końcu, leczenie, kradzież życia…). Silnik zna każdy modyfikator raz.
Limity: tylko tyle poziomów, ile wpisano; suma modyfikatorów jednej umiejętności jest ograniczona (`MOD_CAPS`); odnowienie
nigdy poniżej 30% bazowego. Stan ulepszeń należy do wyprawy (tak jak zwykłe ulepszenia); do zapisu (v4) trafia **kodeks**:
które ulepszenia gracz już znalazł (widać go na ekranie wyposażenia). Synergii między umiejętnościami jeszcze nie ma.

## Statusy i reakcje (v0.4, etap 3)
Pięć statusów na wrogach (`src/config/statuses.ts`, wszystkie liczby tam): **podpalenie** (3 s, nie sumuje się), **krwawienie**
(4 s, do 3 stosów), **spowolnienie**, **zamrożenie/ogłuszenie** (twarde CC) i **oznaczenie** (6 s, maks. 4 naraz).
Twarde CC ma górny limit (3 s, boss 0,8 s), nie da się go przedłużać w nieskończoność i po zakończeniu wróg jest odporny
(0,8 s, boss 5 s). Boss: krwawi na pół, spowolnienie tylko 15%.
Reakcje: **Rozerwanie** (Szarża, Rzut Toporem, Wir Ostrzy → krwawienie; Rozłam i Miażdżący Cios zużywają stosy),
**Rozdmuchanie** (Okrzyk Wojny roznosi podpalenie, maks. 4 naraz, ograniczone pokoleniami), **Burza znaku** (Strzał Przeszywający
i Gwiezdny Deszcz oznaczają; Salwa, Strzał, Wartownik, Przeciążenie wyzwalają łuk błyskawicy: 0,6 s na znak, wspólny budżet
6/s), **Rozbicie** (Miażdżący Cios, Strzał, Mina ×1,6 na zamrożonym i lód pęka), **Pułapka z uniku** (ulepszenie „Mina w Przewrocie”).
Obrażenia z reakcji nie wywołują kolejnych reakcji.

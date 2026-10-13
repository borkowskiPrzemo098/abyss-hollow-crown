# ABYSS: The Hollow Crown — Game Design

## Filar
**Auto-atak ≠ auto-gra.** Bohater sam uderza najbliższy cel w zasięgu, ale wygrywa ten, kto:
ustawia się dobrze, czyta telegrafy, unika w odpowiednim momencie, zarządza cooldownami
i wybiera moment na umiejętność. Stanie w miejscu musi przegrywać — pilnuje tego test
`tests/design.test.ts` (bot bierny vs bot grający).

## Świat i ton
Upadłe królestwo, ruiny pod powierzchnią, pusta korona. Korona od stu lat nie ma właściciela;
coś na dnie Otchłani „wydrążyło” ludzi i ciągnie ich ku górze. Historia z otoczenia, krótkich
dialogów i opisów przedmiotów — nie z długich tekstów.

**Język wizualny (obowiązuje w całej grze):**
- kamień zimny i ciemny (`stone0–5`), kość/popiół na neutralne elementy czytelne,
- **ember (pomarańcz)** = bohater, jego światło, jego ataki, nagrody,
- **hollow (turkus)** = zepsucie, oczy i rany wrogów, dusze,
- **czerwień** = wyłącznie zagrożenie (telegrafy ataków, HP bohatera).
Fonty: Grenze Gotisch (tytuły, banery), Alegreya Sans (HUD, liczby — tabularne).

## Pętla docelowa
Baza → wybór bohatera/wyposażenia → proceduralny loch (pomieszczenia) → walka, nagrody,
wybory buildu → boss albo śmierć → powrót do bazy z trwałymi zasobami → odblokowania → kolejna wyprawa.
Na Etapie 1 istnieje tylko arena z falami (rdzeń walki).

## Walka — stan zaimplementowany (Etap 1)

### Bohater: Strażnik Popiołu (wojownik)
| Parametr | Wartość |
|---|---|
| HP | 100 |
| Obrażenia | 14 (krytyk 12% ×1.8) |
| Atak | co 0.72 s, wind-up 0.11 s, zasięg 1.45 kafla, **cleave** 50% w łuku 80° |
| Ruch | 4.2 kafla/s |
| Unik | 2.7 kafla w 0.3 s, nietykalność 0.24 s, cooldown 1.05 s, bufor wciśnięcia 0.15 s |
| Po trafieniu | 0.45 s litości (nie da się dostać dwa razy z rzędu) |

**Targeting (stabilny):** najbliższy cel w zasięgu + 0.35, z linią wzroku. Aktualny cel trzymany do
zasięgu + 0.9; zmiana tylko gdy inny jest wyraźnie bliżej (×0.6) i minęło 0.5 s, albo gdy aktualny
wyszedł z zasięgu, a inny jest w zasięgu. Marker: pomarańczowy pierścień + strzałka nad głową
(przygaszony, gdy cel jest poza zasięgiem uderzenia).

**Umiejętność: Rozłam.** 0.28 s zamachu (bohater stoi — to zobowiązanie), potem uderzenie w promieniu
2.4: 260% obrażeń, odrzut, ogłuszenie 1.1 s, **przerywa wind-upy wrogów**. Cooldown 7.5 s.
Decyzja: użyć teraz na tłum, czy zachować na przerwanie ciosu Kolosa?

Unik anuluje zamach ataku, ale zwraca większość cooldownu ataku — unikanie nie karze DPS-u.
Hit-stop 35–80 ms, błysk trafionego, odrzut, iskry, liczby obrażeń, wstrząs kamery przy krytyku/Rozłamie.

### Przeciwnicy
| | Wydrążony (thrall) | Popielny Kolos (brute) |
|---|---|---|
| Rola | szybki, kruchy, otacza | wolny, opancerzony, karze błędy |
| HP / prędkość | 42 / 2.6 | 170 / 1.55 |
| Atak | stożek 100°, r 1.6, 10 dmg | koło r 1.2 przed sobą, 28 dmg |
| Wind-up / odpoczynek | 0.6 s / 0.6 s | 1.0 s / 1.1 s |
| Cooldown | 1.8 s | 2.6 s |
| Specjalne | drga od trafień | nie drga (poise), ogłuszenie skrócone |

Celowanie wroga śledzi bohatera przez pierwsze 30–35% wind-upu, potem się blokuje — dlatego
unik w bok w drugiej połowie telegrafu działa. Lekkie ciosy bohatera **nie** przerywają wind-upu
(trzeba uniknąć albo użyć Rozłamu). Po ciosie wróg ma fazę odpoczynku (szary, przygarbiony) — okno kontry.
Wrogowie podchodzą z różnych stron (indywidualny kąt flankowania), omijają przeszkody flow fieldem,
a czekając na cooldown krążą przy bohaterze w jego zasięgu.

### Fale
1: 3 Wydrążonych · 2: 5 · 3: Kolos + 3 · 4: Kolos + 5 · 5: 2 Kolosy + 4 · dalej rośnie liczba i HP (+8%/fala od 4.).
Spawn sygnalizowany turkusowym kręgiem (0.9–1.2 s, wróg nietykalny i niegroźny), nigdy bliżej niż 4.5 kafla.

## Plan systemów (kolejne etapy — jeszcze NIE ma ich w kodzie)
- Archetypy: dystansowy, szarżujący, wspierający, obszarowy; boss z 2 fazami.
- Druga klasa: Wędrowiec Otchłani (mobilność, dystans, pozycjonowanie).
- ~40 przedmiotów, 12 reliktów, ~15 talentów — z naciskiem na synergie (statusy z auto-ataku,
  bonus po uniku, efekty przy zabójstwie, niskie HP), z twardymi limitami stackowania.
- Loch: 8–12 typów pomieszczeń, walidacja przechodniości, seed.
- Baza: Kuźnia (wyposażenie), Sanktuarium (trwały rozwój), Archiwum (wiedza o świecie).
- Trwały postęp oddzielony od zasobów traconych przy śmierci.

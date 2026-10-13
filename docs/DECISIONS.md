# Decyzje techniczne

## D1 — Phaser 4.2.1 zamiast Phaser 3.90 (2026-10-13)
Phaser 3.90 to ostatnie wydanie linii 3 (bez dalszego rozwoju). Phaser 4 jest stabilny od 4.0.0
(kwiecień 2026), 4.2.1 z lipca 2026 ma za sobą kilka poprawek. Używane API (Image, Container, Graphics,
Text, particles, kamera, CanvasTexture) jest w v4 zgodne z v3; różnice (tint mode, roundPixels,
DynamicTexture.render) sprawdzone w dołączonym przewodniku migracji. Wyższy numer nie był powodem —
powodem jest wsparcie i nowy renderer WebGL.

## D2 — Symulacja niezależna od Phasera
Cała logika gry w czystym TS (`src/sim`, `src/world`), stały krok 1/60 s, zdarzenia w kolejce.
Powód: testy w Node bez przeglądarki, determinizm (seed), brak zależności od FPS, łatwe boty balansujące.
Phaser to tylko widok. Nie używamy Arcade Physics — kolizje koło–siatka są proste i w pełni pod kontrolą.

## D3 — HUD i sterowanie w DOM, świat w Phaserze
HTML daje ostry tekst przy każdym DPR, prawdziwe przyciski (fokus, czytniki ekranu), `env(safe-area-inset-*)`
dla notchy i niezawodny multi-touch przez Pointer Events. Phaser ma wyłączony input. Liczby obrażeń,
markery celu i telegrafy są w świecie gry (Phaser), bo muszą być przypięte do pozycji.

## D4 — Grafika proceduralna (Canvas 2D przy starcie)
Brak budżetu na assety. Tekstury rysowane kodem w 2× rozdzielczości, z ograniczoną paletą.
To placeholdery — spójne stylistycznie i czytelne, do zastąpienia w Etapie 6.

## D5 — Dźwięk syntezowany (Web Audio)
Brak plików audio = brak problemów licencyjnych i zero wagi. Każdy sygnał ma inny kształt (zamach, trafienie,
krytyk, telegraf Wydrążonego vs Kolosa). Gra działa bez dźwięku. AudioContext odblokowywany pierwszym dotknięciem (iOS).

## D6 — Własny service worker zamiast vite-plugin-pwa/Workbox
Kilkadziesiąt linii, zero zależności: nawigacje network-first z fallbackiem, statyczne pliki cache-first
(zahashowane nazwy z Vite). Wersja cache podbijana ręcznie (`VERSION` w `public/sw.js`).

## D7 — Playwright z lokalnym Microsoft Edge
`channel: 'msedge'` — nie pobiera przeglądarek, nic nie kosztuje. Testy e2e chodzą na buildzie produkcyjnym
(`vite preview`). Ten sam mechanizm generuje ikony PNG z SVG (`scripts/gen-icons.mjs`).

## D8 — TypeScript 6.0 (nie 7.0)
TS 7 to przepisany kompilator (natywny); 6.0 jest dojrzałą linią w pełni zgodną z ekosystemem Vite/Vitest.

## D9 — Hosting: GitHub Pages z gałęzi gh-pages
Darmowe dla publicznych repozytoriów, HTTPS (wymagany dla service workera i instalacji PWA).
`npm run deploy` buduje lokalnie i wypycha `dist/` na `gh-pages` (token gh bez scope `workflow` → bez Actions).
`base: './'` w Vite, więc build działa pod podścieżką `/abyss-hollow-crown/`.

## D10 — Fonty self-hosted (@fontsource, SIL OFL)
Grenze Gotisch (tytuły) i Alegreya Sans (UI, cyfry tabularne). Bez Google Fonts CDN — działa offline
i nie zależy od zewnętrznej usługi. Gotyckie cyfry rzymskie okazały się nieczytelne w HUD → cyfry arabskie.

## D11 — Wrogowie czekający na cooldown dociskają do kontaktu
Wykryte botem: Kolos krążył na 1.58 kafla, tuż poza zasięgiem miecza (1.45), więc był nietykalny między
atakami. Teraz krąży na odległości kontaktu ciał + 0.35 — czekanie wroga jest oknem kontry dla gracza.

## D12 — Dungeon crawler przed bossem (2026-10-13)
Właściciel zgłosił, że gra miała być dungeon crawlerem, a nie areną z falami. Kolejność etapów zmieniona:
podziemia, klasy, ulepszenia i trwały postęp weszły razem; boss przesunięty na następny etap.
Tryb fal został tylko jako uprząż testowa dla botów (`tests/helpers.ts`).

## D13 — Jedna mapa na piętro, komnaty odsłaniane mgłą
Całe piętro to jedna siatka kafli (64×64), a nie osobne sceny na komnatę: ciągła eksploracja, wspólna fizyka,
proste przejścia. Widoczność per region (komnata/korytarz). Drzwi to kafle, które reżyser zamienia
(Floor ↔ Door) i unieważnia flow field.

## D14 — Wyrównanie prędkości w izometrii
W rzucie 2:1 stała prędkość w świecie wygląda na ekranie 2× szybciej w bok niż w pionie. Ruch skalowany
`(długość na ekranie)^-0.7` — kompromis między fizyką świata a odczuciem. Te same współczynniki dla wrogów,
więc pościgi są uczciwe. Zasięgi ataków pozostają w jednostkach świata.

## D15 — Zwykłe trafienia bez hit-stopu
Hit-stop przy każdym auto-ataku (co ~0,7 s) zatrzymywał też chód bohatera — gracz odbierał to jako
nierówną prędkość. Zamrożenie zostało tylko dla krytyków (40 ms) i umiejętności (70 ms).

## D16 — Obiekt pod stopami uzbraja się po zejściu z niego
Schody/skrzynia pojawiające się dokładnie tam, gdzie stoi bohater, działały natychmiast (np. przeniesienie
na kolejne piętro bez zebrania łupu). Teraz trzeba zejść i wejść ponownie.

## D17 — Joystick: prędkość nie zależy od odległości palca poza obwodem (2026-10-13)
Błąd: wychylenie było przycinane do promienia, ale dzielone przez pełną odległość palca, więc prędkość spadała jak 1/odległość. Matematyka wydzielona do `src/input/stick.ts` (testy), baza joysticka podąża za palcem.

## D18 — Ekwipunek zostaje między wyprawami
Wzorem mobilnych auto-attack roguelite (np. Archero): przedmioty są trwałe (zapis v2, IndexedDB), ulepszenia 1 z 3 — tylko na wyprawę. Śmierć kosztuje postęp wyprawy i 40% popiołu, ale nie zabiera łupu. Torba 30 miejsc; nadmiar rozbijany na popiół. Bilans pięter liczony botami BEZ ekwipunku — sprzęt jest progresją, która pozwala schodzić głębiej.

## D19 — Legendarne = ręcznie zaprojektowane unikaty
Zwykłe/rzadkie/epickie mają losowane statystyki; 12 legendarnych ma stałą nazwę i efekt zmieniający grę. Efekt tego samego typu się nie kumuluje (liczy się najlepszy).

## D20 — Boss zamiast fal w ostatniej komnacie; 3 biomy
Komnata bossa jest zawsze największa (12×12). Każde piętro ma własny biom (wygląd, wrogowie, pułapki, boss) — `src/config/biomes.ts`. Bossowie to dane (listy ataków na 2 fazy), nie osobny kod — kolejnych dodaje się w konfiguracji.

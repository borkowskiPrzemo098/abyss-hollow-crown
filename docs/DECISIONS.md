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

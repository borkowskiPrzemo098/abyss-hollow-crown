# Architektura

```
src/
  config/balance.ts     wszystkie liczby rozgrywki (bohater, unik, skill, wrogowie, fale)
  core/                 math, seeded RNG (mulberry32), projekcja izometryczna
  world/                mapa kafli (parser ASCII), kolizje koło–siatka, linia wzroku, flow field
  sim/                  SYMULACJA: Simulation, targeting, formuła obrażeń, typy i zdarzenia
  render/               Phaser: tekstury proceduralne, widok świata, rigi postaci, FX, telegrafy
  input/controls.ts     joystick dotykowy, przyciski, klawiatura (DOM pointer/keyboard events)
  ui/hud.ts             HUD i ekrany (DOM): HP, fala, cooldowny, tytuł, pauza, śmierć
  audio/sfx.ts          syntezowane SFX (Web Audio), głośność, wyciszenie
  scenes/               BootScene (tekstury) → GameScene (pętla, zdarzenia → efekty)
  pwa/register.ts       rejestracja service workera (tylko build produkcyjny)
  main.ts               start: fonty, Phaser.Game, skalowanie HiDPI, hook testowy
public/                 manifest, sw.js, ikony
tests/                  Vitest (logika, bez Phasera)
e2e/                    Playwright (przeglądarka)
```

## Przepływ klatki

```
DOM input ──► Controls.poll() ──► screenDirToWorld() ──► sim.setInput()
                                                              │
GameScene.update(dt) ── akumulator ── sim.step(1/60) × N ──────┘
        │                                  │
        │                          sim.drainEvents() ──► FX / dźwięk / HUD-banery
        ▼
 interpolacja (px,py → x,y, alpha = acc/SIM_DT) ──► HeroView / EnemyView / Overlays / WorldView
```

## Kluczowe zasady
- **Jedna reprezentacja pozycji.** Symulacja zna tylko współrzędne świata w kaflach
  (kafel (tx,ty) = prostokąt [tx,tx+1)×[ty,ty+1)). Projekcja `worldToScreen` (kafel 64×32 px)
  używana wyłącznie w render. Joystick/WASD to kierunek ekranowy → `screenDirToWorld`, więc „góra” to góra ekranu.
- **Stały krok** `SIM_DT = 1/60`, maks. 6 kroków na klatkę (po zawieszeniu karty nie ma „nadrabiania”);
  delta przycinana do 0.1 s. Rendering interpoluje między krokami (płynnie na 90/120 Hz).
- **Determinizm.** Wszystkie losowania gry przez `Rng(seed)`; ten sam seed + wejścia = ten sam stan (test).
  Kosmetyka (rozrzut liczb obrażeń, cząsteczki) może używać `Math.random` — nie wpływa na symulację.
- **Zdarzenia zamiast callbacków.** Symulacja tylko dopisuje `SimEvent` do kolejki; scena je czyta.
  Dzięki temu logika jest testowalna w Node bez DOM.
- **Kolizje:** ciała to koła; ściany/kolumny/koksowniki to kafle AABB. Rozwiązywanie od najgłębszej penetracji
  (bez „podbijania” na łączeniach ścian), ruch dzielony na pod-kroki ≤ r/2 (brak tunelowania przy uniku/odrzucie).
  Separacja ciał ważona masą; bohater w uniku przenika przez wrogów.
- **Linia wzroku** (Amanatides–Woo) blokowana przez ściany i kolumny, nie przez koksowniki.
  `hasClearPath` (3 promienie z szerokością ciała) decyduje, czy wróg może iść prosto, czy flow fieldem.
- **Sortowanie głębi:** obiekty na podłodze mają `depth = 100 + (x+y)·10`; bloki ścian sortowane po środku kafla.
  Ściany wewnętrzne przed bohaterem przygasają (nigdy nie zasłaniają postaci); przednia krawędź areny jest niska.
- **HiDPI:** canvas renderowany w rozdzielczości urządzenia (DPR ≤ 2), CSS-owo przeskalowany (`Scale.NONE` + zoom 1/DPR);
  zoom kamery = DPR × skala zależna od krótszego boku ekranu, więc świat ma ten sam rozmiar w CSS px na każdym telefonie.
- **Tekstury** rysowane Canvas 2D przy starcie w 2× rozdzielczości (`RES`), obiekty skalowane 1/RES.
- **Pule obiektów** dla liczb obrażeń, cięć, pierścieni, powidoków; cząsteczki z kilku stałych emiterów.
- **UI w DOM**: ostry tekst, prawdziwe przyciski, `env(safe-area-inset-*)`. Phaser ma wyłączony input.

## Testy
- `tests/world.test.ts` — parser, osiągalność kafli, kolizje, poślizg, tunelowanie, LOS, projekcja.
- `tests/targeting.test.ts` — reguły wyboru celu, auto-atak, zmiana celu po śmierci, brak ataku przez ścianę, interwał.
- `tests/combat.test.ts` — formuła obrażeń, unik (dystans, cooldown, bufor, i-frames, ściany), telegrafy,
  ominięcie koksownika, Rozłam (przerwanie, cooldown, zakazy w uniku/po śmierci), śmierć, fale, determinizm.
- `tests/design.test.ts` — boty: bierny vs aktywny gracz (gwarancja, że stanie w miejscu przegrywa).
- `e2e/smoke.spec.ts` — start, ruch (klawiatura / przeciągnięcie joysticka), unik, skill, pauza (czas stoi), śmierć,
  restart, brak błędów konsoli; pauza po ukryciu karty; blokady przewijania/zaznaczania.

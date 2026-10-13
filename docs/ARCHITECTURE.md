# Architektura

```
src/
  config/               balance (wspólne + wrogowie), heroes, skills, upgrades, progression, dungeon
  core/                 math, seeded RNG (mulberry32), projekcja izometryczna
  world/                mapa kafli, generator podziemi + walidacja, kolizje, linia wzroku, flow field
  sim/                  SYMULACJA: Simulation (walka, pociski, strefy, łupy, XP), director (komnaty, drzwi,
                        fale, nagrody, schody), stats (jedna formuła statystyk), targeting, damage
  meta/save.ts          zapis IndexedDB: wersja, walidacja, kopia, Sanktuarium, bilans wyprawy
  render/               Phaser: tekstury proceduralne, widok piętra z mgłą, rigi postaci, pociski/łupy/obiekty,
                        FX, telegrafy
  input/controls.ts     joystick dotykowy, przyciski, klawiatura (DOM pointer/keyboard events)
  ui/                   hud (HP, XP, popiół, cooldowny), menus (wybór postaci/umiejętności, ulepszenia,
                        pauza z kartą statystyk, Sanktuarium, podsumowanie), minimap
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
- `tests/world`, `targeting`, `combat` — rdzeń walki, kolizje, LOS, unik, umiejętności, determinizm.
- `tests/dungeon` — 180 wygenerowanych pięter bez błędów walidacji, determinizm seeda, reżyser (drzwi, fale, skrzynie, kapliczki, schody).
- `tests/progression` — statystyki, XP/poziomy/wybory, limity stosów, łupy, pociski, Szarża/Salwa/Pieczęć, płynność ruchu, zapis.
- `tests/design`, `tests/run` — boty: bierny vs aktywny na arenie i w całej wyprawie, dla obu klas.
- `e2e/smoke.spec.ts` — pełny przebieg w przeglądarce (desktop, telefon pion i poziom): wybór, walka, ulepszenie,
  pauza, schody, śmierć, Sanktuarium, zapis po odświeżeniu, dźwięk aktywny, brak błędów konsoli.

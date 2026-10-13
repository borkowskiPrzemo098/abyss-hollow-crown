# ABYSS: The Hollow Crown

Mroczny izometryczny dungeon crawler na telefon (PWA). Bohater atakuje sam — ty decydujesz,
gdzie stoi, kiedy się przeturla i kiedy użyje umiejętności. Trzy piętra proceduralnych podziemi,
dwie klasy, ulepszenia z każdej wyprawy i stałe rangi w Sanktuarium.

**Status: dungeon crawler — 3 piętra, 2 klasy, 4 umiejętności, 15 ulepszeń, zapis postępów.** Szczegóły: [docs/ROADMAP.md](docs/ROADMAP.md).

## Uruchomienie lokalne

Wymagania: Node.js 20+ (testowane na 24) i npm.

```bash
npm install
npm run dev
```

Otwórz http://localhost:4930.

### Na telefonie w tej samej sieci Wi-Fi

`npm run dev` nasłuchuje też w sieci lokalnej (Vite wypisze adres `Network: http://192.168.x.x:4930`).
Otwórz ten adres w Safari / Chrome na telefonie. (Service worker i instalacja PWA działają tylko
z HTTPS lub localhost — do tego użyj wersji z GitHub Pages.)

## Sterowanie

| | Telefon | Klawiatura |
|---|---|---|
| Ruch | lewy kciuk (joystick pojawia się tam, gdzie dotkniesz) | WASD / strzałki |
| Unik | duży przycisk po prawej | Spacja / Shift |
| Umiejętność | mniejszy przycisk nad unikiem | E / Q |
| Postać i statystyki | ikona postaci u góry | C |
| Pauza | przycisk w prawym górnym rogu | Esc / P |
| Atak | **automatyczny** | **automatyczny** |

## Testy

```bash
npm test          # testy logiki (Vitest)
npm run build     # sprawdzenie typów + build produkcyjny
npm run test:e2e  # testy przeglądarkowe (Playwright, lokalny Microsoft Edge — nic nie pobiera)
```

## Technologia

TypeScript · Phaser 4.2 · Vite 8 · Vitest 5 · Playwright · PWA (manifest + service worker).
Bez backendu, bez kont, bez płatnych usług. Grafika i dźwięk generowane kodem (placeholdery).
Fonty: Grenze Gotisch i Alegreya Sans (SIL OFL, self-hosted przez @fontsource).

# ABYSS: The Hollow Crown — zasady pracy

Mobilny (PWA) izometryczny action roguelite w TypeScript + Phaser 4 + Vite.
Pełna wizja: `docs/GAME_DESIGN.md`. Architektura: `docs/ARCHITECTURE.md`.
Etapy: `docs/ROADMAP.md`. Decyzje: `docs/DECISIONS.md`.

## Twarde reguły

1. **Zero kosztów.** Żadnych płatnych API, assetów, hostingu, usług wymagających karty.
   Hosting: GitHub Pages (darmowy, publiczne repo). Grafika i dźwięk: proceduralne lub darmowe ze sprawdzoną licencją.
2. **Auto-atak to fundament.** Bohater sam atakuje najbliższy cel w zasięgu (bez ścian po drodze).
   Gracz steruje tylko ruchem, unikiem i jedną umiejętnością. Nie dodawać przycisku ataku.
   Nie dodawać auto-ruchu ani auto-unikania.
3. **Symulacja jest czysta.** `src/sim`, `src/world`, `src/core`, `src/config` nie importują Phasera ani DOM.
   Cała logika gry działa w przestrzeni świata (kafle), stały krok `SIM_DT`. Ekran/izometria tylko w `src/render`.
4. **Balans w jednym miejscu:** `src/config/balance.ts`. Żadnych magicznych liczb rozgrywki w innych plikach.
5. **Każdy groźny atak wroga ma telegraf** (kształt na ziemi = dokładnie obszar testowany w symulacji).
6. **Etapy po kolei.** Nie zaczynać kolejnego etapu z ROADMAP, dopóki bieżący nie działa i nie przechodzi testów.
7. **Nie deklarować testów, których nie było.** Testów na fizycznym telefonie nie da się zrobić z tej maszyny — oznaczać jako „do sprawdzenia na urządzeniu”.
8. Dokumentacja opisuje tylko to, co jest w kodzie. Placeholdery grafiki są oznaczone jako placeholdery.

## Komendy

```bash
npm run dev        # serwer deweloperski http://localhost:4930 (także w sieci LAN, --host)
npm test           # Vitest: logika, kolizje, targeting, unik, cooldowny, determinizm, boty projektowe
npm run build      # typecheck + build produkcyjny do dist/
npm run test:e2e   # Playwright na lokalnym Edge (desktop + emulacja Pixel 7), po buildzie
```

Po każdej zmianie: `npm test`, `npm run build`, `npm run test:e2e`. Wszystko musi być zielone.

## Debug

`?test` w URL wystawia `window.__abyss.scene` (tryb, `sim`). `?seed=123` ustala ziarno losowości.

## Deploy

`npm run deploy` → testy + build + push `dist/` na gałąź `gh-pages` (źródło GitHub Pages).
Token `gh` nie ma scope `workflow`, dlatego nie używamy GitHub Actions.
Przy zmianie powłoki aplikacji podbij `VERSION` w `public/sw.js`.

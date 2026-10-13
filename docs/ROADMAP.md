# Roadmap

## ✅ Etap 0 — audyt i plan (2026-10-13)
Środowisko: Node 24, npm 11, git, gh. Projekt od zera w `ABYSS-HOLLOW-CROWN/`.
Dokumenty, konfiguracja Vite/TS/Vitest/Playwright, minimalna aplikacja.

## ✅ Etap 1 — grywalny fundament (2026-10-13)
- [x] gra w przeglądarce (desktop + mobile), build produkcyjny, PWA (manifest, SW, ikony)
- [x] izometryczna arena 22×22 (Przedsionek Popiołu): ściany, kolumny, koksowniki, krąg rytualny
- [x] ruch bohatera, kolizje ze ścianami (poślizg, brak tunelowania)
- [x] 2 typy wrogów z telegrafowanymi atakami (Wydrążony, Popielny Kolos), fale z eskalacją
- [x] auto-atak najbliższego celu w zasięgu, stabilny targeting, brak ataku przez ściany, cleave
- [x] unik z cooldownem, i-frames, buforem; Rozłam (AoE, odrzut, ogłuszenie, przerwanie)
- [x] HP, obrażenia, krytyki, śmierć; hit-stop, błyski, iskry, liczby, wstrząs kamery, dźwięki syntezowane
- [x] joystick dotykowy + przyciski; klawiatura; pauza (też automatyczna po ukryciu karty), restart areny
- [x] głośność i wyciszenie (w pauzie)
- [x] 50 testów logiki + 6 testów przeglądarkowych

**Do sprawdzenia na fizycznym telefonie (nie było możliwe z tej maszyny):** płynność (FPS) na iPhone/Androidzie,
wygoda kciuków i rozmiar przycisków, safe-area na telefonie z notchem, instalacja PWA (Safari „Do ekranu
początkowego”, Chrome „Zainstaluj”), dźwięk po pierwszym dotknięciu na iOS, wibracja na Androidzie.

**Znane ograniczenia Etapu 1:**
- Grafika to spójne, ale proceduralne placeholdery (postacie z kilku części, animacja kodem).
- Ustawienia głośności nie są zapisywane (zapis = Etap 5, IndexedDB).
- Offline po pierwszym wczytaniu powinien działać (SW cache), ale nie jest jeszcze zweryfikowany testem.
- Jedna arena, brak nagród/XP/ulepszeń (Etap 2).

## ⏭ Etap 2 — pierwszy kompletny cykl walki (następny)
- archetypy: dystansowy (pociski do uniknięcia), szarżujący (linia szarży), wspierający (tarcza/leczenie), obszarowy
- XP z wrogów, poziom → wybór 1 z 3 ulepszeń (pierwsze 6–8 ulepszeń, testowanych pod kątem synergii)
- podstawowe nagrody (dusze/okruchy) z animacją zbierania
- pierwszy boss (Strażnik Pustej Korony) z 2 fazami i oknami kontry
- ekran zwycięstwa i porażki z podsumowaniem
- bot projektowy rozszerzony o nowych wrogów

## Etap 3 — pierwszy loch
Generator pomieszczeń (8–12 typów), drzwi, spotkania, pokoje nagród, walidacja przechodniości, seed, koniec wyprawy.

## Etap 4 — rozwój roguelite
Przedmioty, relikty, umiejętności, synergie — najpierw kilka dobrze zaprojektowanych, potem rozszerzanie.

## Etap 5 — baza i trwały postęp
IndexedDB z wersjonowaniem i kopią zapasową, odporność na uszkodzony zapis, Kuźnia / Sanktuarium / Archiwum.

## Etap 6 — oprawa i UX
Lepsze sprite'y/animacje, efekty, przejścia, audio, ekran startowy, ustawienia, tutorial.

## Etap 7 — PWA i testy mobilne
Instalacja, offline, wznowienie, orientacja, wydajność na słabszych telefonach.

## Etap 8 — polish i balans

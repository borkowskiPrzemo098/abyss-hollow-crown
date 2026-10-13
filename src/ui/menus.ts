import { HEROES, type HeroId } from '../config/heroes';
import { RANKS, RUN, type RankId } from '../config/progression';
import { SKILLS, type SkillId } from '../config/skills';
import { UPGRADES, type UpgradeId } from '../config/upgrades';
import { nextRankCost, type SaveData } from '../meta/save';
import type { Choice, Hero } from '../sim/types';
import { $ } from './hud';

export type ScreenId = 'title' | 'hero' | 'skill' | 'choice' | 'pause' | 'sanct' | 'end' | 'corrupt';

export interface MenuActions {
  newRun(): void;
  pickHero(id: HeroId): void;
  pickSkill(id: SkillId): void;
  openSanctuary(): void;
  buyRank(id: RankId): void;
  back(): void;
  choose(id: UpgradeId): void;
  resume(): void;
  abandon(): void;
  mute(muted: boolean): void;
  volume(v: number): void;
  noSave(): void;
  wipe(): void;
}

export interface RunSummary {
  won: boolean;
  floor: number;
  kills: number;
  level: number;
  seconds: number;
  ashKept: number;
}

const SCREENS: ScreenId[] = ['title', 'hero', 'skill', 'choice', 'pause', 'sanct', 'end', 'corrupt'];

const icon = (id: string) => `<svg aria-hidden="true"><use href="#i-${id}" /></svg>`;
const fmt = (v: number, digits = 1) => (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString('pl-PL');
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** All full-screen menus. Content comes from the config tables, never from user input. */
export class Menus {
  current: ScreenId | null = 'title';

  constructor(act: MenuActions, private readonly portrait: (key: string) => string) {
    $('#btn-new').addEventListener('click', () => act.newRun());
    $('#btn-sanct').addEventListener('click', () => act.openSanctuary());
    $('#btn-resume').addEventListener('click', () => act.resume());
    $('#btn-abandon').addEventListener('click', () => act.abandon());
    $('#btn-again').addEventListener('click', () => act.newRun());
    $('#btn-end-sanct').addEventListener('click', () => act.openSanctuary());
    $('#btn-nosave').addEventListener('click', () => act.noSave());
    $('#btn-wipe').addEventListener('click', () => act.wipe());
    for (const b of document.querySelectorAll<HTMLElement>('[data-back]')) b.addEventListener('click', () => act.back());
    const mute = $<HTMLButtonElement>('#btn-mute');
    mute.addEventListener('click', () => {
      const m = mute.getAttribute('aria-pressed') !== 'true';
      this.setMuted(m);
      act.mute(m);
    });
    const vol = $<HTMLInputElement>('#volume');
    vol.addEventListener('input', () => act.volume(Number(vol.value) / 100));
    // card grids use event delegation
    $('#hero-cards').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-hero]')?.dataset.hero;
      if (id) act.pickHero(id as HeroId);
    });
    $('#skill-cards').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-skill]')?.dataset.skill;
      if (id) act.pickSkill(id as SkillId);
    });
    $('#choice-cards').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-up]')?.dataset.up;
      if (id) act.choose(id as UpgradeId);
    });
    $('#ranks').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-rank]:not([disabled])')?.dataset.rank;
      if (id) act.buyRank(id as RankId);
    });
  }

  show(which: ScreenId | null): void {
    this.current = which;
    for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== which;
    if (!which) return;
    requestAnimationFrame(() => {
      const root = $(`#screen-${which}`);
      root.querySelector<HTMLElement>('.card, .btn-primary, button:not([data-back])')?.focus({ preventScroll: true });
    });
  }

  setMuted(m: boolean): void {
    const b = $('#btn-mute');
    b.setAttribute('aria-pressed', String(m));
    b.querySelector('.label')!.textContent = m ? 'Dźwięk: wyłączony' : 'Dźwięk: włączony';
  }

  setVolume(v: number): void {
    $<HTMLInputElement>('#volume').value = String(Math.round(v * 100));
  }

  renderTitle(save: SaveData, saving: boolean): void {
    $('#title-ash').textContent = String(save.ash);
    const s = save.stats;
    $('#record').textContent = !saving
      ? 'Postęp nie jest zapisywany w tej sesji.'
      : s.runs === 0
        ? ''
        : `Wypraw: ${s.runs} · zwycięstw: ${s.wins} · najgłębiej: poziom ${s.bestFloor}`;
  }

  renderHeroes(): void {
    const all = Object.values(HEROES);
    const max = {
      hp: Math.max(...all.map((h) => h.maxHp)),
      dps: Math.max(...all.map((h) => h.attack.damage / h.attack.interval)),
      range: Math.max(...all.map((h) => h.attack.range)),
      speed: Math.max(...all.map((h) => h.moveSpeed)),
    };
    const bar = (label: string, v: number, m: number, text: string) =>
      `<div class="bar"><span>${label}</span><i style="--v:${Math.max(0.12, v / m)}"></i><b>${text}</b></div>`;
    $('#hero-cards').innerHTML = all
      .map(
        (h) => `
      <button class="card card-hero" type="button" data-hero="${h.id}">
        <img class="portrait" alt="" src="${this.portrait(h.id === 'warden' ? 'heroBody' : 'wandererBody')}" />
        <span class="card-role">${h.role}</span>
        <span class="card-name">${h.name}</span>
        <span class="card-text">${h.description}</span>
        <span class="bars">
          ${bar('Zdrowie', h.maxHp, max.hp, String(h.maxHp))}
          ${bar('Obrażenia/s', h.attack.damage / h.attack.interval, max.dps, fmt(h.attack.damage / h.attack.interval))}
          ${bar('Zasięg', h.attack.range, max.range, fmt(h.attack.range))}
          ${bar('Ruch', h.moveSpeed, max.speed, fmt(h.moveSpeed))}
        </span>
        <span class="card-foot">Unik ${fmt(h.dodge.distance)} m · odnowienie ${fmt(h.dodge.cooldown)} s</span>
      </button>`,
      )
      .join('');
  }

  renderSkills(heroId: HeroId): void {
    const h = HEROES[heroId];
    $('#skill-note').textContent = `${h.name} — jedna umiejętność na całą wyprawę. Atak podstawowy działa sam.`;
    $('#skill-cards').innerHTML = h.skills
      .map((id) => {
        const s = SKILLS[id];
        return `
      <button class="card card-skill" type="button" data-skill="${s.id}">
        <span class="skill-icon">${icon(s.id)}</span>
        <span class="card-name">${s.name}</span>
        <span class="card-text">${s.description}</span>
        <span class="card-foot">Odnowienie ${fmt(s.cooldown)} s</span>
      </button>`;
      })
      .join('');
  }

  renderChoice(choice: Choice, hero: Hero): void {
    $('#choice-h').textContent = choice.source === 'chest' ? 'Skrzynia' : `Poziom ${hero.level}`;
    $('#choice-note').textContent = choice.source === 'chest' ? 'Skrzynia częściej skrywa rzadkie dary. Wybierz jeden.' : 'Wybierz jedno ulepszenie.';
    $('#choice-cards').innerHTML = choice.options
      .map((id) => {
        const u = UPGRADES[id];
        const have = hero.upgrades[id];
        const pips = Array.from({ length: u.maxStacks }, (_, i) => `<i class="${i < have ? 'on' : i === have ? 'next' : ''}"></i>`).join('');
        return `
      <button class="card card-up ${u.kind === 'special' ? 'is-special' : ''}" type="button" data-up="${u.id}">
        <span class="card-role">${u.kind === 'special' ? 'Dar specjalny' : 'Statystyka'}</span>
        <span class="card-name">${u.name}</span>
        <span class="card-text">${u.text}</span>
        <span class="pips" aria-label="Poziom ${have + 1} z ${u.maxStacks}">${pips}</span>
      </button>`;
      })
      .join('');
  }

  renderSheet(hero: Hero): void {
    const s = hero.stats;
    const row = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    const ups = (Object.keys(hero.upgrades) as UpgradeId[]).filter((id) => hero.upgrades[id] > 0);
    $('#sheet').innerHTML = `
      <h3 class="sheet-title">${hero.cls.name} <span>· poziom ${hero.level}</span></h3>
      <dl class="sheet-stats">
        ${row('Zdrowie', `${Math.ceil(hero.hp)} / ${s.maxHp}`)}
        ${row('Obrażenia', fmt(s.damage))}
        ${row('Szybkość ataku', `${fmt(1 / s.attackInterval, 2)} / s`)}
        ${row('Zasięg ataku', fmt(s.attackRange, 2))}
        ${row('Szybkość ruchu', fmt(s.moveSpeed, 2))}
        ${row('Redukcja obrażeń', pct(s.armor))}
        ${row('Szansa na krytyk', pct(s.critChance))}
        ${row('Obrażenia krytyczne', `×${fmt(s.critMult, 2)}`)}
        ${row('Odnowienie umiejętności', s.skillCooldownMult < 1 ? `−${pct(1 - s.skillCooldownMult)}` : '—')}
        ${row('Umiejętność', hero.skill.name)}
      </dl>
      <h4 class="sheet-sub">Ulepszenia z tej wyprawy</h4>
      ${
        ups.length === 0
          ? '<p class="sheet-empty">Jeszcze żadnych — zdobywaj poziomy i otwieraj skrzynie.</p>'
          : `<ul class="sheet-ups">${ups.map((id) => `<li><b>${UPGRADES[id].name}</b> <span>${hero.upgrades[id]}/${UPGRADES[id].maxStacks}</span><em>${UPGRADES[id].text}</em></li>`).join('')}</ul>`
      }`;
  }

  renderSanctuary(save: SaveData): void {
    $('#sanct-ash').textContent = String(save.ash);
    $('#ranks').innerHTML = (Object.keys(RANKS) as RankId[])
      .map((id) => {
        const r = RANKS[id];
        const rank = save.ranks[id];
        const cost = nextRankCost(save, id);
        const pips = r.costs.map((_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
        const btn =
          cost === null
            ? '<button class="btn btn-ghost btn-sm" type="button" disabled>Maks.</button>'
            : `<button class="btn btn-buy btn-sm" type="button" data-rank="${id}" ${save.ash < cost ? 'disabled' : ''} aria-label="Wzmocnij ${r.name} za ${cost} popiołu">${icon('ash')}${cost}</button>`;
        return `
      <div class="rank">
        <div class="rank-info"><b>${r.name}</b><span>${r.text} za rangę</span></div>
        <span class="pips">${pips}</span>
        ${btn}
      </div>`;
      })
      .join('');
  }

  renderEnd(r: RunSummary): void {
    $('#end-h').textContent = r.won ? 'Otchłań zdobyta' : 'Poległeś';
    $('#end-h').classList.toggle('death-title', !r.won);
    $('#end-note').textContent = r.won
      ? 'Wróciłeś z dna z całym popiołem. Pusta korona wciąż czeka — ale dziś to ty wyszedłeś na powierzchnię.'
      : `Otchłań zabiera ciało. Zachowujesz ${Math.round(RUN.ashKeptOnDeath * 100)}% zebranego popiołu.`;
    $('#end-floor').textContent = String(r.floor);
    $('#end-kills').textContent = String(r.kills);
    $('#end-level').textContent = String(r.level);
    const m = Math.floor(r.seconds / 60);
    const s = Math.floor(r.seconds % 60);
    $('#end-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('#end-ash').textContent = String(r.ashKept);
  }
}

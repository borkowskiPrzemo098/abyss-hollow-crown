import { HEROES, type HeroId } from '../config/heroes';
import { RANKS, RUN, type RankId } from '../config/progression';
import { SKILL_UPGRADES, describeStep, isSkillUpgradeId, upgradesOf } from '../config/skillUpgrades';
import { STATUS_LIST, SYNERGIES, synergiesOf } from '../config/statuses';
import { SKILLS, SKILL_ORDER, SKILL_RULES, type SkillId, type SkillRole } from '../config/skills';
import { BASES, RARITY, type Item } from '../config/items';
import { UPGRADES, type UpgradeId } from '../config/upgrades';
import { isUnlocked, unlockProgress, unlockText } from '../meta/loadout';
import { nextRankCost, type SaveData } from '../meta/save';
import type { Choice, ChoiceId, Hero } from '../sim/types';
import { $ } from './hud';

export type ScreenId = 'title' | 'hero' | 'skill' | 'choice' | 'pause' | 'sanct' | 'inv' | 'codex' | 'end' | 'corrupt';

export interface MenuActions {
  newRun(): void;
  pickHero(id: HeroId): void;
  /** Tap on a skill (or on a worn one in a slot): wear it or take it off. */
  toggleSkill(id: SkillId): void;
  startRun(): void;
  openSanctuary(): void;
  openInventory(): void;
  openCodex(): void;
  buyRank(id: RankId): void;
  back(): void;
  choose(id: ChoiceId): void;
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
  loot: Item[];
  /** Skills this run unlocked. */
  unlocked: SkillId[];
}

const SCREENS: ScreenId[] = ['title', 'hero', 'skill', 'choice', 'pause', 'sanct', 'inv', 'codex', 'end', 'corrupt'];

const ROLE_NAMES: Record<SkillRole, string> = {
  aoe: 'Obszar',
  mobility: 'Mobilność',
  single: 'Pojedynczy cios',
  projectile: 'Pocisk',
  defense: 'Obrona',
  control: 'Kontrola',
  trap: 'Pułapka',
  summon: 'Przywołanie',
  sustain: 'Ciągły',
  buff: 'Wzmocnienie',
  support: 'Wsparcie',
};

const icon = (id: string) => `<svg aria-hidden="true"><use href="#i-${id}" /></svg>`;
const fmt = (v: number, digits = 1) => (Math.round(v * 10 ** digits) / 10 ** digits).toLocaleString('pl-PL');
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** All full-screen menus. Content comes from the config tables, never from user input. */
export class Menus {
  current: ScreenId | null = 'title';
  private codexHero: HeroId = 'warden';
  private codexSave: SaveData | null = null;

  constructor(act: MenuActions, private readonly portrait: (key: string) => string) {
    $('#btn-new').addEventListener('click', () => act.newRun());
    $('#btn-sanct').addEventListener('click', () => act.openSanctuary());
    $('#btn-inv').addEventListener('click', () => act.openInventory());
    $('#btn-codex').addEventListener('click', () => act.openCodex());
    $('#codex-tabs').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as HeroId | undefined;
      if (id && this.codexSave) this.renderCodex(this.codexSave, id);
    });
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
    const toggle = (e: Event) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-skill]:not([disabled])')?.dataset.skill;
      if (id) act.toggleSkill(id as SkillId);
    };
    $('#skill-cards').addEventListener('click', toggle);
    $('#skill-slots').addEventListener('click', toggle);
    $('#btn-start').addEventListener('click', () => act.startRun());
    $('#choice-cards').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-up]')?.dataset.up;
      if (id) act.choose(id);
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

  /** The loadout screen: three slots on top, the class's ten skills below (locked ones show what unlocks them). */
  renderSkills(heroId: HeroId, save: SaveData): void {
    const h = HEROES[heroId];
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.skill;
    const worn = save.loadout[heroId];
    const prog = save.progress[heroId];
    $('#skill-note').textContent = `${h.name} — do ${SKILL_RULES.maxSlots} umiejętności naraz. Pierwsza jest startowa; reszta odblokowuje się z postępem tej klasy. Atak podstawowy działa sam.`;
    $('#skill-slots').innerHTML = Array.from({ length: SKILL_RULES.maxSlots }, (_, i) => {
      const id = worn[i];
      if (!id) {
        return `<div class="lo-slot is-empty"><span class="lo-num">Slot ${i + 1}</span><span class="lo-name">Pusty</span></div>`;
      }
      const sk = SKILLS[id];
      return `<button class="lo-slot" type="button" data-skill="${id}" aria-label="Zdejmij: ${sk.name}">
        <span class="skill-icon">${icon(id)}</span>
        <span class="lo-text"><span class="lo-num">Slot ${i + 1}${i === 0 ? ' · startowa' : ''}</span><span class="lo-name">${sk.name}</span></span>
      </button>`;
    }).join('');
    $('#skill-cards').innerHTML = SKILL_ORDER[heroId]
      .map((id) => {
        const sk = SKILLS[id];
        const open = isUnlocked(id, prog);
        const slot = worn.indexOf(id);
        const meta = `${ROLE_NAMES[sk.role]} · odnowienie ${fmt(sk.cooldown)} s`;
        if (!open) {
          const pr = unlockProgress(sk.unlock, prog);
          return `
      <button class="sk is-locked" type="button" data-skill="${id}" disabled aria-label="${sk.name} — zablokowana: ${unlockText(sk.unlock)}">
        <span class="skill-icon">${icon(id)}</span>
        <span class="sk-body">
          <span class="sk-name">${sk.name}</span>
          <span class="sk-meta">${meta}</span>
          <span class="sk-lock">${unlockText(sk.unlock)} · ${pr.have}/${pr.need}</span>
        </span>
      </button>`;
        }
        return `
      <button class="sk ${slot >= 0 ? 'is-on' : ''}" type="button" data-skill="${id}" aria-pressed="${slot >= 0}">
        <span class="skill-icon">${icon(id)}</span>
        <span class="sk-body">
          <span class="sk-name">${sk.name}</span>
          <span class="sk-meta">${meta}</span>
          <span class="sk-text">${sk.description}</span>
          ${synergiesOf(id).length > 0 ? `<span class="sk-syn">Reakcje: ${synergiesOf(id).map((x) => x.name).join(', ')}</span>` : ''}
          <span class="sk-codex">Ulepszenia poznane: ${upgradesOf(id).filter((u) => save.codex.includes(u.id)).length} / ${upgradesOf(id).length}</span>
        </span>
        ${slot >= 0 ? `<span class="sk-badge">${slot + 1}</span>` : ''}
      </button>`;
      })
      .join('');
    this.refocusSkill(focused);
  }

  /** (keyboard users keep their place after a tap re-renders the list) */
  private refocusSkill(id: string | undefined): void {
    if (id) $('#skill-cards').querySelector<HTMLElement>(`[data-skill="${id}"]:not([disabled])`)?.focus({ preventScroll: true });
  }

  /**
   * The character menu: every skill of a class with what it does, how to unlock it (and how far along you are),
   * which reactions it takes part in and every upgrade it can get, level by level. Locked skills are fully readable.
   */
  renderCodex(save: SaveData, hero?: HeroId): void {
    this.codexSave = save;
    if (hero) this.codexHero = hero;
    const id = this.codexHero;
    const cls = HEROES[id];
    const prog = save.progress[id];
    const worn = save.loadout[id];
    const unlockedCount = SKILL_ORDER[id].filter((s) => isUnlocked(s, prog)).length;
    $('#codex-tabs').innerHTML = (Object.keys(HEROES) as HeroId[])
      .map((h) => `<button class="tab ${h === id ? 'is-on' : ''}" type="button" role="tab" aria-selected="${h === id}" data-tab="${h}">${HEROES[h].name}</button>`)
      .join('');
    const stat = (k: string, v: string | number) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    $('#codex-head').innerHTML = `
      <p class="codex-role">${cls.role}</p>
      <p class="codex-desc">${cls.description}</p>
      <dl class="codex-prog">
        ${stat('Wyprawy', prog.runs)}
        ${stat('Pokonani wrogowie', prog.kills)}
        ${stat('Najgłębszy poziom', prog.bestFloor || '—')}
        ${stat('Wygrane', prog.wins)}
        ${stat('Umiejętności', `${unlockedCount} / ${SKILL_ORDER[id].length}`)}
      </dl>
      <p class="codex-hint">Dotknij umiejętności, żeby zobaczyć jej działanie, ulepszenia i sposób odblokowania. Wyposażasz je przy starcie wyprawy.</p>`;

    $('#codex-skills').innerHTML = SKILL_ORDER[id]
      .map((skillId) => {
        const sk = SKILLS[skillId];
        const unlocked = isUnlocked(skillId, prog);
        const slot = worn.indexOf(skillId);
        const pr = unlockProgress(sk.unlock, prog);
        const state = unlocked
          ? slot >= 0
            ? `Wyposażona · slot ${slot + 1}`
            : sk.unlock.type === 'start'
              ? 'Odblokowana od początku'
              : 'Odblokowana'
          : `Zablokowana · ${unlockText(sk.unlock)} (${pr.have}/${pr.need})`;
        const reactions = synergiesOf(skillId);
        const ups = upgradesOf(skillId);
        const found = ups.filter((u) => save.codex.includes(u.id)).length;
        const levels = (u: (typeof ups)[number]) =>
          u.levels
            .map((_, i) => `<li><b>Poz. ${i + 1}</b> ${describeStep(u, 0, i + 1).map((l) => `${l.name}: <i>${l.value}</i>`).join(' · ')}</li>`)
            .join('');
        return `
      <details class="cx ${unlocked ? 'is-open' : 'is-locked'}">
        <summary>
          <span class="skill-icon">${icon(skillId)}</span>
          <span class="cx-main">
            <span class="cx-name">${sk.name}</span>
            <span class="cx-meta">${ROLE_NAMES[sk.role]} · odnowienie ${fmt(sk.cooldown)} s</span>
            <span class="cx-state ${unlocked ? '' : 'is-locked'}">${state}</span>
          </span>
          <span class="cx-chev" aria-hidden="true"></span>
        </summary>
        <div class="cx-body">
          <p class="cx-text">${sk.description}</p>
          ${
            unlocked
              ? ''
              : `<div class="cx-unlock"><b>Jak odblokować:</b> ${unlockText(sk.unlock)} — ${pr.have} z ${pr.need}<span class="cx-bar"><i style="--v:${pr.need > 0 ? pr.have / pr.need : 1}"></i></span></div>`
          }
          ${
            reactions.length === 0
              ? ''
              : `<h5>Reakcje ze statusami</h5><ul class="cx-list">${reactions.map((r) => `<li><b>${r.name}</b> ${r.text}</li>`).join('')}</ul>`
          }
          <h5>Ulepszenia · poznane ${found} z ${ups.length}</h5>
          <p class="cx-sub">Znajdujesz je w trakcie wyprawy (przy awansie i w skrzyniach), tylko dla noszonych umiejętności.</p>
          <ul class="cx-ups">
            ${ups
              .map(
                (u) => `<li class="${save.codex.includes(u.id) ? 'is-found' : ''}">
              <span class="cx-uphead"><b>${u.name}</b><span>${save.codex.includes(u.id) ? 'poznane' : 'jeszcze nie znalezione'}</span></span>
              <em>${u.summary}</em>
              <ol class="cx-levels">${levels(u)}</ol>
            </li>`,
              )
              .join('')}
          </ul>
        </div>
      </details>`;
      })
      .join('');

    $('#codex-rules').innerHTML = `
      <h4 class="sheet-sub">Statusy</h4>
      <ul class="cx-list">${STATUS_LIST.map((x) => `<li><b>${x.name}</b> ${x.text}</li>`).join('')}</ul>
      <h4 class="sheet-sub">Wszystkie reakcje</h4>
      <ul class="cx-list">${Object.values(SYNERGIES).map((x) => `<li><b>${x.name}</b> ${x.text}</li>`).join('')}</ul>`;
  }

  /** One-line feedback under the slots ("Masz już trzy umiejętności…"). */
  setLoadoutMessage(text: string): void {
    $('#skill-msg').textContent = text;
  }

  renderChoice(choice: Choice, hero: Hero): void {
    $('#choice-h').textContent = choice.source === 'chest' ? 'Skrzynia' : `Poziom ${hero.level}`;
    $('#choice-note').textContent = choice.source === 'chest' ? 'Skrzynia częściej skrywa rzadkie dary. Wybierz jeden.' : 'Wybierz jedno ulepszenie.';
    $('#choice-cards').innerHTML = choice.options.map((id) => (isSkillUpgradeId(id) ? this.skillUpgradeCard(id, hero) : this.statCard(id as UpgradeId, hero))).join('');
  }

  private statCard(id: UpgradeId, hero: Hero): string {
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
  }

  /** An upgrade of one skill: which skill, what changes in words, and the exact numbers (old → new). */
  private skillUpgradeCard(id: string, hero: Hero): string {
    const u = SKILL_UPGRADES[id]!;
    const have = hero.skillUpgrades[id] ?? 0;
    const max = u.levels.length;
    const lines = describeStep(u, have, have + 1)
      .map((l) => `<li><span>${l.name}</span><b>${l.from ? `${l.from} → ${l.value}` : l.value}</b></li>`)
      .join('');
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < have ? 'on' : i === have ? 'next' : ''}"></i>`).join('');
    return `
      <button class="card card-up card-skillup" type="button" data-up="${id}">
        <span class="card-role up-skill"><span class="up-icon">${icon(u.skill)}</span>Ulepszenie · ${SKILLS[u.skill].name}</span>
        <span class="card-name">${u.name}</span>
        <span class="card-text">${u.summary}</span>
        <ul class="up-lines">${lines}</ul>
        <span class="pips" aria-label="Poziom ${have + 1} z ${max}">${pips}</span>
      </button>`;
  }

  renderSheet(hero: Hero): void {
    const s = hero.stats;
    const row = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    const ups = (Object.keys(hero.upgrades) as UpgradeId[]).filter((id) => hero.upgrades[id] > 0);
    const reactions = [...new Map(hero.skills.flatMap((sl) => synergiesOf(sl.def.id)).map((x) => [x.id, x])).values()];
    const sups = Object.entries(hero.skillUpgrades).filter(([id, lv]) => lv > 0 && SKILL_UPGRADES[id]);
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
        ${row('Umiejętności', hero.skills.map((sl) => sl.def.name).join(', '))}
      </dl>
      <h4 class="sheet-sub">Ulepszenia z tej wyprawy</h4>
      ${
        ups.length === 0
          ? '<p class="sheet-empty">Jeszcze żadnych — zdobywaj poziomy i otwieraj skrzynie.</p>'
          : `<ul class="sheet-ups">${ups.map((id) => `<li><b>${UPGRADES[id].name}</b> <span>${hero.upgrades[id]}/${UPGRADES[id].maxStacks}</span><em>${UPGRADES[id].text}</em></li>`).join('')}</ul>`
      }
      <h4 class="sheet-sub">Reakcje twoich umiejętności</h4>
      ${
        reactions.length === 0
          ? '<p class="sheet-empty">Żadna z noszonych umiejętności nie wchodzi w reakcje ze statusami.</p>'
          : `<ul class="sheet-ups">${reactions.map((x) => `<li><b>${x.name}</b><em>${x.text}</em></li>`).join('')}</ul>`
      }
      <h4 class="sheet-sub">Statusy</h4>
      <ul class="sheet-ups">${STATUS_LIST.map((x) => `<li><b>${x.name}</b><em>${x.text}</em></li>`).join('')}</ul>
      <h4 class="sheet-sub">Ulepszenia umiejętności</h4>
      ${
        sups.length === 0
          ? '<p class="sheet-empty">Jeszcze żadnych — pojawiają się obok zwykłych ulepszeń.</p>'
          : `<ul class="sheet-ups">${sups.map(([id, lv]) => `<li><b>${SKILL_UPGRADES[id]!.name}</b> <span>${lv}/${SKILL_UPGRADES[id]!.levels.length}</span><em>${SKILLS[SKILL_UPGRADES[id]!.skill].name} — ${SKILL_UPGRADES[id]!.summary}</em></li>`).join('')}</ul>`
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
    $('#end-unlocked').innerHTML = r.unlocked.length
      ? '<p class="end-loot-h">Odblokowane umiejętności</p><ul>' + r.unlocked.map((id) => '<li style="--r:var(--ember-hot)">' + icon(id) + SKILLS[id].name + '</li>').join('') + '</ul>'
      : '';
    $('#end-loot').innerHTML = r.loot.length
      ? '<p class="end-loot-h">Zdobyte przedmioty — zostają w ekwipunku</p><ul>' +
        r.loot
          .map((i) => '<li style="--r:' + RARITY[i.rarity].css + '"><svg aria-hidden="true"><use href="#' + BASES[i.base]!.icon + '" /></svg>' + i.name + '</li>')
          .join('') +
        '</ul>'
      : '';
  }
}

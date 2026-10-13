import { HEROES, type HeroId } from '../config/heroes';
import { BASES, EFFECTS, RARITY, SLOTS, SLOT_NAMES, STAT_NAMES, formatStat, type Item, type Slot, type StatKey } from '../config/items';
import { bagItems, canEquip, equippedItems, type SaveData } from '../meta/save';
import { salvageValue } from '../sim/loot';
import type { HeroStats } from '../sim/types';
import { $ } from './hud';

export interface InventoryActions {
  equip(hero: HeroId, uid: string): void;
  unequip(hero: HeroId, slot: Slot): void;
  salvage(uid: string): void;
  /** Stats of a hero wearing the given gear (with the current run's upgrades, if any). */
  statsFor(hero: HeroId, gear: Item[]): HeroStats;
}

const icon = (id: string) => `<svg aria-hidden="true"><use href="#${id}" /></svg>`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('pl-PL');

/**
 * The equipment screen: what the hero wears, the shared bag, and a detail card
 * that compares the selected item with the one in the same slot.
 */
export class InventoryScreen {
  hero: HeroId = 'warden';
  /** Run in progress: only the current hero can be dressed. */
  locked = false;
  private selected: string | null = null;
  private save: SaveData | null = null;

  constructor(private readonly act: InventoryActions) {
    $('#inv-tabs').addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as HeroId | undefined;
      if (!id || this.locked) return;
      this.hero = id;
      this.selected = null;
      this.render();
    });
    const pick = (e: Event) => {
      const uid = (e.target as HTMLElement).closest<HTMLElement>('[data-uid]')?.dataset.uid;
      if (!uid) return;
      this.selected = uid;
      this.render();
    };
    $('#inv-slots').addEventListener('click', pick);
    $('#inv-bag').addEventListener('click', pick);
    $('#inv-detail').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-act]');
      if (!btn || !this.save) return;
      const item = this.save.inventory.items.find((i) => i.uid === this.selected);
      if (!item) return;
      if (btn.dataset.act === 'equip') this.act.equip(this.hero, item.uid);
      else if (btn.dataset.act === 'unequip') this.act.unequip(this.hero, BASES[item.base]!.slot);
      else if (btn.dataset.act === 'salvage') {
        this.act.salvage(item.uid);
        this.selected = null;
      }
      this.render();
    });
  }

  open(save: SaveData, hero: HeroId, locked: boolean): void {
    this.save = save;
    this.hero = hero;
    this.locked = locked;
    this.selected = null;
    this.render();
  }

  render(): void {
    const save = this.save;
    if (!save) return;
    $('#inv-ash').textContent = String(save.ash);
    $('#inv-tabs').innerHTML = (Object.keys(HEROES) as HeroId[])
      .filter((h) => !this.locked || h === this.hero)
      .map((h) => `<button class="tab ${h === this.hero ? 'is-on' : ''}" type="button" role="tab" aria-selected="${h === this.hero}" data-tab="${h}">${HEROES[h].name}</button>`)
      .join('');

    const worn = equippedItems(save, this.hero);
    const bySlot = new Map<Slot, Item>(worn.map((i) => [BASES[i.base]!.slot, i]));
    $('#inv-slots').innerHTML = SLOTS.map((slot) => {
      const it = bySlot.get(slot);
      if (!it) return `<div class="slot is-empty"><span class="slot-icon">${icon('i-bag')}</span><span class="slot-text"><b>${SLOT_NAMES[slot]}</b><em>pusty</em></span></div>`;
      return `<button class="slot ${it.uid === this.selected ? 'is-sel' : ''}" type="button" data-uid="${it.uid}" style="--r:${RARITY[it.rarity].css}">
        <span class="slot-icon">${icon(BASES[it.base]!.icon)}</span>
        <span class="slot-text"><b>${it.name}</b><em>${SLOT_NAMES[slot]} · poz. ${it.ilvl}</em></span>
      </button>`;
    }).join('');

    const s = this.act.statsFor(this.hero, worn);
    const row = (k: string, v: string) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    $('#inv-stats').innerHTML = [
      row('Zdrowie', String(s.maxHp)),
      row('Obrażenia', fmt(s.damage)),
      row('Ataki / s', fmt(1 / s.attackInterval, 2)),
      row('Redukcja', pct(s.armor)),
      row('Krytyk', `${pct(s.critChance)} · ×${fmt(s.critMult, 2)}`),
      row('Ruch', fmt(s.moveSpeed, 2)),
    ].join('');

    const bag = bagItems(save).sort((a, b) => rarityRank(b) - rarityRank(a) || b.ilvl - a.ilvl);
    $('#inv-count').textContent = `Torba ${bag.length} / 30`;
    $('#inv-bag').innerHTML =
      bag.length === 0
        ? '<p class="bag-empty">Pusto. Przedmioty wypadają z wrogów, skrzyń i bossów.</p>'
        : bag
            .map(
              (it) => `<button class="tile ${it.uid === this.selected ? 'is-sel' : ''} ${canEquip(it, this.hero) ? '' : 'is-other'}" type="button" data-uid="${it.uid}" style="--r:${RARITY[it.rarity].css}" aria-label="${it.name}">
          ${icon(BASES[it.base]!.icon)}<span class="tile-lvl">${it.ilvl}</span>${it.effect ? '<i class="tile-fx"></i>' : ''}
        </button>`,
            )
            .join('');

    this.renderDetail(save, bySlot);
  }

  private renderDetail(save: SaveData, bySlot: Map<Slot, Item>): void {
    const box = $('#inv-detail');
    const it = save.inventory.items.find((i) => i.uid === this.selected);
    if (!it) {
      box.innerHTML = '<p class="detail-hint">Dotknij przedmiotu, żeby zobaczyć jego statystyki i porównać z tym, co nosisz.</p>';
      return;
    }
    const base = BASES[it.base]!;
    const current = bySlot.get(base.slot);
    const wearing = current?.uid === it.uid;
    const lines = (Object.entries(it.stats) as [StatKey, number][])
      .map(([k, v]) => `<li><span>${STAT_NAMES[k]}</span><b>${formatStat(k, v)}</b></li>`)
      .join('');
    let compare = '';
    if (!wearing && canEquip(it, this.hero)) {
      const worn = equippedItems(save, this.hero);
      const before = this.act.statsFor(this.hero, worn);
      const after = this.act.statsFor(this.hero, [...worn.filter((w) => BASES[w.base]!.slot !== base.slot), it]);
      const diffs: [string, number, (v: number) => string][] = [
        ['Zdrowie', after.maxHp - before.maxHp, (v) => String(Math.round(v))],
        ['Obrażenia', after.damage - before.damage, (v) => fmt(v)],
        ['Ataki / s', 1 / after.attackInterval - 1 / before.attackInterval, (v) => fmt(v, 2)],
        ['Redukcja', after.armor - before.armor, (v) => pct(v)],
        ['Krytyk', after.critChance - before.critChance, (v) => pct(v)],
        ['Obr. krytyczne', after.critMult - before.critMult, (v) => `${Math.round(v * 100)}%`],
        ['Zasięg', after.attackRange - before.attackRange, (v) => fmt(v, 2)],
        ['Odnowienie', before.skillCooldownMult - after.skillCooldownMult, (v) => pct(v)],
        ['Ruch', after.moveSpeed - before.moveSpeed, (v) => fmt(v, 2)],
      ];
      const shown = diffs.filter(([, d]) => Math.abs(d) > 1e-3);
      compare = shown.length
        ? `<ul class="compare">${shown.map(([k, d, f]) => `<li class="${d > 0 ? 'up' : 'down'}"><span>${k}</span><b>${d > 0 ? '+' : '−'}${f(Math.abs(d))}</b></li>`).join('')}</ul>`
        : '';
    }
    const fx = it.effect ? `<p class="detail-fx"><b>${EFFECTS[it.effect].name}.</b> ${EFFECTS[it.effect].text}</p>` : '';
    const forOther = !canEquip(it, this.hero) ? `<p class="detail-note">Tylko dla: ${HEROES[base.hero!].name}.</p>` : '';
    const actions = [
      wearing
        ? '<button class="btn btn-ghost btn-sm" type="button" data-act="unequip">Zdejmij</button>'
        : canEquip(it, this.hero)
          ? `<button class="btn btn-primary btn-sm" type="button" data-act="equip">${current ? 'Zamień' : 'Załóż'}</button>`
          : '',
      !wearing && !isWornByOther(save, it.uid) ? `<button class="btn btn-ghost btn-sm" type="button" data-act="salvage">Rozbierz · +${salvageValue(it)} popiołu</button>` : '',
    ].join('');
    box.innerHTML = `
      <div class="detail-head" style="--r:${RARITY[it.rarity].css}">
        <span class="slot-icon">${icon(base.icon)}</span>
        <div><h3>${it.name}</h3><p>${RARITY[it.rarity].name} · ${SLOT_NAMES[base.slot]} · poziom ${it.ilvl}</p></div>
      </div>
      <ul class="lines">${lines}</ul>
      ${fx}${forOther}${compare}
      <div class="detail-actions">${actions}</div>`;
  }
}

function rarityRank(i: Item): number {
  return ['common', 'rare', 'epic', 'legendary'].indexOf(i.rarity);
}

function isWornByOther(save: SaveData, uid: string): boolean {
  return Object.values(save.inventory.equipped).some((lo) => Object.values(lo).includes(uid));
}

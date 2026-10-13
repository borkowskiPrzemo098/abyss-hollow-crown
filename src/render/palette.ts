/**
 * The ABYSS palette. Deliberately narrow: cold stone darks, bone for the readable
 * neutrals, ember for everything that belongs to the hero, hollow teal for the
 * corruption that drives enemies, and blood red reserved for danger.
 */
export const PAL = {
  void: 0x07080a,
  stone0: 0x101116,
  stone1: 0x171920,
  stone2: 0x1f222a,
  stone3: 0x2a2e38,
  stone4: 0x3a3f4b,
  stone5: 0x535a68,
  bone: 0xe8e0cc,
  ash: 0x8f8a80,
  ember: 0xf08a3c,
  emberHot: 0xffc073,
  emberDeep: 0xb8461f,
  hollow: 0x6be3d4,
  hollowDeep: 0x2a8a85,
  danger: 0xff3b30,
  dangerDeep: 0xa5161f,
  gold: 0xd6b25e,
} as const;

export const css = (c: number, a = 1): string =>
  `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

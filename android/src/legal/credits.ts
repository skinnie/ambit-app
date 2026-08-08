// Mirrors /home/skinnie/ambit-app/CREDITS.md — kept in sync by hand since that
// file lives in a separate research-project repo, not this one. This project's
// own protocol reverse-engineering leans directly on the real, working prior
// art listed here; see CREDITS.md itself for the full prose version.

export interface CreditEntry {
  name: string;
  url?: string;
  description: string;
}

export const CREDITS: CreditEntry[] = [
  {
    name: 'openambit',
    url: 'https://github.com/openambitproject/openambit',
    description:
      "And its contributors, especially Emil Ljungdahl (libambit's original author) — the " +
      'real, working reference implementation this project checks its own findings against ' +
      "throughout. libambit's design is the foundation this app's own native code is written " +
      'to sit alongside.',
  },
  {
    name: 'opensportsync',
    url: 'https://github.com/guiguoz/opensportsync',
    description: "And its author — the React Native base this app was forked from.",
  },
  {
    name: 'marguslt',
    url: 'https://github.com/marguslt',
    description:
      'Several independent, real contributions: the firmware-download-link recipe, the ' +
      'workout/App-Zone gists, and openmoves.',
  },
  {
    name: 'sebchastang',
    url: 'https://forum.suunto.com/user/sebchastang',
    description:
      'Author of a complete, published set of real interval-training Suunto Apps, ' +
      "maintained through Movescount's actual 2022 shutdown.",
  },
  {
    name: 'Pavel Samokha and the Suunto forum community',
    url: 'https://forum.suunto.com/topic/7592',
    description:
      'The documented, confirmed-real mechanism for adding a compiled Suunto App to ' +
      "SuuntoLink's own catalog.",
  },
  {
    name: 'wanarun.net',
    url: 'https://wanarun.net',
    description:
      'Independent confirmation of the structured-workout JSON schema this project targets.',
  },
];

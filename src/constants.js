// Court geometry, tuning constants and team data.
// All distances in meters, matching official NBA dimensions.

export const COURT = {
  LEN: 28.65,            // 94 ft baseline to baseline
  WID: 15.24,            // 50 ft sideline to sideline
  HALF_LEN: 14.325,
  HALF_WID: 7.62,
  APRON: 2.4,            // out-of-bounds walkway width around the floor
  RIM_HEIGHT: 3.048,     // 10 ft
  RIM_R: 0.2286,         // 18 in inner diameter
  RIM_TUBE: 0.019,
  RIM_X: 12.72,          // |x| of rim center
  BOARD_X: 13.105,       // |x| of backboard front face (4 ft from baseline)
  BOARD_W: 1.829,        // 6 ft glass
  BOARD_H: 1.067,        // 3.5 ft glass
  BOARD_BOTTOM: 2.95,
  FT_X: 8.535,           // |x| of the free-throw line
  KEY_W: 4.88,           // 16 ft key width
  FT_CIRCLE_R: 1.8,
  RESTRICTED_R: 1.22,
  THREE_R: 7.24,         // 23.75 ft arc
  THREE_CORNER_Z: 6.71,  // 22 ft corner distance (line 3 ft from sideline)
  CENTER_R: 1.83,
  BALL_R: 0.121,
};

// x beyond which (toward the attacked baseline) the 3pt line is the straight corner segment
export const CORNER_BREAK_X =
  COURT.RIM_X - Math.sqrt(COURT.THREE_R * COURT.THREE_R - COURT.THREE_CORNER_Z * COURT.THREE_CORNER_Z);

/** True if a shot from `pos` at the hoop whose rim x is `rimX` (signed) is a three. */
export function isThreePoint(pos, rimX) {
  const sideSign = Math.sign(rimX);
  if (pos.x * sideSign > CORNER_BREAK_X) {
    return Math.abs(pos.z) > COURT.THREE_CORNER_Z - 0.05;
  }
  const dx = pos.x - rimX;
  const dz = pos.z;
  return Math.hypot(dx, dz) > COURT.THREE_R - 0.05;
}

export const PHYS = {
  GRAVITY: 9.81,
  FLOOR_REST: 0.80,      // ball/floor restitution
  RIM_REST: 0.42,
  BOARD_REST: 0.68,
  BALL_SUBSTEP: 1 / 240,
};

export const TUNE = {
  RUN_SPEED: 5.3,
  SPRINT_SPEED: 7.1,
  BALL_SPEED_MULT: 0.94,  // ball-handler is slightly slower
  DEF_SPEED_MULT: 0.98,
  ACCEL: 22,
  FRICTION: 14,
  PLAYER_RADIUS: 0.42,
  TURN_RATE: 11,
  METER_TIME: 1.05,       // seconds for the shot meter to fill
  METER_PERFECT: 0.80,    // meter position of a perfect release
  METER_WINDOW: 0.075,    // half-width of the green window
  PASS_SPEED: 13.5,
  STEAL_RANGE: 1.35,
  STEAL_COOLDOWN: 1.6,
  PICKUP_RANGE: 0.62,
  CATCH_RANGE: 0.62,
  INTERCEPT_RANGE: 0.42,
  BLOCK_RANGE: 0.52,
  JUMP_SPEED: 4.3,
  SHOT_CLOCK: 24,
  QUARTER_MINUTES: 3,
  OVERTIME_MINUTES: 1,
};

export const ROLES = ['PG', 'SG', 'SF', 'PF', 'C'];

// Base attributes per role, 0..1 scale. Each roster entry can nudge these.
export const ROLE_ATTRS = {
  PG: { spd: 0.93, three: 0.84, mid: 0.80, close: 0.72, dunk: 0.45, steal: 0.86, block: 0.25, reb: 0.34, pass: 0.93, h: 1.88 },
  SG: { spd: 0.89, three: 0.88, mid: 0.82, close: 0.76, dunk: 0.62, steal: 0.74, block: 0.38, reb: 0.42, pass: 0.74, h: 1.96 },
  SF: { spd: 0.84, three: 0.78, mid: 0.79, close: 0.82, dunk: 0.78, steal: 0.66, block: 0.55, reb: 0.60, pass: 0.68, h: 2.01 },
  PF: { spd: 0.76, three: 0.62, mid: 0.70, close: 0.87, dunk: 0.86, steal: 0.52, block: 0.76, reb: 0.86, pass: 0.55, h: 2.06 },
  C:  { spd: 0.70, three: 0.34, mid: 0.56, close: 0.93, dunk: 0.94, steal: 0.45, block: 0.92, reb: 0.95, pass: 0.50, h: 2.11 },
};

export const SKIN_TONES = [0xf1c8a6, 0xd9a066, 0xb07b4f, 0x8a5a33, 0x6b4226, 0x503018];

// Team palette + fictional rosters (name, number, skin tone index, hair style, attr mods).
export const TEAMS = [
  {
    id: 'LAL', city: 'Los Angeles', name: 'Stars',
    primary: 0x552583, secondary: 0xfdb927, dark: 0x2e1449,
    roster: [
      { name: 'D. Rivers',   num: 3,  skin: 4, hair: 'short', mods: { pass: 0.03, three: 0.03 } },
      { name: 'K. Monroe',   num: 8,  skin: 2, hair: 'band',  mods: { three: 0.04 } },
      { name: 'A. Vance',    num: 23, skin: 3, hair: 'short', mods: { dunk: 0.06, close: 0.03 } },
      { name: 'T. Holloway', num: 12, skin: 1, hair: 'buzz',  mods: { reb: 0.02 } },
      { name: 'M. Okafor',   num: 55, skin: 5, hair: 'bald',  mods: { block: 0.03 } },
    ],
  },
  {
    id: 'BOS', city: 'Boston', name: 'Shamrocks',
    primary: 0x007a33, secondary: 0xf5f5f0, dark: 0x00461d,
    roster: [
      { name: 'C. Walsh',    num: 4,  skin: 0, hair: 'short', mods: { steal: 0.04 } },
      { name: 'R. Byrne',    num: 20, skin: 1, hair: 'buzz',  mods: { three: 0.05 } },
      { name: 'L. Freeman',  num: 0,  skin: 4, hair: 'band',  mods: { mid: 0.04, dunk: 0.03 } },
      { name: 'S. Kowalski', num: 41, skin: 0, hair: 'short', mods: { close: 0.02 } },
      { name: 'V. Dukic',    num: 17, skin: 1, hair: 'bald',  mods: { reb: 0.03 } },
    ],
  },
  {
    id: 'GSW', city: 'Golden State', name: 'Waves',
    primary: 0x1d428a, secondary: 0xffc72c, dark: 0x0d2149,
    roster: [
      { name: 'S. Chen',     num: 30, skin: 0, hair: 'short', mods: { three: 0.08, spd: 0.02 } },
      { name: 'A. Torres',   num: 11, skin: 2, hair: 'buzz',  mods: { three: 0.05 } },
      { name: 'J. Whitfield',num: 22, skin: 3, hair: 'band',  mods: { steal: 0.03 } },
      { name: 'N. Adeyemi',  num: 5,  skin: 5, hair: 'bald',  mods: { dunk: 0.05 } },
      { name: 'B. Larsson',  num: 33, skin: 0, hair: 'short', mods: { block: 0.02, mid: 0.04 } },
    ],
  },
  {
    id: 'CHI', city: 'Chicago', name: 'Stampede',
    primary: 0xce1141, secondary: 0x0e0e10, dark: 0x6d0a24,
    roster: [
      { name: 'M. Novak',    num: 1,  skin: 1, hair: 'buzz',  mods: { spd: 0.03 } },
      { name: 'D. Carter',   num: 45, skin: 4, hair: 'bald',  mods: { mid: 0.07, dunk: 0.04 } },
      { name: 'E. Laurent',  num: 9,  skin: 3, hair: 'short', mods: { three: 0.03 } },
      { name: 'H. Grant',    num: 54, skin: 2, hair: 'short', mods: { reb: 0.04 } },
      { name: 'O. Petrov',   num: 13, skin: 0, hair: 'buzz',  mods: { block: 0.04 } },
    ],
  },
  {
    id: 'NYK', city: 'New York', name: 'Empire',
    primary: 0x006bb6, secondary: 0xf58426, dark: 0x003a63,
    roster: [
      { name: 'F. Romano',   num: 7,  skin: 1, hair: 'short', mods: { pass: 0.04 } },
      { name: 'T. Brooks',   num: 24, skin: 4, hair: 'band',  mods: { three: 0.04, mid: 0.02 } },
      { name: 'I. Okonkwo',  num: 18, skin: 5, hair: 'buzz',  mods: { dunk: 0.05 } },
      { name: 'G. Papas',    num: 34, skin: 1, hair: 'bald',  mods: { close: 0.04 } },
      { name: 'W. Duval',    num: 50, skin: 3, hair: 'bald',  mods: { reb: 0.05 } },
    ],
  },
  {
    id: 'MIA', city: 'Miami', name: 'Tide',
    primary: 0x98002e, secondary: 0xf9a01b, dark: 0x4d0017,
    roster: [
      { name: 'R. Delgado',  num: 6,  skin: 2, hair: 'short', mods: { steal: 0.05 } },
      { name: 'J. Baptiste', num: 14, skin: 5, hair: 'buzz',  mods: { three: 0.03, spd: 0.02 } },
      { name: 'K. Osei',     num: 2,  skin: 4, hair: 'band',  mods: { dunk: 0.06 } },
      { name: 'P. Silva',    num: 40, skin: 2, hair: 'short', mods: { mid: 0.03 } },
      { name: 'Y. Haddad',   num: 21, skin: 3, hair: 'bald',  mods: { block: 0.05, reb: 0.02 } },
    ],
  },
];

// Half-court offensive spots for a team attacking toward +x (mirror x by attack sign).
// Indexed by role: PG top, SG right wing, SF left wing, PF left corner, C right dunker spot.
export const OFFENSE_SPOTS = [
  { x: 4.6,  z: 0.0 },
  { x: 7.3,  z: -5.5 },
  { x: 7.3,  z: 5.5 },
  { x: 12.2, z: 6.7 },
  { x: 11.3, z: -2.6 },
];

// Alternate spots used for cuts / v-cuts.
export const CUT_SPOTS = [
  { x: 6.9,  z: -2.2 },
  { x: 12.2, z: -6.7 },
  { x: 10.4, z: 3.4 },
  { x: 9.3,  z: 4.4 },
  { x: 11.0, z: 2.4 },
];

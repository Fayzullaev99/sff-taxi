import type { Shape } from '../core';
import type { uz } from '../uz';
import { apply } from './apply';
import { auth } from './auth';
import { common } from './common';
import { home } from './home';
import { intercity } from './intercity';
import { money } from './money';
import { profile } from './profile';
import { ride } from './ride';

/** The Russian dictionary: the same keys as the Uzbek one, by type. */
export const ru: Shape<typeof uz> = {
  common,
  auth,
  apply,
  home,
  ride,
  money,
  intercity,
  profile,
};

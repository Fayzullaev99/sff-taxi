import type { Shape } from '../core';
import type { uz } from '../uz';
import { auth } from './auth';
import { common } from './common';
import { history } from './history';
import { home } from './home';
import { intercity } from './intercity';
import { order } from './order';
import { payments } from './payments';
import { profile } from './profile';
import { ride } from './ride';
import { support } from './support';

/** The Russian dictionary: the same keys as the Uzbek one, by type. */
export const ru: Shape<typeof uz> = {
  common,
  auth,
  home,
  order,
  ride,
  history,
  profile,
  support,
  intercity,
  payments,
};

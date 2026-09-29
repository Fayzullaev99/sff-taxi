import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { Banner, Button, IconButton } from '../ui/primitives';
import { colors, space } from '../ui/theme';
import type { Fix } from './fix';
import { enableLocationServices, findMe, type LocateMode, openAppSettings } from './geo';
import { type LocationProblem, locationProblemText } from './locate';

export interface Located {
  fix: Fix;
  /** Met the precise rules (fresh, within 50 m); false: the best there was. */
  precise: boolean;
}

/**
 * "Where am I" for a screen: runs lookups (shared app-wide, see findMe), remembers why
 * the last one failed and fixes it with the rider (ask again, the settings, switch
 * location on). Back from the settings, it quietly tries again and reports a position
 * through `onFound`.
 */
export function useLocator(onFound: (located: Located) => void) {
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<LocationProblem | null>(null);
  const alive = useRef(true);
  const found = useRef(onFound);
  found.current = onFound;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const locate = useCallback(
    async (mode: LocateMode = 'precise', ask = true): Promise<Located | null> => {
      setLocating(true);
      const result = await findMe(mode, ask);
      if (!alive.current) return null;
      setLocating(false);
      if (!result.ok) {
        setProblem(result.problem);
        return null;
      }
      setProblem(null);
      return { fix: result.fix, precise: result.precise };
    },
    [],
  );

  /** Locates and hands the position to `onFound`. */
  const locateAndReport = useCallback(
    async (mode: LocateMode = 'precise', ask = true) => {
      const r = await locate(mode, ask);
      if (r && alive.current) found.current(r);
      return r;
    },
    [locate],
  );

  // back from the settings (permission or location switched on there): try again quietly
  useEffect(() => {
    if (problem !== 'blocked' && problem !== 'services_off' && problem !== 'denied') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void locateAndReport('precise', false);
    });
    return () => sub.remove();
  }, [problem, locateAndReport]);

  const solve = useCallback(async () => {
    if (!problem) return;
    const action = locationProblemText(problem, true).action;
    if (!action) {
      await locateAndReport('precise');
      return;
    }
    if (action.kind === 'settings') {
      openAppSettings();
      return;
    }
    if (action.kind === 'services') {
      const on = await enableLocationServices();
      if (on) await locateAndReport('precise');
      return;
    }
    await locateAndReport('precise', true);
  }, [problem, locateAndReport]);

  const dismiss = useCallback(() => setProblem(null), []);

  return { locating, problem, locate, locateAndReport, solve, dismiss };
}

/** Why there is no position and the one button that helps; closable. */
export function LocationNotice({
  problem,
  withMap,
  onSolve,
  onDismiss,
}: {
  problem: LocationProblem | null;
  withMap: boolean;
  onSolve: () => void;
  onDismiss: () => void;
}) {
  if (!problem) return null;
  const text = locationProblemText(problem, withMap);
  return (
    <View>
      <Banner
        tone="warning"
        icon="location-outline"
        title={text.title}
        message={text.message}
        action={
          <Button
            title={text.action?.label ?? 'Qayta urinish'}
            size="sm"
            variant="secondary"
            onPress={onSolve}
            style={styles.action}
          />
        }
        style={styles.banner}
      />
      <IconButton
        name="close"
        label="Yopish"
        size={44}
        background="transparent"
        color={colors.textMuted}
        onPress={onDismiss}
        style={styles.close}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingRight: space(11) },
  action: { alignSelf: 'flex-start', marginTop: space(2) },
  close: { position: 'absolute', top: 0, right: 0 },
});

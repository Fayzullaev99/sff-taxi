import { Platform, StyleSheet, View } from 'react-native';
import { Polygon, UrlTile } from 'react-native-maps';
import type { GeoConfig } from '../api/types';
import { T } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';
import { ringToCoordinates } from './service-area';

/**
 * Tiles the API tells the apps to use. With `provider: "osm"` the configured tile server
 * replaces the platform base map (Google on Android, Apple on iOS); Yandex tiles may only
 * be shown through Yandex's own SDK, so with "yandex" the platform map stays.
 */
export function usesTiles(config: GeoConfig | undefined): config is GeoConfig {
  return config?.provider === 'osm' && Boolean(config.osm.tileUrl);
}

export function mapTypeFor(config: GeoConfig | undefined) {
  // Android can hide the Google base map entirely; iOS replaces it via the tile layer
  return usesTiles(config) && Platform.OS === 'android' ? ('none' as const) : ('standard' as const);
}

export function TileLayer({ config }: { config: GeoConfig | undefined }) {
  if (!usesTiles(config)) return null;
  return (
    <UrlTile
      urlTemplate={config.osm.tileUrl}
      maximumZ={config.osm.maxZoom}
      shouldReplaceMapContent
      tileSize={256}
      zIndex={-1}
    />
  );
}

/** Outlines of the active service areas. */
export function ServiceAreas({ config }: { config: GeoConfig | undefined }) {
  if (!config) return null;
  return (
    <>
      {config.cities
        .filter((c) => c.isActive && c.boundary[0]?.length)
        .map((c) => (
          <Polygon
            key={c.id}
            coordinates={ringToCoordinates(c.boundary[0]!)}
            holes={c.boundary.slice(1).map(ringToCoordinates)}
            strokeColor={colors.brandPressed}
            strokeWidth={2}
            fillColor="rgba(255,196,0,0.08)"
          />
        ))}
    </>
  );
}

/** The tile provider's required attribution ("© OpenStreetMap contributors"). */
export function Attribution({ config }: { config: GeoConfig | undefined }) {
  if (!usesTiles(config) || !config.osm.attribution) return null;
  return (
    <View pointerEvents="none" style={styles.attribution}>
      <T variant="caption" color={colors.textMuted}>
        {config.osm.attribution}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  attribution: {
    position: 'absolute',
    left: space(2),
    bottom: space(2),
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: radius.sm,
    paddingHorizontal: space(1.5),
    paddingVertical: 2,
  },
});

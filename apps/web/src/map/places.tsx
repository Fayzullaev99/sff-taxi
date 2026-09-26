import { useQuery } from '@tanstack/react-query';
import { MapPin, Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { api, errorText } from '../api/client';
import type { GeoAddress, GeoConfig, LatLng, ReverseResult } from '../api/types';
import { Badge } from '../ui/controls';
import { Spinner } from '../ui/feedback';
import type { MapLayers } from './adapter';

/** Service areas as map layers: active cities green, upcoming ones dashed grey. */
export function cityLayers(config: GeoConfig): NonNullable<MapLayers['polygons']> {
  return config.cities.map((c) => ({
    id: c.id,
    rings: c.boundary,
    tone: c.isActive ? ('active' as const) : ('inactive' as const),
    title: c.isActive ? c.name : `${c.name} (tez orada)`,
  }));
}

export function addressLine(a: GeoAddress): string {
  return a.subtitle ? `${a.title}, ${a.subtitle}` : a.title;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** The address at a point (reverse geocoding), when the server has a geocoder. */
export function useReverse(config: GeoConfig | undefined, point: LatLng | null) {
  return useQuery({
    queryKey: ['geo-reverse', point?.lat.toFixed(5), point?.lng.toFixed(5)],
    queryFn: () =>
      api<ReverseResult>(`/v1/geo/reverse?lat=${point!.lat}&lng=${point!.lng}`, { auth: false }),
    enabled: Boolean(config && config.geocoder !== 'none' && point),
    staleTime: 5 * 60_000,
  });
}

/**
 * Address search with suggestions (Yandex → Nominatim on the server), biased to a point.
 * Arrow keys move through the suggestions, Enter picks, Escape closes.
 */
export function AddressSearch({
  config,
  near,
  label,
  placeholder = 'Ko‘cha, mahalla yoki mo‘ljal',
  onPick,
}: {
  config: GeoConfig;
  near: LatLng | null;
  label: string;
  placeholder?: string;
  onPick: (a: GeoAddress) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const q = useDebounced(query.trim(), 350);
  const bias = near ?? config.defaultCenter;
  const enabled = config.geocoder !== 'none';

  const search = useQuery({
    queryKey: ['geo-search', q, bias?.lat.toFixed(2), bias?.lng.toFixed(2)],
    queryFn: () => {
      const p = new URLSearchParams({ q });
      if (bias) {
        p.set('lat', String(bias.lat));
        p.set('lng', String(bias.lng));
      }
      return api<GeoAddress[]>(`/v1/geo/search?${p}`, { auth: false });
    },
    enabled: enabled && q.length >= 2,
    staleTime: 5 * 60_000,
  });
  const results = search.data ?? [];
  useEffect(() => setActive(0), [q]);

  if (!enabled) {
    return (
      <p className="muted small">
        Manzil qidiruvi serverda sozlanmagan: nuqtani xaritada belgilang.
      </p>
    );
  }

  const pick = (a: GeoAddress) => {
    onPick(a);
    setOpen(false);
    setQuery('');
  };
  const showList = open && q.length >= 2 && !search.isPending;

  return (
    <div className="address-search">
      <div className="search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-label={label}
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const hit = results[active] ?? results[0];
              if (hit) pick(hit);
            }
          }}
        />
        {search.isFetching && <Spinner size={14} />}
      </div>
      {showList && (
        <ul className="address-results" id={listId} role="listbox" aria-label={label}>
          {search.error ? (
            <li className="muted">{errorText(search.error)}</li>
          ) : results.length ? (
            results.map((a, i) => (
              <li
                key={`${a.lat},${a.lng},${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  className={i === active ? 'is-active' : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(a)}
                >
                  <MapPin size={14} aria-hidden />
                  <span>
                    <strong>{a.title}</strong>
                    {a.subtitle && <span className="muted"> {a.subtitle}</span>}
                  </span>
                  {a.serviceable === false && <Badge tone="amber">hududdan tashqari</Badge>}
                </button>
              </li>
            ))
          ) : (
            <li className="muted">Hech narsa topilmadi — nuqtani xaritada belgilang</li>
          )}
        </ul>
      )}
    </div>
  );
}

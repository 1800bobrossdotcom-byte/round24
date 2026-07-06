import { useMemo, useState } from 'react';
import seed from '../data/seed.json';

export function useStore() {
  const [range, setRange] = useState({ from: '2026-05-11', to: '2026-07-05' });
  const propById = useMemo(() => Object.fromEntries(seed.properties.map((p) => [p.id, p])), []);
  const techById = useMemo(() => Object.fromEntries(seed.techs.map((t) => [t.id, t])), []);

  const timers = useMemo(
    () => seed.timers.filter((t) => t.date >= range.from && t.date <= range.to),
    [range]
  );

  return {
    meta: seed.meta,
    properties: seed.properties,
    techs: seed.techs,
    allTimers: seed.timers,
    timers,
    range, setRange,
    propById, techById,
  };
}

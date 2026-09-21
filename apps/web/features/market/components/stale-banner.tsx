import type { ConnectionState } from '../socket/types';

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return 'AWAITING FIRST LIVE UPDATE';
  if (ageMs < 1_000) return `${Math.max(0, Math.round(ageMs))}MS AGO`;
  return `${(ageMs / 1_000).toFixed(1)}S AGO`;
}

export function StaleBanner(props: {
  readonly connection: ConnectionState;
  readonly ageMs: number | null;
}) {
  const label = props.connection === 'ERROR' ? 'CONNECTION UNAVAILABLE' : 'RECONNECTING…';
  return (
    <div
      className="stale-banner shrink-0 h-7 px-3 flex items-center justify-between border border-ask border-t-0 bg-ask/10 text-ask text-[9px] tracking-wider font-mono select-none"
      role="status"
    >
      <strong>{label}</strong>
      <span>LAST LIVE UPDATE {formatAge(props.ageMs)}</span>
    </div>
  );
}

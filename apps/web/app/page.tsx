import { PROTOCOL_VERSION } from '@repo/protocol';

/**
 * Server Component shell. The terminal itself is a Client Component mounted here
 * from P10 onward — docs/00-architecture.md §5.
 */
export default function Page() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-lg font-semibold tracking-tight">Adaptive Crypto Trading Terminal</h1>
      <p className="text-sm text-neutral-400">
        Scaffold (P0) — protocol {PROTOCOL_VERSION}. Terminal lands in P10.
      </p>
    </main>
  );
}

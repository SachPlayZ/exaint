import { TradingTerminal } from '../features/market/terminal/trading-terminal';

/**
 * Server Component shell. The terminal itself is a Client Component mounted here
 * from P10 onward — docs/00-architecture.md §5.
 */
export default function Page() {
  return <TradingTerminal />;
}

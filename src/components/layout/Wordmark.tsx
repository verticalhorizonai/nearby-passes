// The header's wordmark (ruling 63). With passes on it reads "NEARby": "NEAR" in the primary green (#1F5C45, the
// "Try the demo" button's colour; 7.85:1 on the white app header, 7.35:1 on the page background; the rule is 4.5:1) and "by" in the header's
// own colour, same face, size and weight. Its spoken name stays "Nearby" (the two-tone text is hidden from screen
// readers and one "Nearby" is given instead). With passes off it is the plain "Nearby" as accepted.
import { PRODUCT_NAME } from '@/shared/types';
import { usePassesOnDeferred } from '@/hooks/useNearAccount';

export function Wordmark({ className }: { className: string }) {
  const passesOn = usePassesOnDeferred();
  if (!passesOn) {
    return (
      <span className={className} data-testid="wordmark">
        {PRODUCT_NAME}
      </span>
    );
  }
  return (
    <span className={className}>
      <span aria-hidden="true" data-testid="wordmark">
        <span className="text-primary">NEAR</span>by
      </span>
      <span className="sr-only">{PRODUCT_NAME}</span>
    </span>
  );
}

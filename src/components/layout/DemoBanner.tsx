// The demonstration banner: one slim banner at the top of every page, with the spec's full text on every width,
// phones included (spec 3.11.1; build ruling 14; REQ-05-05). With passes on it adds one sentence, and the browser tab
// reads "Nearby Passes" (ruling 60, PROPOSED); with passes off both are exactly as accepted.
import { useEffect } from 'react';
import { DEMONSTRATION_BANNER_TEXT } from '@/shared/types';
import { usePassesOnDeferred } from '@/hooks/useNearAccount';

export const PASSES_BANNER_SENTENCE = 'Passes run on NEAR testnet.';

export function DemoBanner() {
  const passesOn = usePassesOnDeferred();
  useEffect(() => {
    // The banner is on every page, so the tab's title follows passes here (index.html says "Nearby").
    document.title = passesOn ? 'Nearby Passes' : 'Nearby';
  }, [passesOn]);
  return (
    <div
      role="note"
      aria-label="Demonstration notice"
      className="bg-banner px-4 py-2 text-center text-xs leading-snug text-banner-foreground sm:px-6 sm:text-[13px]"
    >
      {DEMONSTRATION_BANNER_TEXT}
      {passesOn ? ` ${PASSES_BANNER_SENTENCE}` : null}
    </div>
  );
}

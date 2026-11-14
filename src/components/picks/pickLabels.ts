// The pick card's words, from one place (ruling 67): the two buttons and every text that names them. With passes off
// they are exactly as accepted ("Yes", "Not now", "Pick dismissed for this stop."); while passes are on, "Buy now" and
// "Hide pick", and the notices say hidden. The button words come from src/shared/types.ts, which the server shares.
import { PASSES_PICK_BUTTONS, PICK_BUTTONS } from '@/shared/types';
import { usePassesOnDeferred } from '@/hooks/useNearAccount';

export interface PickLabels {
  buy: string;
  hide: string;
  /** The line under the cards. */
  nothingBought: string;
  /** A pick said yes to and not paid. */
  payPending: string;
  hidden: string;
  cannotHide: string;
  hideFailed: string;
}

export const PICK_LABELS: PickLabels = {
  ...PICK_BUTTONS,
  nothingBought: `Nothing is bought until you tap ${PICK_BUTTONS.buy} and approve it on PayPal.`,
  payPending: `You said yes to this pick. Tap ${PICK_BUTTONS.buy} to pay with PayPal.`,
  hidden: 'Pick dismissed for this stop.',
  cannotHide: 'This pick can no longer be dismissed.',
  hideFailed: 'Could not dismiss this pick. Try again.',
};

export const PASSES_PICK_LABELS: PickLabels = {
  ...PASSES_PICK_BUTTONS,
  nothingBought: `Nothing is bought until you tap ${PASSES_PICK_BUTTONS.buy} and approve it on PayPal.`,
  payPending: `You said yes to this pick. Tap ${PASSES_PICK_BUTTONS.buy} to pay with PayPal.`,
  hidden: 'Pick hidden for this stop.',
  cannotHide: 'This pick can no longer be hidden.',
  hideFailed: 'Could not hide this pick. Try again.',
};

export function pickLabels(passesOn: boolean): PickLabels {
  return passesOn ? PASSES_PICK_LABELS : PICK_LABELS;
}

/** The pick card's words for this visitor: the passes-on words once the server says passes are on. */
export function usePickLabels(): PickLabels {
  return pickLabels(usePassesOnDeferred());
}

// The product's visible name, from one place (ruling 63): "NEARby" while passes are on, "Nearby" with passes off.
// Components use useProductName (useNearAccount.ts); code outside React (the API helper's messages) reads
// currentProductName, which follows the same answer from GET /api/near/account.
import { PASSES_PRODUCT_NAME, PRODUCT_NAME } from '@/shared/types';

let passesOnNow = false;

export function productName(passesOn: boolean): string {
  return passesOn ? PASSES_PRODUCT_NAME : PRODUCT_NAME;
}

/** Set by the account store when the server answers. */
export function setPassesOnNow(on: boolean): void {
  passesOnNow = on;
}

/** The name for text built outside a component. */
export function currentProductName(): string {
  return productName(passesOnNow);
}

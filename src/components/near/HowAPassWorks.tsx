// "How a pass works" (ruling 60, PROPOSED): with passes on, directly under the home page's hero, three steps in the
// home page's own step style. Edward's approved wording.
import type { ReactNode } from 'react';
import { PASSES_PRODUCT_NAME } from '@/shared/types';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3">
      <div className="font-display text-[44px] font-extrabold leading-none text-primary" aria-hidden="true">
        {n}
      </div>
      <h3 className="text-[19px] font-bold">{title}</h3>
      <p className="text-body-text">{children}</p>
    </li>
  );
}

export function HowAPassWorks() {
  return (
    <section aria-labelledby="pass-works-heading" className="border-y border-border bg-card" data-testid="how-a-pass-works">
      <div className="mx-auto flex max-w-content flex-col gap-8 px-4 py-[72px] sm:px-8">
        <h2 id="pass-works-heading" className="font-display text-4xl font-bold leading-tight tracking-[-0.015em]">
          How a pass works
        </h2>
        <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-6 p-0">
          <Step n={1} title="A shop funds it.">
            A merchant puts a small balance behind an offer. Each pass is an NFT the contract keeps until it is claimed.
          </Step>
          <Step n={2} title="The agent claims it for you.">
            When the offer fits one of your stops and you say yes, {PASSES_PRODUCT_NAME}&rsquo;s agent claims the pass into your NEAR account. Its key can call
            one method and cannot move money.
          </Step>
          <Step n={3} title="You are paid when you show up.">
            At the counter the merchant redeems the pass and the contract pays its balance to you. An unused pass returns its balance to the shop
            after it expires.
          </Step>
        </ol>
      </div>
    </section>
  );
}

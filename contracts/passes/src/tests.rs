//! Unit tests for the passes contract (spec 3.4.7; REQ-15-01 to REQ-15-07; ruling 49(d)).
//! Each test is named after the criterion it proves. No network: the mocked blockchain only.
//! Run: `cargo test` (add `-- --nocapture` to see the measured storage and the JSON shapes).

use super::*;
use near_sdk::mock::{with_mocked_blockchain, MockAction};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{borsh, testing_env, VMContext};
use std::panic::{catch_unwind, AssertUnwindSafe};

const NOW_MS: u64 = 1_794_441_600_000; // 2026-11-12
const HOUR_MS: u64 = 3_600_000;
const DAY_MS: u64 = 86_400_000;
const OFFER: &str = "00000000-0000-4000-8000-000000000101";
const OFFER2: &str = "00000000-0000-4000-8000-000000000102";
/// A realistic host length, so the measured storage is close to the deployed figure.
const MEDIA: &str = "https://nearby-passes-production.up.railway.app/passes/";
const TITLE: &str = "Saguaro Bean Co. pass";
const DESCRIPTION: &str = "Two coffees for the price of one.";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn contract_id() -> AccountId {
    acc("contract.nearby-passes.testnet")
}
fn owner() -> AccountId {
    acc("nearby-passes.testnet")
}
fn agent() -> AccountId {
    acc("agent.nearby-passes.testnet")
}
fn merchant() -> AccountId {
    acc("saguaro-bean.nearby-passes.testnet")
}
fn merchant2() -> AccountId {
    acc("noodle-bar.nearby-passes.testnet")
}
/// A 64-character implicit account, as 3.6.2 derives for a visitor.
fn shopper() -> AccountId {
    acc("4a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9")
}
fn shopper2() -> AccountId {
    acc("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
}
fn friend() -> AccountId {
    acc("friend.testnet")
}
fn value() -> NearToken {
    NearToken::from_millinear(100) // 0.1 NEAR
}
fn yocto(n: u128) -> NearToken {
    NearToken::from_yoctonear(n)
}

fn context(predecessor: &AccountId, deposit: NearToken, now_ms: u64) -> VMContext {
    VMContextBuilder::new()
        .current_account_id(contract_id())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor.clone())
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(1000))
        .block_timestamp(now_ms * 1_000_000)
        .build()
}

/// Starts a new call: fresh logs and receipts, storage carried over.
fn set(predecessor: &AccountId, deposit: NearToken, now_ms: u64) {
    testing_env!(context(predecessor, deposit, now_ms));
}

fn setup() -> Contract {
    set(&owner(), yocto(0), NOW_MS);
    Contract::new(owner(), agent(), MEDIA.to_string())
}

fn mint_n(c: &mut Contract, m: &AccountId, offer: &str, count: u32, expires_at_ms: u64) -> Vec<TokenId> {
    let deposit = value().saturating_mul(count as u128).saturating_add(NearToken::from_near(1));
    set(m, deposit, NOW_MS);
    c.mint_passes(offer.into(), TITLE.into(), DESCRIPTION.into(), value(), expires_at_ms, count)
}

fn claim(c: &mut Contract, m: &AccountId, offer: &str, to: &AccountId, now: u64) -> TokenId {
    set(&agent(), yocto(0), now);
    c.claim_pass(m.clone(), offer.into(), to.clone())
}

fn panic_message(e: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = e.downcast_ref::<String>() {
        s.clone()
    } else if let Some(s) = e.downcast_ref::<&str>() {
        s.to_string()
    } else {
        "<non-string panic>".to_string()
    }
}

/// Runs one call that is expected to fail, as the chain would: on a panic the contract state
/// and the storage are rolled back. Asserts that the failed call scheduled no receipt (no
/// payout, no refund) before the rollback. Returns the panic message.
fn refused<R>(c: &mut Contract, ctx: VMContext, f: impl FnOnce(&mut Contract) -> R) -> String {
    testing_env!(ctx.clone());
    let snapshot = with_mocked_blockchain(|b| b.take_storage());
    for (k, v) in &snapshot {
        env::storage_write(k, v);
    }
    testing_env!(ctx.clone());
    let state = borsh::to_vec(&*c).unwrap();
    match catch_unwind(AssertUnwindSafe(|| f(c))) {
        Ok(_) => panic!("the call was expected to fail but succeeded"),
        Err(e) => {
            assert!(get_created_receipts().is_empty(), "a refused call scheduled a receipt");
            *c = borsh::from_slice(&state).unwrap();
            with_mocked_blockchain(|b| {
                b.take_storage();
            });
            for (k, v) in &snapshot {
                env::storage_write(k, v);
            }
            testing_env!(ctx);
            panic_message(e)
        }
    }
}

fn assert_refused<R>(
    c: &mut Contract,
    ctx: VMContext,
    expected: &str,
    f: impl FnOnce(&mut Contract) -> R,
) {
    let msg = refused(c, ctx, f);
    assert!(msg.contains(expected), "expected a refusal containing {:?}, got {:?}", expected, msg);
}

/// The single transfer receipts of the last call: (receiver, amount), each the only action of
/// its receipt. A payout's `on_payout` callback (REQ-15-08) is a separate receipt on the
/// contract that waits on the transfer; it is checked here and left out of the list.
fn transfers() -> Vec<(AccountId, NearToken)> {
    let receipts = get_created_receipts();
    let mut out = vec![];
    for r in &receipts {
        assert_eq!(r.actions.len(), 1, "a payout must be the only action of its promise");
        match &r.actions[0] {
            MockAction::Transfer { deposit, .. } => out.push((r.receiver_id.clone(), *deposit)),
            MockAction::FunctionCallWeight { method_name, .. } if method_name == b"on_payout" => {
                assert_eq!(r.receiver_id, contract_id(), "the callback runs on the contract");
                assert_eq!(r.receipt_indices.len(), 1, "the callback waits on one transfer");
                let after = &receipts[r.receipt_indices[0] as usize];
                assert!(matches!(after.actions[..], [MockAction::Transfer { .. }]));
            }
            other => panic!("unexpected action {:?}", other),
        }
    }
    out
}

/// The `on_payout` callbacks of the last call: (args as JSON, static gas, the transfer it waits on).
fn payout_callbacks() -> Vec<(serde_json::Value, near_sdk::Gas, (AccountId, NearToken))> {
    let receipts = get_created_receipts();
    receipts
        .iter()
        .filter_map(|r| match &r.actions[..] {
            [MockAction::FunctionCallWeight { method_name, args, prepaid_gas, .. }]
                if method_name == b"on_payout" =>
            {
                let t = &receipts[r.receipt_indices[0] as usize];
                let paid = match &t.actions[..] {
                    [MockAction::Transfer { deposit, .. }] => (t.receiver_id.clone(), *deposit),
                    other => panic!("the callback must wait on a lone transfer, got {:?}", other),
                };
                Some((serde_json::from_slice(args).unwrap(), *prepaid_gas, paid))
            }
            _ => None,
        })
        .collect()
}

fn status(c: &Contract, id: &str) -> PassStatus {
    c.get_pass(id.into()).unwrap().status
}
fn holder(c: &Contract, id: &str) -> AccountId {
    c.nft_token(id.into()).unwrap().owner_id
}
fn extra(c: &Contract, id: &str) -> serde_json::Value {
    let m = c.get_pass(id.into()).unwrap().metadata.unwrap();
    serde_json::from_str(&m.extra.unwrap()).unwrap()
}

// ---- exact event lines (3.4.5, 3.4.6) ----

fn line_metadata_update(id: &str) -> String {
    format!(
        r#"EVENT_JSON:{{"standard":"nep171","version":"1.2.0","event":"nft_metadata_update","data":[{{"token_ids":["{}"]}}]}}"#,
        id
    )
}
fn line_pass_claimed(id: &str, m: &AccountId, offer: &str, to: &AccountId) -> String {
    format!(
        r#"EVENT_JSON:{{"standard":"nearby_pass","version":"1.0.0","event":"pass_claimed","data":[{{"token_id":"{}","merchant_id":"{}","offer_id":"{}","owner_id":"{}","by":"{}"}}]}}"#,
        id,
        m,
        offer,
        to,
        agent()
    )
}
fn line_settled(event: &str, id: &str, m: &AccountId, offer: &str, v: NearToken, to: &AccountId) -> String {
    format!(
        r#"EVENT_JSON:{{"standard":"nearby_pass","version":"1.0.0","event":"{}","data":[{{"token_id":"{}","merchant_id":"{}","offer_id":"{}","value":"{}","paid_to":"{}"}}]}}"#,
        event,
        id,
        m,
        offer,
        v.as_yoctonear(),
        to
    )
}
fn line_payout_failed(id: &str, v: NearToken) -> String {
    format!(
        r#"EVENT_JSON:{{"standard":"nearby_pass","version":"1.0.0","event":"payout_failed","data":[{{"token_id":"{}","value":"{}"}}]}}"#,
        id,
        v.as_yoctonear()
    )
}
fn line_nft_transfer(id: &str, from: &AccountId, to: &AccountId) -> String {
    format!(
        r#"EVENT_JSON:{{"standard":"nep171","version":"1.0.0","event":"nft_transfer","data":[{{"old_owner_id":"{}","new_owner_id":"{}","token_ids":["{}"]}}]}}"#,
        from, to, id
    )
}

// =========================================================================== REQ-15-01

#[test]
fn ac_req_15_01_01_new_sets_metadata_and_config() {
    let c = setup();
    let md = c.nft_metadata();
    assert_eq!(md.spec, "nft-1.0.0");
    assert_eq!(md.name, "Nearby Passes");
    assert_eq!(md.symbol, "NBYPASS");
    let cfg = c.config();
    assert_eq!(cfg.owner_id, owner());
    assert_eq!(cfg.agent_id, agent());
    assert!(!cfg.claims_paused);
    assert_eq!(cfg.media_base_url, MEDIA);
    assert_eq!(c.nft_total_supply(), U128(0));
}

#[test]
fn ac_req_15_01_01_new_twice_refused() {
    let c = setup();
    // On chain the #[init] wrapper writes the state after `new`; do the same here.
    env::state_write(&c);
    set(&owner(), yocto(0), NOW_MS);
    let r = catch_unwind(|| Contract::new(owner(), agent(), MEDIA.to_string()));
    let msg = panic_message(r.err().expect("a second new must fail"));
    assert!(msg.contains("Already initialized"), "{}", msg);
}

#[test]
fn ac_req_15_01_02_owner_pauses_sets_agent_and_media_base() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 3, NOW_MS + DAY_MS);

    set(&owner(), yocto(1), NOW_MS);
    c.set_claims_paused(true);
    assert!(c.config().claims_paused);
    assert_eq!(
        get_logs(),
        vec![format!(
            r#"EVENT_JSON:{{"standard":"nearby_pass","version":"1.0.0","event":"claims_paused","data":[{{"paused":true,"by":"{}"}}]}}"#,
            owner()
        )]
    );
    set(&owner(), yocto(1), NOW_MS);
    c.set_claims_paused(false);
    assert!(!c.config().claims_paused);
    assert!(get_logs()[0].contains(r#""paused":false"#));

    let new_agent = acc("agent2.nearby-passes.testnet");
    set(&owner(), yocto(1), NOW_MS);
    c.set_agent(new_agent.clone());
    assert_eq!(c.config().agent_id, new_agent);
    // The old agent is refused, the new one claims.
    assert_refused(&mut c, context(&agent(), yocto(0), NOW_MS), "only the agent", |c| {
        c.claim_pass(merchant(), OFFER.into(), shopper())
    });
    set(&new_agent, yocto(0), NOW_MS);
    assert_eq!(c.claim_pass(merchant(), OFFER.into(), shopper()), "pass-1");

    set(&owner(), yocto(1), NOW_MS);
    c.set_media_base_url("https://other.example/p/".into());
    assert_eq!(c.config().media_base_url, "https://other.example/p/");
    // Applies to passes minted or updated afterwards.
    let ids = mint_n(&mut c, &merchant(), OFFER2, 1, NOW_MS + DAY_MS);
    let md = c.get_pass(ids[0].clone()).unwrap().metadata.unwrap();
    assert_eq!(md.media.unwrap(), "https://other.example/p/pass-4.svg");
    let md2 = c.get_pass("pass-2".into()).unwrap().metadata.unwrap();
    assert_eq!(md2.media.unwrap(), format!("{}pass-2.svg", MEDIA));
}

#[test]
fn ac_req_15_01_02_redeem_and_refund_work_while_paused() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 2, NOW_MS + HOUR_MS);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS);
    set(&owner(), yocto(1), NOW_MS);
    c.set_claims_paused(true);

    set(&merchant(), yocto(1), NOW_MS + 1);
    c.redeem_pass("pass-1".into());
    assert_eq!(status(&c, "pass-1"), PassStatus::Redeemed);
    assert_eq!(transfers(), vec![(shopper(), value())]);

    set(&friend(), yocto(0), NOW_MS + HOUR_MS);
    c.refund_expired("pass-2".into());
    assert_eq!(status(&c, "pass-2"), PassStatus::Refunded);
    assert_eq!(transfers(), vec![(merchant(), value())]);
}

#[test]
fn neg_15_01_01_owner_controls_refused() {
    let mut c = setup();
    let before = c.config();
    for who in [agent(), merchant(), shopper()] {
        let ctx = context(&who, yocto(1), NOW_MS);
        assert_refused(&mut c, ctx.clone(), "only the owner", |c| c.set_claims_paused(true));
        assert_refused(&mut c, ctx.clone(), "only the owner", |c| c.set_agent(friend()));
        assert_refused(&mut c, ctx, "only the owner", |c| c.set_media_base_url("https://x/".into()));
    }
    for deposit in [yocto(0), yocto(2)] {
        let ctx = context(&owner(), deposit, NOW_MS);
        assert_refused(&mut c, ctx.clone(), "1 yoctoNEAR", |c| c.set_claims_paused(true));
        assert_refused(&mut c, ctx.clone(), "1 yoctoNEAR", |c| c.set_agent(friend()));
        assert_refused(&mut c, ctx, "1 yoctoNEAR", |c| c.set_media_base_url("https://x/".into()));
    }
    assert_eq!(c.config(), before);
}

// =========================================================================== REQ-15-02

#[test]
fn ac_req_15_02_01_mint_three_passes() {
    let mut c = setup();
    let attached = NearToken::from_near(1);
    set(&merchant(), attached, NOW_MS);
    let before = env::storage_usage();
    let ids = c.mint_passes(
        OFFER.into(),
        TITLE.into(),
        DESCRIPTION.into(),
        value(),
        NOW_MS + 2 * DAY_MS,
        3,
    );
    let measured = env::storage_usage() - before;
    assert_eq!(ids, vec!["pass-1", "pass-2", "pass-3"]);

    for id in &ids {
        assert_eq!(holder(&c, id), contract_id());
        assert_eq!(status(&c, id), PassStatus::Open);
    }
    // Queued oldest first under "merchant_id|offer_id".
    assert_eq!(c.open.get(&format!("{}|{}", merchant(), OFFER)).unwrap(), ids);
    let stats = c.offer_stats(merchant(), OFFER.into());
    assert_eq!(
        stats,
        OfferStats { open: 3, claimed: 0, redeemed: 0, refunded: 0, held: value().saturating_mul(3) }
    );

    // Storage charged: measured bytes plus LATER_STORAGE_BYTES per pass, at the byte cost.
    let byte_cost = env::storage_byte_cost();
    let storage = byte_cost.saturating_mul((measured + 3 * LATER_STORAGE_BYTES) as u128);
    let refund = attached.saturating_sub(value().saturating_mul(3)).saturating_sub(storage);
    assert_eq!(transfers(), vec![(merchant(), refund)]);

    let logs = get_logs();
    assert_eq!(
        logs,
        vec![
            format!(
                r#"EVENT_JSON:{{"standard":"nep171","version":"1.0.0","event":"nft_mint","data":[{{"owner_id":"{}","token_ids":["pass-1","pass-2","pass-3"]}}]}}"#,
                contract_id()
            ),
            format!(
                r#"EVENT_JSON:{{"standard":"nearby_pass","version":"1.0.0","event":"pass_funded","data":[{{"merchant_id":"{}","offer_id":"{}","token_ids":["pass-1","pass-2","pass-3"],"value":"{}"}}]}}"#,
                merchant(),
                OFFER,
                value().as_yoctonear()
            ),
        ]
    );

    // A second mint for the same offer: the marginal bytes per pass.
    set(&merchant(), attached, NOW_MS);
    let before2 = env::storage_usage();
    c.mint_passes(OFFER.into(), TITLE.into(), DESCRIPTION.into(), value(), NOW_MS + 2 * DAY_MS, 3);
    let measured2 = env::storage_usage() - before2;

    // Worst case: one pass, a new offer, the longest title and description.
    set(&merchant(), attached, NOW_MS);
    let before3 = env::storage_usage();
    c.mint_passes(
        "f".repeat(64),
        "T".repeat(80),
        "D".repeat(200),
        value(),
        NOW_MS + 2 * DAY_MS,
        1,
    );
    let measured3 = env::storage_usage() - before3;

    // One pass for a new offer, realistic fields: the smallest fund the app sends.
    set(&merchant(), attached, NOW_MS);
    let before4 = env::storage_usage();
    c.mint_passes(OFFER2.into(), TITLE.into(), DESCRIPTION.into(), value(), NOW_MS + 2 * DAY_MS, 1);
    let measured4 = env::storage_usage() - before4;

    let per = |bytes: u64, n: u64| bytes as f64 / n as f64;
    let near = |bytes: f64| bytes * byte_cost.as_yoctonear() as f64 / 1e24;
    println!("STORAGE byte cost: {} yoctoNEAR per byte", byte_cost.as_yoctonear());
    println!(
        "STORAGE first mint of 3 (new merchant and offer): {} bytes, {:.1} bytes per pass, {:.5} NEAR per pass measured, {:.5} NEAR per pass charged with LATER_STORAGE_BYTES={}",
        measured,
        per(measured, 3),
        near(per(measured, 3)),
        near(per(measured, 3) + LATER_STORAGE_BYTES as f64),
        LATER_STORAGE_BYTES
    );
    println!(
        "STORAGE second mint of 3 (same offer): {} bytes, {:.1} bytes per pass, {:.5} NEAR per pass charged",
        measured2,
        per(measured2, 3),
        near(per(measured2, 3) + LATER_STORAGE_BYTES as f64)
    );
    println!(
        "STORAGE one pass for a new offer, realistic fields: {} bytes, {:.5} NEAR charged",
        measured4,
        near(measured4 as f64 + LATER_STORAGE_BYTES as f64)
    );
    println!(
        "STORAGE worst case, 1 pass, new offer, 64/80/200-character fields: {} bytes, {:.5} NEAR charged",
        measured3,
        near(measured3 as f64 + LATER_STORAGE_BYTES as f64)
    );
}

#[test]
fn ac_req_15_02_01_mint_accepts_the_limits() {
    let mut c = setup();
    set(&merchant(), NearToken::from_near(2), NOW_MS);
    let ids = c.mint_passes(
        "x".repeat(64),
        "T".repeat(80),
        "D".repeat(200),
        MIN_VALUE,
        NOW_MS + 30 * DAY_MS,
        10,
    );
    assert_eq!(ids.len(), 10);
    assert_eq!(ids[9], "pass-10");
}

#[test]
fn neg_15_02_01_mint_refused() {
    let mut c = setup();
    let exp = NOW_MS + DAY_MS;
    let enough = NearToken::from_near(2);
    let ctx = || context(&merchant(), enough, NOW_MS);

    // Deposit short: exactly count × value, nothing for storage (fails after the measurement;
    // the rollback is the chain's).
    assert_refused(&mut c, context(&merchant(), value().saturating_mul(3), NOW_MS), "deposit", |c| {
        c.mint_passes(OFFER.into(), TITLE.into(), DESCRIPTION.into(), value(), exp, 3)
    });
    // Deposit short of the balances themselves.
    assert_refused(&mut c, context(&merchant(), value(), NOW_MS), "deposit", |c| {
        c.mint_passes(OFFER.into(), TITLE.into(), DESCRIPTION.into(), value(), exp, 3)
    });
    for count in [0u32, 11] {
        assert_refused(&mut c, ctx(), "count", |c| {
            c.mint_passes(OFFER.into(), TITLE.into(), DESCRIPTION.into(), value(), exp, count)
        });
    }
    assert_refused(&mut c, ctx(), "value", |c| {
        c.mint_passes(
            OFFER.into(),
            TITLE.into(),
            DESCRIPTION.into(),
            MIN_VALUE.saturating_sub(yocto(1)),
            exp,
            1,
        )
    });
    for e in [NOW_MS - 1, NOW_MS] {
        assert_refused(&mut c, ctx(), "future", |c| {
            c.mint_passes(OFFER.into(), TITLE.into(), DESCRIPTION.into(), value(), e, 1)
        });
    }
    assert_refused(&mut c, ctx(), "30 days", |c| {
        c.mint_passes(OFFER.into(), TITLE.into(), DESCRIPTION.into(), value(), NOW_MS + 30 * DAY_MS + 1, 1)
    });
    assert_refused(&mut c, ctx(), "|", |c| {
        c.mint_passes("offer|1".into(), TITLE.into(), DESCRIPTION.into(), value(), exp, 1)
    });
    assert_refused(&mut c, ctx(), "64", |c| {
        c.mint_passes("x".repeat(65), TITLE.into(), DESCRIPTION.into(), value(), exp, 1)
    });
    assert_refused(&mut c, ctx(), "80", |c| {
        c.mint_passes(OFFER.into(), "T".repeat(81), DESCRIPTION.into(), value(), exp, 1)
    });
    assert_refused(&mut c, ctx(), "200", |c| {
        c.mint_passes(OFFER.into(), TITLE.into(), "D".repeat(201), value(), exp, 1)
    });

    // Nothing was minted.
    assert_eq!(c.nft_total_supply(), U128(0));
    assert_eq!(c.offer_stats(merchant(), OFFER.into()), OfferStats::default());
    assert!(c.passes_for_merchant(merchant(), None, None).is_empty());
    assert_eq!(c.next_id, 0);
}

// =========================================================================== REQ-15-03

#[test]
fn ac_req_15_03_01_agent_claims_oldest_open_pass() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 3, NOW_MS + DAY_MS);

    set(&agent(), yocto(0), NOW_MS + 1000);
    let before = env::storage_usage();
    let id = c.claim_pass(merchant(), OFFER.into(), shopper());
    let later = env::storage_usage() - before;
    assert_eq!(id, "pass-1");
    assert_eq!(holder(&c, "pass-1"), shopper());
    let p = c.get_pass("pass-1".into()).unwrap();
    assert_eq!(p.status, PassStatus::Claimed);
    assert_eq!(p.claimed_at_ms, Some(NOW_MS + 1000));
    assert_eq!(c.open.get(&format!("{}|{}", merchant(), OFFER)).unwrap(), vec!["pass-2", "pass-3"]);
    let s = c.offer_stats(merchant(), OFFER.into());
    assert_eq!((s.open, s.claimed, s.held), (2, 1, value().saturating_mul(3)));
    assert_eq!(
        get_logs(),
        vec![
            line_nft_transfer("pass-1", &contract_id(), &shopper()),
            line_metadata_update("pass-1"),
            line_pass_claimed("pass-1", &merchant(), OFFER, &shopper()),
        ]
    );
    assert!(get_created_receipts().is_empty());
    println!(
        "STORAGE later growth, first claim to a 64-character holder: {} bytes (LATER_STORAGE_BYTES = {})",
        later, LATER_STORAGE_BYTES
    );

    // The next receiver gets the next oldest.
    assert_eq!(claim(&mut c, &merchant(), OFFER, &shopper2(), NOW_MS + 2000), "pass-2");
}

#[test]
fn ac_req_15_03_01_claim_skips_expired_passes() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 1, NOW_MS + HOUR_MS); // pass-1, expires first
    mint_n(&mut c, &merchant(), OFFER, 1, NOW_MS + DAY_MS); // pass-2
    assert_eq!(claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS + HOUR_MS), "pass-2");
    // The expired pass stays queued for refund.
    assert_eq!(c.open.get(&format!("{}|{}", merchant(), OFFER)).unwrap(), vec!["pass-1"]);
    set(&friend(), yocto(0), NOW_MS + HOUR_MS);
    c.refund_expired("pass-1".into());
    assert!(c.open.get(&format!("{}|{}", merchant(), OFFER)).unwrap().is_empty());
}

#[test]
fn neg_15_03_01_claim_refused() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 2, NOW_MS + DAY_MS);
    mint_n(&mut c, &merchant(), OFFER2, 1, NOW_MS + HOUR_MS); // pass-3, expires soon
    let as_agent = |now| context(&agent(), yocto(0), now);

    // A caller other than the agent.
    for who in [owner(), merchant(), shopper(), contract_id()] {
        assert_refused(&mut c, context(&who, yocto(0), NOW_MS), "only the agent", |c| {
            c.claim_pass(merchant(), OFFER.into(), shopper())
        });
    }
    // A 64-character receiver that is not lowercase hex.
    for bad in ["z".repeat(64), format!("{}g", "a".repeat(63)), format!("{}-0", "a".repeat(62))] {
        assert_refused(&mut c, as_agent(NOW_MS), "lowercase hex", |c| {
            c.claim_pass(merchant(), OFFER.into(), acc(&bad))
        });
    }
    // The same receiver twice for the same merchant and offer.
    assert_eq!(claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS), "pass-1");
    assert_refused(&mut c, as_agent(NOW_MS), "already claimed", |c| {
        c.claim_pass(merchant(), OFFER.into(), shopper())
    });
    // The only passes have expired.
    assert_refused(&mut c, as_agent(NOW_MS + HOUR_MS), "no open pass", |c| {
        c.claim_pass(merchant(), OFFER2.into(), shopper())
    });
    // Paused.
    set(&owner(), yocto(1), NOW_MS);
    c.set_claims_paused(true);
    assert_refused(&mut c, as_agent(NOW_MS), "paused", |c| {
        c.claim_pass(merchant(), OFFER.into(), shopper2())
    });
    set(&owner(), yocto(1), NOW_MS);
    c.set_claims_paused(false);
    // No pass left.
    assert_eq!(claim(&mut c, &merchant(), OFFER, &shopper2(), NOW_MS), "pass-2");
    assert_refused(&mut c, as_agent(NOW_MS), "no open pass", |c| {
        c.claim_pass(merchant(), OFFER.into(), friend())
    });
    // An offer never minted.
    assert_refused(&mut c, as_agent(NOW_MS), "no open pass", |c| {
        c.claim_pass(merchant2(), OFFER.into(), friend())
    });

    // No token moved by a refused claim.
    assert_eq!(holder(&c, "pass-3"), contract_id());
    assert_eq!(c.nft_supply_for_owner(friend()), U128(0));
    assert_eq!(c.nft_supply_for_owner(shopper()), U128(1));
    assert_eq!(c.nft_supply_for_owner(shopper2()), U128(1));
}

#[test]
fn ac_req_15_03_02_two_merchants_one_offer_id() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 2, NOW_MS + DAY_MS); // pass-1, pass-2
    mint_n(&mut c, &merchant2(), OFFER, 2, NOW_MS + DAY_MS); // pass-3, pass-4

    let a = claim(&mut c, &merchant2(), OFFER, &shopper(), NOW_MS);
    let b = claim(&mut c, &merchant2(), OFFER, &shopper2(), NOW_MS);
    assert_eq!((a.as_str(), b.as_str()), ("pass-3", "pass-4"));
    for id in [&a, &b] {
        assert_eq!(c.get_pass(id.clone()).unwrap().merchant_id, merchant2());
    }
    // merchant2 has none left; merchant's passes are never handed out for it.
    assert_refused(&mut c, context(&agent(), yocto(0), NOW_MS), "no open pass", |c| {
        c.claim_pass(merchant2(), OFFER.into(), friend())
    });
    assert_eq!(c.offer_stats(merchant(), OFFER.into()).open, 2);
    assert_eq!(holder(&c, "pass-1"), contract_id());
    assert_eq!(holder(&c, "pass-2"), contract_id());
    // The same receiver may claim the other merchant's offer: the key is merchant and offer.
    assert_eq!(claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS), "pass-1");
}

// =========================================================================== REQ-15-04

#[test]
fn ac_req_15_04_01_merchant_redeems_and_holder_is_paid() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 3, NOW_MS + DAY_MS);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS);

    set(&merchant(), yocto(1), NOW_MS + 5000);
    let before = env::storage_usage() as i64;
    c.redeem_pass("pass-1".into());
    let later = env::storage_usage() as i64 - before;
    let p = c.get_pass("pass-1".into()).unwrap();
    assert_eq!(p.status, PassStatus::Redeemed);
    assert_eq!(p.settled_at_ms, Some(NOW_MS + 5000));
    // One promise, one action: the transfer of `value` to the current owner. Then, as its own
    // receipt on the contract, the REQ-15-08 callback that waits on it.
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, shopper());
    assert_eq!(receipts[0].actions.len(), 1);
    assert!(matches!(
        receipts[0].actions[0],
        MockAction::Transfer { deposit, .. } if deposit == value()
    ));
    assert_eq!(receipts[1].receiver_id, contract_id());
    assert_eq!(receipts[1].receipt_indices, vec![0]);
    assert!(matches!(
        &receipts[1].actions[..],
        [MockAction::FunctionCallWeight { method_name, .. }] if method_name == b"on_payout"
    ));
    assert_eq!(
        get_logs(),
        vec![
            line_metadata_update("pass-1"),
            line_settled("pass_redeemed", "pass-1", &merchant(), OFFER, value(), &shopper()),
        ]
    );
    let s = c.offer_stats(merchant(), OFFER.into());
    assert_eq!((s.open, s.claimed, s.redeemed, s.held), (2, 0, 1, value().saturating_mul(2)));
    println!("STORAGE later growth, redeem (metadata rewrite): {} bytes", later);
}

#[test]
fn neg_15_04_01_redeem_refused() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 3, NOW_MS + DAY_MS);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS); // pass-1 Claimed
    let at = |who: &AccountId, d: NearToken, now| context(who, d, now);

    // Not the pass's merchant.
    for who in [merchant2(), shopper(), agent(), owner(), contract_id()] {
        assert_refused(&mut c, at(&who, yocto(1), NOW_MS), "merchant", |c| {
            c.redeem_pass("pass-1".into())
        });
    }
    // No deposit, or not exactly 1 yoctoNEAR.
    for d in [yocto(0), yocto(2), NearToken::from_near(1)] {
        assert_refused(&mut c, at(&merchant(), d, NOW_MS), "1 yoctoNEAR", |c| {
            c.redeem_pass("pass-1".into())
        });
    }
    // An Open pass.
    assert_refused(&mut c, at(&merchant(), yocto(1), NOW_MS), "not Claimed", |c| {
        c.redeem_pass("pass-2".into())
    });
    // Past its expiry (at the expiry instant and after).
    for now in [NOW_MS + DAY_MS, NOW_MS + 2 * DAY_MS] {
        assert_refused(&mut c, at(&merchant(), yocto(1), now), "expired", |c| {
            c.redeem_pass("pass-1".into())
        });
    }
    // A second redeem.
    set(&merchant(), yocto(1), NOW_MS);
    c.redeem_pass("pass-1".into());
    assert_eq!(transfers(), vec![(shopper(), value())]);
    assert_refused(&mut c, at(&merchant(), yocto(1), NOW_MS), "not Claimed", |c| {
        c.redeem_pass("pass-1".into())
    });
    assert_eq!(c.offer_stats(merchant(), OFFER.into()).redeemed, 1);
}

// =========================================================================== REQ-15-05

#[test]
fn ac_req_15_05_01_refund_after_expiry_pays_merchant() {
    let mut c = setup();
    let exp = NOW_MS + HOUR_MS;
    mint_n(&mut c, &merchant(), OFFER, 2, exp);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS); // pass-1 Claimed, pass-2 Open

    // An Open pass, by anyone, with no deposit, at the expiry instant.
    set(&friend(), yocto(0), exp);
    c.refund_expired("pass-2".into());
    let p = c.get_pass("pass-2".into()).unwrap();
    assert_eq!(p.status, PassStatus::Refunded);
    assert_eq!(p.settled_at_ms, Some(exp));
    assert!(c.open.get(&format!("{}|{}", merchant(), OFFER)).unwrap().is_empty());
    assert_eq!(transfers(), vec![(merchant(), value())]);
    assert_eq!(
        get_logs(),
        vec![
            line_metadata_update("pass-2"),
            line_settled("pass_refunded", "pass-2", &merchant(), OFFER, value(), &merchant()),
        ]
    );

    // A Claimed pass, after expiry: the merchant is paid, not the holder.
    set(&shopper(), yocto(0), exp + 1);
    c.refund_expired("pass-1".into());
    assert_eq!(status(&c, "pass-1"), PassStatus::Refunded);
    assert_eq!(transfers(), vec![(merchant(), value())]);
    assert_eq!(holder(&c, "pass-1"), shopper());

    let s = c.offer_stats(merchant(), OFFER.into());
    assert_eq!(
        s,
        OfferStats { open: 0, claimed: 0, redeemed: 0, refunded: 2, held: yocto(0) }
    );
}

#[test]
fn neg_15_05_01_refund_refused() {
    let mut c = setup();
    let exp = NOW_MS + HOUR_MS;
    mint_n(&mut c, &merchant(), OFFER, 3, exp);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS); // pass-1 Claimed
    let anyone = |now| context(&friend(), yocto(0), now);

    // Not yet expired, Open and Claimed.
    for id in ["pass-1", "pass-2"] {
        assert_refused(&mut c, anyone(exp - 1), "not expired", |c| c.refund_expired(id.into()));
    }
    // Redeemed.
    set(&merchant(), yocto(1), NOW_MS);
    c.redeem_pass("pass-1".into());
    assert_refused(&mut c, anyone(exp), "Open or Claimed", |c| c.refund_expired("pass-1".into()));
    // Already refunded.
    set(&friend(), yocto(0), exp);
    c.refund_expired("pass-2".into());
    assert_refused(&mut c, anyone(exp), "Open or Claimed", |c| c.refund_expired("pass-2".into()));
    let s = c.offer_stats(merchant(), OFFER.into());
    assert_eq!((s.open, s.redeemed, s.refunded), (1, 1, 1));
}

// =========================================================================== REQ-15-06

#[test]
fn ac_req_15_06_01_metadata_at_mint_and_each_status_change() {
    let mut c = setup();
    let exp = NOW_MS + DAY_MS;
    mint_n(&mut c, &merchant(), OFFER, 2, exp);

    let md = c.get_pass("pass-1".into()).unwrap().metadata.unwrap();
    assert_eq!(md.title.as_deref(), Some(TITLE));
    assert_eq!(
        md.description.as_deref(),
        Some("Two coffees for the price of one. Sample merchant. Testnet only.")
    );
    assert_eq!(md.media, Some(format!("{}pass-1.svg", MEDIA)));
    assert_eq!(md.reference, Some(format!("{}pass-1.json", MEDIA)));
    assert_eq!(md.issued_at, Some(NOW_MS.to_string()));
    assert_eq!(md.expires_at, Some(exp.to_string()));
    assert_eq!(md.updated_at, Some(NOW_MS.to_string()));
    assert_eq!(
        md.extra.as_deref(),
        Some(
            format!(
                r#"{{"status":"Open","value_yocto":"{}","merchant":"{}","offer_id":"{}"}}"#,
                value().as_yoctonear(),
                merchant(),
                OFFER
            )
            .as_str()
        )
    );

    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS + 1000);
    let md = c.get_pass("pass-1".into()).unwrap().metadata.unwrap();
    assert_eq!(extra(&c, "pass-1")["status"], "Claimed");
    assert_eq!(md.updated_at, Some((NOW_MS + 1000).to_string()));
    assert_eq!(md.issued_at, Some(NOW_MS.to_string()));
    assert!(get_logs().contains(&line_metadata_update("pass-1")));

    set(&merchant(), yocto(1), NOW_MS + 2000);
    c.redeem_pass("pass-1".into());
    let md = c.get_pass("pass-1".into()).unwrap().metadata.unwrap();
    assert_eq!(extra(&c, "pass-1")["status"], "Redeemed");
    assert_eq!(md.updated_at, Some((NOW_MS + 2000).to_string()));
    assert!(get_logs().contains(&line_metadata_update("pass-1")));

    set(&friend(), yocto(0), exp);
    c.refund_expired("pass-2".into());
    let md = c.get_pass("pass-2".into()).unwrap().metadata.unwrap();
    assert_eq!(extra(&c, "pass-2")["status"], "Refunded");
    assert_eq!(extra(&c, "pass-2")["value_yocto"], value().as_yoctonear().to_string());
    assert_eq!(md.updated_at, Some(exp.to_string()));
    assert_eq!(md.title.as_deref(), Some(TITLE));
    assert!(md.description.unwrap().ends_with("Sample merchant. Testnet only."));
    assert!(get_logs().contains(&line_metadata_update("pass-2")));
}

#[test]
fn ac_req_15_06_02_events_in_nep297_form() {
    let mut c = setup();
    let exp = NOW_MS + HOUR_MS;
    let mut all: Vec<String> = vec![];
    mint_n(&mut c, &merchant(), OFFER, 2, exp);
    all.extend(get_logs());
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS);
    let claim_logs = get_logs();
    assert!(claim_logs.contains(&line_pass_claimed("pass-1", &merchant(), OFFER, &shopper())));
    assert!(claim_logs.contains(&line_metadata_update("pass-1")));
    all.extend(claim_logs);
    set(&merchant(), yocto(1), NOW_MS);
    c.redeem_pass("pass-1".into());
    let l = get_logs();
    assert!(l.contains(&line_settled("pass_redeemed", "pass-1", &merchant(), OFFER, value(), &shopper())));
    assert!(l.contains(&line_metadata_update("pass-1")));
    all.extend(l);
    set(&friend(), yocto(0), exp);
    c.refund_expired("pass-2".into());
    let l = get_logs();
    assert!(l.contains(&line_settled("pass_refunded", "pass-2", &merchant(), OFFER, value(), &merchant())));
    assert!(l.contains(&line_metadata_update("pass-2")));
    all.extend(l);
    set(&owner(), yocto(1), exp);
    c.set_claims_paused(true);
    all.extend(get_logs());

    // Every line is EVENT_JSON: + NEP-297 JSON; Nearby's own events use nearby_pass 1.0.0.
    let mut ours = vec![];
    for line in &all {
        let json = line.strip_prefix("EVENT_JSON:").expect("NEP-297 prefix");
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 4, "{}", line);
        assert!(v["data"].is_array());
        if v["standard"] == "nearby_pass" {
            assert_eq!(v["version"], "1.0.0");
            ours.push(v["event"].as_str().unwrap().to_string());
        } else {
            assert_eq!(v["standard"], "nep171");
        }
    }
    assert_eq!(ours, vec!["pass_funded", "pass_claimed", "pass_redeemed", "pass_refunded", "claims_paused"]);
    // One nft_metadata_update per status change (claim, redeem, refund).
    assert_eq!(all.iter().filter(|l| l.contains("nft_metadata_update")).count(), 3);
}

// =========================================================================== REQ-15-07

#[test]
fn ac_req_15_07_01_given_away_pass_pays_new_holder() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 1, NOW_MS + DAY_MS);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS);

    set(&shopper(), yocto(1), NOW_MS);
    c.nft_transfer(friend(), "pass-1".into(), None, None);
    assert_eq!(holder(&c, "pass-1"), friend());
    assert_eq!(get_logs(), vec![line_nft_transfer("pass-1", &shopper(), &friend())]);

    set(&merchant(), yocto(1), NOW_MS);
    c.redeem_pass("pass-1".into());
    assert_eq!(transfers(), vec![(friend(), value())]);
    assert!(get_logs().contains(&line_settled(
        "pass_redeemed",
        "pass-1",
        &merchant(),
        OFFER,
        value(),
        &friend()
    )));
    // A Redeemed pass still transfers as NEP-171 says (ruling 49(d)).
    set(&friend(), yocto(1), NOW_MS);
    c.nft_transfer(shopper2(), "pass-1".into(), None, Some("keepsake".into()));
    assert_eq!(holder(&c, "pass-1"), shopper2());
    // NEP-171 transfers need exactly 1 yoctoNEAR.
    assert_refused(&mut c, context(&shopper2(), yocto(0), NOW_MS), "1 yoctoNEAR", |c| {
        c.nft_transfer(friend(), "pass-1".into(), None, None)
    });
}

#[test]
fn neg_15_07_01_open_pass_cannot_be_moved() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 2, NOW_MS + DAY_MS);
    for who in [contract_id(), owner(), merchant(), agent()] {
        let ctx = context(&who, yocto(1), NOW_MS);
        assert_refused(&mut c, ctx.clone(), "Open pass cannot be transferred", |c| {
            c.nft_transfer(friend(), "pass-1".into(), None, None)
        });
        assert_refused(&mut c, ctx, "Open pass cannot be transferred", |c| {
            c.nft_transfer_call(friend(), "pass-1".into(), None, None, "".into())
        });
    }
    assert_eq!(holder(&c, "pass-1"), contract_id());
    assert_eq!(status(&c, "pass-1"), PassStatus::Open);
    // Ruling 52(d): a Refunded pass that was never claimed is still the contract's and cannot be moved either.
    set(&friend(), yocto(0), NOW_MS + DAY_MS);
    c.refund_expired("pass-2".into());
    assert_eq!(status(&c, "pass-2"), PassStatus::Refunded);
    for who in [contract_id(), owner()] {
        assert_refused(&mut c, context(&who, yocto(1), NOW_MS + DAY_MS), "contract holds cannot be transferred", |c| {
            c.nft_transfer(friend(), "pass-2".into(), None, None)
        });
    }
    assert_eq!(holder(&c, "pass-2"), contract_id());
    // A Claimed pass moves with nft_transfer_call (the receiver call and resolve are scheduled).
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS);
    set(&shopper(), yocto(1), NOW_MS);
    let _ = c.nft_transfer_call(friend(), "pass-1".into(), None, None, "".into());
    assert_eq!(holder(&c, "pass-1"), friend());
}

#[test]
fn ac_req_15_07_02_the_views() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 3, NOW_MS + 2 * DAY_MS); // pass-1..3
    mint_n(&mut c, &merchant(), OFFER2, 1, NOW_MS + HOUR_MS); // pass-4
    mint_n(&mut c, &merchant2(), OFFER, 1, NOW_MS + DAY_MS); // pass-5
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS); // pass-1
    claim(&mut c, &merchant(), OFFER, &shopper2(), NOW_MS); // pass-2
    set(&merchant(), yocto(1), NOW_MS + 10);
    c.redeem_pass("pass-1".into());
    set(&friend(), yocto(0), NOW_MS + HOUR_MS);
    c.refund_expired("pass-4".into());

    // get_pass
    let p = c.get_pass("pass-1".into()).unwrap();
    assert_eq!(p.token_id, "pass-1");
    assert_eq!(p.owner_id, shopper());
    assert_eq!(p.merchant_id, merchant());
    assert_eq!(p.offer_id, OFFER);
    assert_eq!(p.title, TITLE);
    assert_eq!(p.value, value());
    assert_eq!(p.expires_at_ms, NOW_MS + 2 * DAY_MS);
    assert_eq!(p.status, PassStatus::Redeemed);
    assert_eq!(p.claimed_at_ms, Some(NOW_MS));
    assert_eq!(p.settled_at_ms, Some(NOW_MS + 10));
    assert!(p.metadata.is_some());
    assert!(c.get_pass("pass-99".into()).is_none());

    // passes_for_owner
    let mine: Vec<_> = c.passes_for_owner(shopper(), None, None).into_iter().map(|p| p.token_id).collect();
    assert_eq!(mine, vec!["pass-1"]);
    let held: Vec<_> =
        c.passes_for_owner(contract_id(), None, None).into_iter().map(|p| p.token_id).collect();
    assert_eq!(held.len(), 3); // pass-3 Open, pass-4 Refunded (never claimed), pass-5 Open
    assert_eq!(c.passes_for_owner(contract_id(), Some(1), Some(1)).len(), 1);
    assert!(c.passes_for_owner(friend(), None, None).is_empty());

    // passes_for_merchant, newest first
    let ids = |v: Vec<PassView>| v.into_iter().map(|p| p.token_id).collect::<Vec<_>>();
    assert_eq!(ids(c.passes_for_merchant(merchant(), None, None)), vec!["pass-4", "pass-3", "pass-2", "pass-1"]);
    assert_eq!(ids(c.passes_for_merchant(merchant(), Some(1), Some(2))), vec!["pass-3", "pass-2"]);
    assert_eq!(ids(c.passes_for_merchant(merchant2(), None, None)), vec!["pass-5"]);
    assert!(c.passes_for_merchant(friend(), None, None).is_empty());

    // offer_stats
    assert_eq!(
        c.offer_stats(merchant(), OFFER.into()),
        OfferStats { open: 1, claimed: 1, redeemed: 1, refunded: 0, held: value().saturating_mul(2) }
    );
    assert_eq!(
        c.offer_stats(merchant(), OFFER2.into()),
        OfferStats { open: 0, claimed: 0, redeemed: 0, refunded: 1, held: yocto(0) }
    );
    assert_eq!(c.offer_stats(merchant2(), OFFER.into()).open, 1);
    assert_eq!(c.offer_stats(friend(), "none".into()), OfferStats::default());

    // config
    assert_eq!(
        c.config(),
        ConfigView {
            owner_id: owner(),
            agent_id: agent(),
            claims_paused: false,
            media_base_url: MEDIA.into()
        }
    );

    // NEP-171 / 177 / 181
    let t = c.nft_token("pass-2".into()).unwrap();
    assert_eq!(t.owner_id, shopper2());
    assert_eq!(t.metadata.unwrap().media, Some(format!("{}pass-2.svg", MEDIA)));
    assert!(c.nft_token("pass-99".into()).is_none());
    assert_eq!(c.nft_metadata().symbol, "NBYPASS");
    assert_eq!(c.nft_total_supply(), U128(5));
    assert_eq!(c.nft_tokens(None, None).len(), 5);
    assert_eq!(c.nft_tokens(Some(U128(1)), Some(2)).len(), 2);
    assert_eq!(c.nft_supply_for_owner(shopper()), U128(1));
    assert_eq!(c.nft_supply_for_owner(contract_id()), U128(3));
    assert_eq!(c.nft_tokens_for_owner(shopper2(), None, None)[0].token_id, "pass-2");

    // The JSON the server reads.
    let get_pass_json = serde_json::to_value(c.get_pass("pass-2".into()).unwrap()).unwrap();
    for k in [
        "token_id", "owner_id", "merchant_id", "offer_id", "title", "value", "expires_at_ms", "status",
        "claimed_at_ms", "settled_at_ms", "metadata",
    ] {
        assert!(get_pass_json.get(k).is_some(), "get_pass lacks {}", k);
    }
    assert_eq!(get_pass_json["value"], value().as_yoctonear().to_string());
    assert_eq!(get_pass_json["status"], "Claimed");
    assert!(get_pass_json["expires_at_ms"].is_u64());
    let stats_json = serde_json::to_value(c.offer_stats(merchant(), OFFER.into())).unwrap();
    assert_eq!(stats_json["held"], value().saturating_mul(2).as_yoctonear().to_string());
    println!("JSON get_pass: {}", get_pass_json);
    println!("JSON offer_stats: {}", stats_json);
    println!("JSON config: {}", serde_json::to_value(c.config()).unwrap());
}

#[test]
fn mint_passes_args_deserialize_from_the_servers_json() {
    // The shape `near-api-js` sends for mint_passes: value in yoctoNEAR as a string, times as numbers.
    let args = serde_json::json!({
        "offer_id": OFFER,
        "title": TITLE,
        "description": DESCRIPTION,
        "value": "100000000000000000000000",
        "expires_at_ms": NOW_MS + DAY_MS,
        "count": 3
    });
    #[derive(near_sdk::serde::Deserialize)]
    #[serde(crate = "near_sdk::serde")]
    #[allow(dead_code)]
    struct MintArgs {
        offer_id: String,
        title: String,
        description: String,
        value: NearToken,
        expires_at_ms: u64,
        count: u32,
    }
    let a: MintArgs = serde_json::from_value(args.clone()).unwrap();
    assert_eq!(a.value, value());
    println!("JSON mint_passes args: {}", args);
}

// =========================================================================== REQ-15-08

/// Runs `on_payout` as the chain would: called by the contract itself, with the transfer's result.
fn run_callback(c: &mut Contract, id: &str, previous: PassStatus, ok: bool, now: u64) -> bool {
    set(&contract_id(), yocto(0), now);
    let result = if ok { Ok(()) } else { Err(PromiseError::Failed) };
    c.on_payout(id.into(), previous, result)
}

fn queue(c: &Contract, m: &AccountId, offer: &str) -> Vec<TokenId> {
    c.open.get(&format!("{}|{}", m, offer)).unwrap_or_default()
}

#[test]
fn ac_req_15_08_01_failed_redeem_payout_restores_claimed() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 3, NOW_MS + DAY_MS);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS); // pass-1 Claimed
    let before = c.offer_stats(merchant(), OFFER.into());
    let claimed_at = c.get_pass("pass-1".into()).unwrap().claimed_at_ms;

    set(&merchant(), yocto(1), NOW_MS + 5000);
    c.redeem_pass("pass-1".into());
    // The transfer is the only action of its promise; the callback is its own receipt with 10 TGas
    // static gas and the status to restore.
    let cbs = payout_callbacks();
    assert_eq!(cbs.len(), 1);
    assert_eq!(cbs[0].0, serde_json::json!({"token_id": "pass-1", "previous_status": "Claimed"}));
    assert_eq!(cbs[0].1, PAYOUT_CALLBACK_GAS);
    assert_eq!(PAYOUT_CALLBACK_GAS, near_sdk::Gas::from_tgas(10));
    assert_eq!(cbs[0].2, (shopper(), value()));
    assert_eq!(status(&c, "pass-1"), PassStatus::Redeemed);

    // The transfer failed: the pass is Claimed again, as it was before the redeem.
    assert!(!run_callback(&mut c, "pass-1", PassStatus::Claimed, false, NOW_MS + 6000));
    let p = c.get_pass("pass-1".into()).unwrap();
    assert_eq!(p.status, PassStatus::Claimed);
    assert_eq!(p.settled_at_ms, None);
    assert_eq!(p.claimed_at_ms, claimed_at);
    assert_eq!(p.owner_id, shopper());
    assert_eq!(c.offer_stats(merchant(), OFFER.into()), before);
    assert_eq!(extra(&c, "pass-1")["status"], "Claimed");
    assert_eq!(p.metadata.unwrap().updated_at, Some((NOW_MS + 6000).to_string()));
    assert_eq!(
        get_logs(),
        vec![line_metadata_update("pass-1"), line_payout_failed("pass-1", value())]
    );
    assert!(get_created_receipts().is_empty(), "the callback schedules nothing");

    // The balance stayed in the contract: a second redeem pays the holder.
    set(&merchant(), yocto(1), NOW_MS + 7000);
    c.redeem_pass("pass-1".into());
    assert_eq!(transfers(), vec![(shopper(), value())]);
    assert_eq!(status(&c, "pass-1"), PassStatus::Redeemed);
    assert!(run_callback(&mut c, "pass-1", PassStatus::Claimed, true, NOW_MS + 8000));
    let s = c.offer_stats(merchant(), OFFER.into());
    assert_eq!((s.open, s.claimed, s.redeemed, s.held), (2, 0, 1, value().saturating_mul(2)));
}

#[test]
fn ac_req_15_08_01_failed_refund_payout_restores_open_and_requeues() {
    let mut c = setup();
    let exp = NOW_MS + HOUR_MS;
    mint_n(&mut c, &merchant(), OFFER, 3, exp);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS); // pass-1 Claimed; pass-2, pass-3 Open
    let before = c.offer_stats(merchant(), OFFER.into());
    assert_eq!(queue(&c, &merchant(), OFFER), vec!["pass-2", "pass-3"]);

    // An Open pass: refunded, the transfer fails, it is Open again at its place in the queue.
    set(&friend(), yocto(0), exp);
    c.refund_expired("pass-2".into());
    let cbs = payout_callbacks();
    assert_eq!(cbs.len(), 1);
    assert_eq!(cbs[0].0, serde_json::json!({"token_id": "pass-2", "previous_status": "Open"}));
    assert_eq!(cbs[0].2, (merchant(), value()));
    assert_eq!(queue(&c, &merchant(), OFFER), vec!["pass-3"]);
    assert!(!run_callback(&mut c, "pass-2", PassStatus::Open, false, exp + 1));
    let p = c.get_pass("pass-2".into()).unwrap();
    assert_eq!(p.status, PassStatus::Open);
    assert_eq!(p.settled_at_ms, None);
    assert_eq!(p.owner_id, contract_id());
    assert_eq!(queue(&c, &merchant(), OFFER), vec!["pass-2", "pass-3"], "oldest first");
    assert_eq!(c.offer_stats(merchant(), OFFER.into()), before);
    assert_eq!(extra(&c, "pass-2")["status"], "Open");
    assert_eq!(p.metadata.unwrap().updated_at, Some((exp + 1).to_string()));
    assert_eq!(
        get_logs(),
        vec![line_metadata_update("pass-2"), line_payout_failed("pass-2", value())]
    );
    // Back in the queue it is handled like any Open pass: before its expiry a claim would take
    // it; this one is expired, so a claim skips it (3.4.3) and a second refund pays the merchant.
    assert_refused(&mut c, context(&agent(), yocto(0), exp + 1), "no open pass", |c| {
        c.claim_pass(merchant(), OFFER.into(), shopper2())
    });
    set(&friend(), yocto(0), exp + 2);
    c.refund_expired("pass-2".into());
    assert_eq!(transfers(), vec![(merchant(), value())]);
    assert_eq!(queue(&c, &merchant(), OFFER), vec!["pass-3"]);
    assert!(run_callback(&mut c, "pass-2", PassStatus::Open, true, exp + 3));
    assert_eq!(status(&c, "pass-2"), PassStatus::Refunded);

    // The newest Open pass goes back behind the older ones too.
    set(&friend(), yocto(0), exp + 4);
    c.refund_expired("pass-3".into());
    assert!(queue(&c, &merchant(), OFFER).is_empty());
    assert!(!run_callback(&mut c, "pass-3", PassStatus::Open, false, exp + 5));
    assert_eq!(queue(&c, &merchant(), OFFER), vec!["pass-3"]);
    assert_eq!(status(&c, "pass-3"), PassStatus::Open);

    // A Claimed pass: refunded, the transfer fails, it is Claimed again by the same holder.
    let before = c.offer_stats(merchant(), OFFER.into());
    set(&shopper(), yocto(0), exp + 6);
    c.refund_expired("pass-1".into());
    assert_eq!(payout_callbacks()[0].0, serde_json::json!({"token_id": "pass-1", "previous_status": "Claimed"}));
    assert!(!run_callback(&mut c, "pass-1", PassStatus::Claimed, false, exp + 7));
    let p = c.get_pass("pass-1".into()).unwrap();
    assert_eq!(p.status, PassStatus::Claimed);
    assert_eq!(p.settled_at_ms, None);
    assert_eq!(p.owner_id, shopper());
    assert_eq!(queue(&c, &merchant(), OFFER), vec!["pass-3"], "a Claimed pass is not queued");
    assert_eq!(c.offer_stats(merchant(), OFFER.into()), before);
    assert_eq!(extra(&c, "pass-1")["status"], "Claimed");
    assert_eq!(
        get_logs(),
        vec![line_metadata_update("pass-1"), line_payout_failed("pass-1", value())]
    );
    set(&friend(), yocto(0), exp + 8);
    c.refund_expired("pass-1".into());
    assert_eq!(transfers(), vec![(merchant(), value())]);
    assert!(run_callback(&mut c, "pass-1", PassStatus::Claimed, true, exp + 9));
    let s = c.offer_stats(merchant(), OFFER.into());
    assert_eq!((s.open, s.claimed, s.refunded, s.held), (1, 0, 2, value()));
}

#[test]
fn ac_req_15_08_01_successful_payout_changes_nothing() {
    let mut c = setup();
    let exp = NOW_MS + HOUR_MS;
    mint_n(&mut c, &merchant(), OFFER, 2, exp);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS); // pass-1 Claimed, pass-2 Open

    set(&merchant(), yocto(1), NOW_MS + 5000);
    c.redeem_pass("pass-1".into());
    set(&friend(), yocto(0), exp);
    c.refund_expired("pass-2".into());
    let stats = c.offer_stats(merchant(), OFFER.into());
    let p1 = c.get_pass("pass-1".into()).unwrap();
    let p2 = c.get_pass("pass-2".into()).unwrap();
    let q = queue(&c, &merchant(), OFFER);

    assert!(run_callback(&mut c, "pass-1", PassStatus::Claimed, true, exp + 1));
    assert!(get_logs().is_empty());
    assert!(run_callback(&mut c, "pass-2", PassStatus::Open, true, exp + 2));
    assert!(get_logs().is_empty());
    assert!(get_created_receipts().is_empty());
    assert_eq!(c.get_pass("pass-1".into()).unwrap(), p1);
    assert_eq!(c.get_pass("pass-2".into()).unwrap(), p2);
    assert_eq!(p1.status, PassStatus::Redeemed);
    assert_eq!(p2.status, PassStatus::Refunded);
    assert_eq!(c.offer_stats(merchant(), OFFER.into()), stats);
    assert_eq!(queue(&c, &merchant(), OFFER), q);
}

#[test]
fn ac_req_15_08_01_callback_is_private() {
    let mut c = setup();
    mint_n(&mut c, &merchant(), OFFER, 2, NOW_MS + DAY_MS);
    claim(&mut c, &merchant(), OFFER, &shopper(), NOW_MS);
    set(&merchant(), yocto(1), NOW_MS);
    c.redeem_pass("pass-1".into());
    let stats = c.offer_stats(merchant(), OFFER.into());

    // Anyone but the contract itself is refused, whatever result it claims.
    for who in [merchant(), shopper(), friend(), agent(), owner()] {
        assert_refused(&mut c, context(&who, yocto(0), NOW_MS), "Method on_payout is private", |c| {
            c.on_payout("pass-1".into(), PassStatus::Claimed, Err(PromiseError::Failed))
        });
        assert_refused(&mut c, context(&who, yocto(0), NOW_MS), "Method on_payout is private", |c| {
            c.on_payout("pass-1".into(), PassStatus::Claimed, Ok(()))
        });
    }
    assert_eq!(status(&c, "pass-1"), PassStatus::Redeemed);
    assert_eq!(c.offer_stats(merchant(), OFFER.into()), stats);
    // Even from the contract, a pass that is not settled (pass-2 is Open) is not touched.
    assert_refused(&mut c, context(&contract_id(), yocto(0), NOW_MS), "not Redeemed or Refunded", |c| {
        c.on_payout("pass-2".into(), PassStatus::Claimed, Err(PromiseError::Failed))
    });
}

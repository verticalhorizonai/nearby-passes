//! Nearby Passes: a NEP-171 NFT that holds a testnet NEAR balance per pass.
//!
//! Spec: `builds/nearby-passes/spec.md` section 3.4 (state 3.4.1, methods 3.4.2, rules 3.4.3,
//! minting and storage 3.4.4, metadata 3.4.5, events 3.4.6, tests 3.4.7) and build ruling 49(d)
//! (an Open pass cannot be moved with `nft_transfer` or `nft_transfer_call`, whoever calls).
//!
//! Started from `near-sdk-rs/examples/non-fungible-token/nft/src/lib.rs` at near-sdk 5.30.1: the
//! standard traits are implemented by hand under `#[near]`, delegating to `NonFungibleToken`.

use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::collections::{LazyOption, LookupMap, LookupSet, Vector};
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{
    assert_one_yocto, env, near, require, serde_json, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};
use std::collections::HashMap;

/// Bytes charged per pass at mint on top of the measured storage, for the storage that grows
/// later (a new holder's token set, a 64-character holder id, metadata rewrites). Spec 3.4.4.
pub const LATER_STORAGE_BYTES: u64 = 500; // measured: a first claim to a 64-character holder +417 bytes, a redeem +9 (ruling 52(e))
/// The smallest balance a pass may hold: 0.01 NEAR.
pub const MIN_VALUE: NearToken = NearToken::from_millinear(10);
pub const MAX_COUNT: u32 = 10;
pub const MAX_EXPIRY_MS: u64 = 30 * 24 * 60 * 60 * 1000;
pub const MAX_OFFER_ID_CHARS: usize = 64;
pub const MAX_TITLE_CHARS: usize = 80;
pub const MAX_DESCRIPTION_CHARS: usize = 200;
pub const DESCRIPTION_SUFFIX: &str = "Sample merchant. Testnet only.";
/// The default and largest page of the list views.
pub const DEFAULT_LIMIT: u32 = 50;
pub const MAX_LIMIT: u32 = 100;

pub const CONTRACT_NAME: &str = "Nearby Passes";
pub const CONTRACT_SYMBOL: &str = "NBYPASS";

/// Static gas for the `on_payout` callback (REQ-15-08). Its failure branch reads and writes the
/// pass, the stats, the token metadata and (for an Open pass) the offer's queue: a few storage
/// reads and writes and two logs, well under 10 TGas. The callback also keeps the default unused
/// gas weight, so whatever the calling method leaves unspent is added to it. Budget at the 50 TGas
/// the server attaches to `redeem_pass` and `refund_expired`: the method itself (a few TGas), the
/// transfer receipt (about 8.4 TGas to a new implicit account), the callback receipt (about
/// 2.5 TGas of function-call and data-receipt fees plus this 10 TGas): about 25 TGas in all.
pub const PAYOUT_CALLBACK_GAS: Gas = Gas::from_tgas(10);

pub const EVENT_STANDARD: &str = "nearby_pass";
pub const EVENT_VERSION: &str = "1.0.0";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    NonFungibleToken,
    Metadata,
    TokenMetadata,
    Enumeration,
    Passes,
    Open,
    Stats,
    ByMerchant,
    ByMerchantList { account_hash: Vec<u8> },
    Claimed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PassStatus {
    Open,
    Claimed,
    Redeemed,
    Refunded,
}

impl PassStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            PassStatus::Open => "Open",
            PassStatus::Claimed => "Claimed",
            PassStatus::Redeemed => "Redeemed",
            PassStatus::Refunded => "Refunded",
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pass {
    pub merchant_id: AccountId,
    pub offer_id: String,
    pub title: String,
    pub value: NearToken,
    pub expires_at_ms: u64,
    pub status: PassStatus,
    pub claimed_at_ms: Option<u64>,
    pub settled_at_ms: Option<u64>,
}

/// Counts by status for one merchant and offer, and `held` = the value of its Open and Claimed passes.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OfferStats {
    pub open: u32,
    pub claimed: u32,
    pub redeemed: u32,
    pub refunded: u32,
    pub held: NearToken,
}

impl Default for OfferStats {
    fn default() -> Self {
        Self { open: 0, claimed: 0, redeemed: 0, refunded: 0, held: NearToken::from_yoctonear(0) }
    }
}

/// `get_pass` and the list views: the pass fields, the current owner and the token metadata.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PassView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub merchant_id: AccountId,
    pub offer_id: String,
    pub title: String,
    pub value: NearToken,
    pub expires_at_ms: u64,
    pub status: PassStatus,
    pub claimed_at_ms: Option<u64>,
    pub settled_at_ms: Option<u64>,
    pub metadata: Option<TokenMetadata>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConfigView {
    pub owner_id: AccountId,
    pub agent_id: AccountId,
    pub claims_paused: bool,
    pub media_base_url: String,
}

/// The `extra` field of a pass's token metadata (spec 3.4.5), in the spec's key order.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct MetadataExtra<'a> {
    status: &'a str,
    value_yocto: String,
    merchant: &'a str,
    offer_id: &'a str,
}

/// NEP-297 envelope for this contract's own events.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct EventLog<'a, T: Serialize> {
    standard: &'a str,
    version: &'a str,
    event: &'a str,
    data: [T; 1],
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct PassFunded<'a> {
    merchant_id: &'a AccountId,
    offer_id: &'a str,
    token_ids: &'a [TokenId],
    value: NearToken,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct PassClaimed<'a> {
    token_id: &'a str,
    merchant_id: &'a AccountId,
    offer_id: &'a str,
    owner_id: &'a AccountId,
    by: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct PassSettled<'a> {
    token_id: &'a str,
    merchant_id: &'a AccountId,
    offer_id: &'a str,
    value: NearToken,
    paid_to: &'a AccountId,
}

/// REQ-15-08: a payout transfer failed and the pass was put back to its earlier status.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct PayoutFailed<'a> {
    token_id: &'a str,
    value: NearToken,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct ClaimsPaused<'a> {
    paused: bool,
    by: &'a AccountId,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct MetadataUpdate<'a> {
    token_ids: [&'a str; 1],
}

fn log_event<T: Serialize>(standard: &str, version: &str, event: &str, data: T) {
    let line = serde_json::to_string(&EventLog { standard, version, event, data: [data] })
        .unwrap_or_else(|_| env::panic_str("event serialization failed"));
    env::log_str(&format!("EVENT_JSON:{}", line));
}

fn log_pass_event<T: Serialize>(event: &str, data: T) {
    log_event(EVENT_STANDARD, EVENT_VERSION, event, data);
}

/// NEP-171 1.2.0 `nft_metadata_update`; near-contract-standards 5.30.1 has no helper for it.
fn log_metadata_update(token_id: &str) {
    log_event("nep171", "1.2.0", "nft_metadata_update", MetadataUpdate { token_ids: [token_id] });
}

fn now_ms() -> u64 {
    env::block_timestamp() / 1_000_000
}

fn queue_key(merchant_id: &AccountId, offer_id: &str) -> String {
    format!("{}|{}", merchant_id, offer_id)
}

fn claimed_key(merchant_id: &AccountId, offer_id: &str, account_id: &AccountId) -> String {
    format!("{}|{}|{}", merchant_id, offer_id, account_id)
}

/// The mint sequence number of a token id "pass-N", for keeping an offer's queue oldest first.
fn token_seq(token_id: &str) -> u64 {
    token_id.strip_prefix("pass-").and_then(|n| n.parse().ok()).unwrap_or(u64::MAX)
}

/// A 64-character id is an implicit account; it can only exist if it is lowercase hex (3.6.2).
fn is_payable_receiver(account_id: &AccountId) -> bool {
    let s = account_id.as_str();
    s.len() != 64 || s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    passes: LookupMap<TokenId, Pass>,
    /// "merchant_id|offer_id" -> Open token ids, oldest first.
    open: LookupMap<String, Vec<TokenId>>,
    /// "merchant_id|offer_id" -> counts and the balance held.
    stats: LookupMap<String, OfferStats>,
    by_merchant: LookupMap<AccountId, Vector<TokenId>>,
    /// "merchant_id|offer_id|account_id" for every claim made.
    claimed: LookupSet<String>,
    owner_id: AccountId,
    agent_id: AccountId,
    claims_paused: bool,
    media_base_url: String,
    next_id: u64,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, agent_id: AccountId, media_base_url: String) -> Self {
        require!(!env::state_exists(), "Already initialized");
        let metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: CONTRACT_NAME.to_string(),
            symbol: CONTRACT_SYMBOL.to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        metadata.assert_valid();
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::NonFungibleToken,
                owner_id.clone(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                None::<StorageKey>,
            ),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            passes: LookupMap::new(StorageKey::Passes),
            open: LookupMap::new(StorageKey::Open),
            stats: LookupMap::new(StorageKey::Stats),
            by_merchant: LookupMap::new(StorageKey::ByMerchant),
            claimed: LookupSet::new(StorageKey::Claimed),
            owner_id,
            agent_id,
            claims_paused: false,
            media_base_url,
            next_id: 0,
        }
    }

    // ---------------------------------------------------------------- merchant: fund

    /// Mints `count` passes owned by this contract, status Open. The caller is the merchant and
    /// attaches `count × value` plus the storage; the excess is refunded (spec 3.4.4).
    #[payable]
    pub fn mint_passes(
        &mut self,
        offer_id: String,
        title: String,
        description: String,
        value: NearToken,
        expires_at_ms: u64,
        count: u32,
    ) -> Vec<TokenId> {
        let merchant_id = env::predecessor_account_id();
        let now = now_ms();
        require!(count >= 1 && count <= MAX_COUNT, "count must be 1 to 10");
        require!(value >= MIN_VALUE, "value must be at least 0.01 NEAR");
        require!(expires_at_ms > now, "expiry must be in the future");
        require!(expires_at_ms - now <= MAX_EXPIRY_MS, "expiry must be at most 30 days away");
        require!(!offer_id.is_empty(), "offer_id is required");
        require!(
            offer_id.chars().count() <= MAX_OFFER_ID_CHARS,
            "offer_id must be at most 64 characters"
        );
        require!(!offer_id.contains('|'), "offer_id must not contain |");
        require!(title.chars().count() <= MAX_TITLE_CHARS, "title must be at most 80 characters");
        require!(
            description.chars().count() <= MAX_DESCRIPTION_CHARS,
            "description must be at most 200 characters"
        );
        let balances = value
            .checked_mul(count as u128)
            .unwrap_or_else(|| env::panic_str("value overflow"));
        // A cheap early refusal before any write; the exact check follows the measurement.
        require!(env::attached_deposit() >= balances, "deposit must cover count × value plus storage");

        let full_description = if description.trim().is_empty() {
            DESCRIPTION_SUFFIX.to_string()
        } else {
            format!("{} {}", description.trim_end(), DESCRIPTION_SUFFIX)
        };

        let storage_before = env::storage_usage();
        let contract_id = env::current_account_id();
        let key = queue_key(&merchant_id, &offer_id);
        let mut queue = self.open.get(&key).unwrap_or_default();
        let mut merchant_list = self.by_merchant.get(&merchant_id).unwrap_or_else(|| {
            Vector::new(StorageKey::ByMerchantList {
                account_hash: env::sha256(merchant_id.as_bytes()),
            })
        });
        let mut token_ids = Vec::with_capacity(count as usize);
        for _ in 0..count {
            self.next_id += 1;
            let token_id = format!("pass-{}", self.next_id);
            let pass = Pass {
                merchant_id: merchant_id.clone(),
                offer_id: offer_id.clone(),
                title: title.clone(),
                value,
                expires_at_ms,
                status: PassStatus::Open,
                claimed_at_ms: None,
                settled_at_ms: None,
            };
            let metadata = TokenMetadata {
                title: Some(title.clone()),
                description: Some(full_description.clone()),
                issued_at: Some(now.to_string()),
                expires_at: Some(expires_at_ms.to_string()),
                ..Default::default()
            };
            let metadata = self.metadata_for(&token_id, &pass, metadata, now);
            // Refund id None: no deposit check, no refund, no log (near-contract-standards
            // 5.30.1 core_impl.rs:323-374). The sum and the nft_mint log are done here.
            self.tokens.internal_mint_with_refund(
                token_id.clone(),
                contract_id.clone(),
                Some(metadata),
                None,
            );
            self.passes.insert(&token_id, &pass);
            queue.push(token_id.clone());
            merchant_list.push(&token_id);
            token_ids.push(token_id);
        }
        self.open.insert(&key, &queue);
        self.by_merchant.insert(&merchant_id, &merchant_list);
        let mut stats = self.stats.get(&key).unwrap_or_default();
        stats.open += count;
        stats.held = stats.held.saturating_add(balances);
        self.stats.insert(&key, &stats);

        let measured = env::storage_usage().saturating_sub(storage_before);
        let charged_bytes = measured + count as u64 * LATER_STORAGE_BYTES;
        let storage_cost = env::storage_byte_cost().saturating_mul(charged_bytes as u128);
        let required = balances.saturating_add(storage_cost);
        let attached = env::attached_deposit();
        require!(
            attached >= required,
            format!(
                "deposit must cover count × value plus storage: attach at least {} yoctoNEAR",
                required.as_yoctonear()
            )
        );

        let ids: Vec<&str> = token_ids.iter().map(|s| s.as_str()).collect();
        NftMint { owner_id: &contract_id, token_ids: &ids, memo: None }.emit();
        log_pass_event(
            "pass_funded",
            PassFunded { merchant_id: &merchant_id, offer_id: &offer_id, token_ids: &token_ids, value },
        );

        let excess = attached.saturating_sub(required);
        if excess.as_yoctonear() > 0 {
            Promise::new(merchant_id).transfer(excess).detach();
        }
        token_ids
    }

    // ---------------------------------------------------------------- agent: claim

    /// Moves the oldest Open, unexpired pass of this merchant and offer to `receiver_id`.
    pub fn claim_pass(
        &mut self,
        merchant_id: AccountId,
        offer_id: String,
        receiver_id: AccountId,
    ) -> TokenId {
        let caller = env::predecessor_account_id();
        require!(caller == self.agent_id, "only the agent may claim");
        require!(!self.claims_paused, "claiming is paused");
        require!(
            is_payable_receiver(&receiver_id),
            "a 64-character receiver must be lowercase hex"
        );
        let ckey = claimed_key(&merchant_id, &offer_id, &receiver_id);
        require!(!self.claimed.contains(&ckey), "this account already claimed this offer");

        let now = now_ms();
        let key = queue_key(&merchant_id, &offer_id);
        let mut queue = self.open.get(&key).unwrap_or_default();
        let position = queue
            .iter()
            .position(|id| self.passes.get(id).map(|p| now < p.expires_at_ms).unwrap_or(false))
            .unwrap_or_else(|| env::panic_str("no open pass left for this offer"));
        let token_id = queue.remove(position);
        let mut pass = self.passes.get(&token_id).unwrap();
        require!(pass.status == PassStatus::Open, "pass is not Open");

        // Logs nft_transfer itself (core_impl.rs:201-253, emit at :249).
        self.tokens.internal_transfer(
            &env::current_account_id(),
            &receiver_id,
            &token_id,
            None,
            None,
        );
        pass.status = PassStatus::Claimed;
        pass.claimed_at_ms = Some(now);
        self.passes.insert(&token_id, &pass);
        self.open.insert(&key, &queue);
        self.claimed.insert(&ckey);
        let mut stats = self.stats.get(&key).unwrap_or_default();
        stats.open = stats.open.saturating_sub(1);
        stats.claimed += 1;
        self.stats.insert(&key, &stats);
        self.rewrite_metadata(&token_id, &pass, now);
        log_pass_event(
            "pass_claimed",
            PassClaimed {
                token_id: &token_id,
                merchant_id: &pass.merchant_id,
                offer_id: &pass.offer_id,
                owner_id: &receiver_id,
                by: &caller,
            },
        );
        token_id
    }

    // ---------------------------------------------------------------- merchant: redeem

    /// The pass's merchant, with exactly 1 yoctoNEAR, redeems a Claimed, unexpired pass; the
    /// current holder is paid `value`.
    #[payable]
    pub fn redeem_pass(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let mut pass = self.passes.get(&token_id).unwrap_or_else(|| env::panic_str("no such pass"));
        require!(
            env::predecessor_account_id() == pass.merchant_id,
            "only the pass's merchant may redeem"
        );
        require!(pass.status == PassStatus::Claimed, "pass is not Claimed");
        let now = now_ms();
        require!(now < pass.expires_at_ms, "pass has expired");
        let holder = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"));

        // Status first, so a second call fails on status (3.4.3).
        pass.status = PassStatus::Redeemed;
        pass.settled_at_ms = Some(now);
        self.passes.insert(&token_id, &pass);
        let key = queue_key(&pass.merchant_id, &pass.offer_id);
        let mut stats = self.stats.get(&key).unwrap_or_default();
        stats.claimed = stats.claimed.saturating_sub(1);
        stats.redeemed += 1;
        stats.held = stats.held.saturating_sub(pass.value);
        self.stats.insert(&key, &stats);
        self.rewrite_metadata(&token_id, &pass, now);
        log_pass_event(
            "pass_redeemed",
            PassSettled {
                token_id: &token_id,
                merchant_id: &pass.merchant_id,
                offer_id: &pass.offer_id,
                value: pass.value,
                paid_to: &holder,
            },
        );
        self.pay_out(&token_id, holder, pass.value, PassStatus::Claimed);
    }

    // ---------------------------------------------------------------- anyone: refund

    /// At or after expiry, anyone returns an Open or Claimed pass's balance to its merchant.
    pub fn refund_expired(&mut self, token_id: TokenId) {
        let mut pass = self.passes.get(&token_id).unwrap_or_else(|| env::panic_str("no such pass"));
        let was = pass.status;
        require!(
            was == PassStatus::Open || was == PassStatus::Claimed,
            "only an Open or Claimed pass can be refunded"
        );
        let now = now_ms();
        require!(now >= pass.expires_at_ms, "pass has not expired");

        pass.status = PassStatus::Refunded;
        pass.settled_at_ms = Some(now);
        self.passes.insert(&token_id, &pass);
        let key = queue_key(&pass.merchant_id, &pass.offer_id);
        if was == PassStatus::Open {
            let mut queue = self.open.get(&key).unwrap_or_default();
            queue.retain(|id| id != &token_id);
            self.open.insert(&key, &queue);
        }
        let mut stats = self.stats.get(&key).unwrap_or_default();
        if was == PassStatus::Open {
            stats.open = stats.open.saturating_sub(1);
        } else {
            stats.claimed = stats.claimed.saturating_sub(1);
        }
        stats.refunded += 1;
        stats.held = stats.held.saturating_sub(pass.value);
        self.stats.insert(&key, &stats);
        self.rewrite_metadata(&token_id, &pass, now);
        log_pass_event(
            "pass_refunded",
            PassSettled {
                token_id: &token_id,
                merchant_id: &pass.merchant_id,
                offer_id: &pass.offer_id,
                value: pass.value,
                paid_to: &pass.merchant_id,
            },
        );
        self.pay_out(&token_id, pass.merchant_id.clone(), pass.value, was);
    }

    // ---------------------------------------------------------------- payout callback

    /// REQ-15-08 (AC-REQ-15-08-01): runs after a payout transfer. On success nothing changes and
    /// it returns true. On failure the balance came back to this contract, so the pass is put back
    /// to `previous_status` (Claimed after a redeem; Open, back in its offer's queue, or Claimed
    /// after a refund), `settled_at_ms` is cleared, the stats change is reversed, the metadata is
    /// rewritten (`nft_metadata_update`) and `payout_failed` is logged; it returns false. A second
    /// redeem or refund can then pay.
    #[private]
    pub fn on_payout(
        &mut self,
        token_id: TokenId,
        previous_status: PassStatus,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        // `#[private]` is checked by the generated wasm entry point; checked here too so the rule
        // holds (and is unit-tested) when the method is called directly.
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Method on_payout is private"
        );
        if result.is_ok() {
            return true;
        }
        let mut pass = self.passes.get(&token_id).unwrap_or_else(|| env::panic_str("no such pass"));
        let settled = pass.status;
        require!(
            settled == PassStatus::Redeemed || settled == PassStatus::Refunded,
            "pass is not Redeemed or Refunded"
        );
        require!(
            previous_status == PassStatus::Claimed
                || (previous_status == PassStatus::Open && settled == PassStatus::Refunded),
            "invalid previous status"
        );
        let now = now_ms();
        pass.status = previous_status;
        pass.settled_at_ms = None;
        self.passes.insert(&token_id, &pass);
        let key = queue_key(&pass.merchant_id, &pass.offer_id);
        if previous_status == PassStatus::Open {
            let mut queue = self.open.get(&key).unwrap_or_default();
            if !queue.contains(&token_id) {
                let seq = token_seq(&token_id);
                let at = queue.iter().position(|id| token_seq(id) > seq).unwrap_or(queue.len());
                queue.insert(at, token_id.clone());
                self.open.insert(&key, &queue);
            }
        }
        let mut stats = self.stats.get(&key).unwrap_or_default();
        if settled == PassStatus::Redeemed {
            stats.redeemed = stats.redeemed.saturating_sub(1);
        } else {
            stats.refunded = stats.refunded.saturating_sub(1);
        }
        if previous_status == PassStatus::Open {
            stats.open += 1;
        } else {
            stats.claimed += 1;
        }
        stats.held = stats.held.saturating_add(pass.value);
        self.stats.insert(&key, &stats);
        self.rewrite_metadata(&token_id, &pass, now);
        log_pass_event("payout_failed", PayoutFailed { token_id: &token_id, value: pass.value });
        false
    }

    // ---------------------------------------------------------------- owner controls

    #[payable]
    pub fn set_claims_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.claims_paused = paused;
        log_pass_event("claims_paused", ClaimsPaused { paused, by: &env::predecessor_account_id() });
    }

    #[payable]
    pub fn set_agent(&mut self, agent_id: AccountId) {
        self.assert_owner();
        self.agent_id = agent_id;
    }

    #[payable]
    pub fn set_media_base_url(&mut self, url: String) {
        self.assert_owner();
        self.media_base_url = url;
    }

    // ---------------------------------------------------------------- views

    pub fn get_pass(&self, token_id: TokenId) -> Option<PassView> {
        self.pass_view(token_id)
    }

    /// The passes `account_id` holds, for My passes.
    pub fn passes_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<PassView> {
        let (from, limit) = page(from_index, limit);
        let Some(set) = self.tokens.tokens_per_owner.as_ref().and_then(|m| m.get(&account_id))
        else {
            return vec![];
        };
        set.iter().skip(from).take(limit).filter_map(|id| self.pass_view(id)).collect()
    }

    /// A merchant's passes, newest first.
    pub fn passes_for_merchant(
        &self,
        merchant_id: AccountId,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<PassView> {
        let (from, limit) = page(from_index, limit);
        let Some(list) = self.by_merchant.get(&merchant_id) else {
            return vec![];
        };
        let len = list.len();
        (0..len)
            .rev()
            .skip(from)
            .take(limit)
            .filter_map(|i| list.get(i))
            .filter_map(|id| self.pass_view(id))
            .collect()
    }

    pub fn offer_stats(&self, merchant_id: AccountId, offer_id: String) -> OfferStats {
        self.stats.get(&queue_key(&merchant_id, &offer_id)).unwrap_or_default()
    }

    pub fn config(&self) -> ConfigView {
        ConfigView {
            owner_id: self.owner_id.clone(),
            agent_id: self.agent_id.clone(),
            claims_paused: self.claims_paused,
            media_base_url: self.media_base_url.clone(),
        }
    }
}

// -------------------------------------------------------------------- internals

fn page(from_index: Option<u32>, limit: Option<u32>) -> (usize, usize) {
    let from = from_index.unwrap_or(0) as usize;
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as usize;
    (from, limit)
}

impl Contract {
    fn assert_owner(&self) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner_id, "only the owner may do this");
    }

    /// Fills the fields of 3.4.5 that follow the pass's status and the current media base.
    fn metadata_for(
        &self,
        token_id: &str,
        pass: &Pass,
        mut metadata: TokenMetadata,
        now: u64,
    ) -> TokenMetadata {
        let extra = MetadataExtra {
            status: pass.status.as_str(),
            value_yocto: pass.value.as_yoctonear().to_string(),
            merchant: pass.merchant_id.as_str(),
            offer_id: &pass.offer_id,
        };
        metadata.media = Some(format!("{}{}.svg", self.media_base_url, token_id));
        metadata.reference = Some(format!("{}{}.json", self.media_base_url, token_id));
        metadata.updated_at = Some(now.to_string());
        metadata.extra = Some(
            serde_json::to_string(&extra).unwrap_or_else(|_| env::panic_str("extra serialization")),
        );
        metadata
    }

    /// Rewrites a token's metadata after a status change and logs `nft_metadata_update`.
    /// `token_metadata_by_id` is public on `NonFungibleToken` (core_impl.rs:46).
    fn rewrite_metadata(&mut self, token_id: &TokenId, pass: &Pass, now: u64) {
        let by_id = self
            .tokens
            .token_metadata_by_id
            .as_ref()
            .unwrap_or_else(|| env::panic_str("metadata extension missing"));
        let current = by_id.get(token_id).unwrap_or_default();
        let updated = self.metadata_for(token_id, pass, current, now);
        self.tokens.token_metadata_by_id.as_mut().unwrap().insert(token_id, &updated);
        log_metadata_update(token_id);
    }

    /// The one place a pass's balance leaves the contract: a promise whose only action is the
    /// transfer (3.6.2), then `on_payout` on this contract as a separate receipt that puts the
    /// status back if the transfer fails (REQ-15-08).
    fn pay_out(&mut self, token_id: &TokenId, to: AccountId, value: NearToken, previous: PassStatus) {
        Promise::new(to)
            .transfer(value)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(PAYOUT_CALLBACK_GAS)
                    .on_payout(token_id.clone(), previous),
            )
            .detach();
    }

    fn pass_view(&self, token_id: TokenId) -> Option<PassView> {
        let pass = self.passes.get(&token_id)?;
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        let metadata = self.tokens.token_metadata_by_id.as_ref().and_then(|m| m.get(&token_id));
        Some(PassView {
            token_id,
            owner_id,
            merchant_id: pass.merchant_id,
            offer_id: pass.offer_id,
            title: pass.title,
            value: pass.value,
            expires_at_ms: pass.expires_at_ms,
            status: pass.status,
            claimed_at_ms: pass.claimed_at_ms,
            settled_at_ms: pass.settled_at_ms,
            metadata,
        })
    }

    /// Ruling 49(d), extended by ruling 52(d): an Open pass is owned by the contract account and nobody moves it; nor
    /// any other pass the contract account still holds (a Refunded pass that was never claimed), whoever calls.
    fn assert_transferable(&self, token_id: &TokenId) {
        if let Some(pass) = self.passes.get(token_id) {
            require!(pass.status != PassStatus::Open, "an Open pass cannot be transferred");
        }
        if let Some(owner) = self.tokens.owner_by_id.get(token_id) {
            require!(owner != env::current_account_id(), "a pass the contract holds cannot be transferred");
        }
    }
}

// -------------------------------------------------------------------- NEP-171

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.assert_transferable(&token_id);
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.assert_transferable(&token_id);
        self.tokens.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)
    }
}

// -------------------------------------------------------------------- NEP-181

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

// -------------------------------------------------------------------- NEP-177

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests;

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::{StablecoinInitConfig, Role};

declare_id!("CmyUqWVb4agcavSybreJ7xb7WoKUyWhpkEc6f1DnMEGJ");

#[cfg(not(feature = "no-entrypoint"))]
use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "SSS Token — Solana Stablecoin Standard",
    project_url: "https://github.com/Nuel-osas/solana-stablecoin-standard",
    contacts: "link:https://github.com/Nuel-osas/solana-stablecoin-standard/issues",
    policy: "https://github.com/Nuel-osas/solana-stablecoin-standard/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/Nuel-osas/solana-stablecoin-standard",
    auditors: "None"
}

#[program]
pub mod sss_token {
    use super::*;

    // ============ Initialization ============

    /// Initialize a new stablecoin with the given configuration.
    /// Supports SSS-1 (minimal) and SSS-2 (compliant) presets, or custom configs.
    pub fn initialize(ctx: Context<Initialize>, config: StablecoinInitConfig) -> Result<()> {
        instructions::initialize::handler(ctx, config)
    }

    // ============ Core Operations (All Presets) ============

    /// Mint tokens to a recipient. Caller must have minter role.
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        instructions::mint::handler(ctx, amount)
    }

    /// Burn tokens from the caller's account. Caller must have burner role.
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        instructions::burn::handler(ctx, amount)
    }

    /// Freeze a token account. Caller must have master or pauser role.
    pub fn freeze_account(ctx: Context<FreezeAccount>) -> Result<()> {
        instructions::freeze::freeze_handler(ctx)
    }

    /// Thaw a frozen token account. Caller must have master or pauser role.
    pub fn thaw_account(ctx: Context<ThawAccount>) -> Result<()> {
        instructions::freeze::thaw_handler(ctx)
    }

    /// Pause all token operations. Caller must have pauser role.
    pub fn pause(ctx: Context<PauseUnpause>) -> Result<()> {
        instructions::pause::pause_handler(ctx)
    }

    /// Unpause token operations. Caller must have pauser role.
    pub fn unpause(ctx: Context<PauseUnpause>) -> Result<()> {
        instructions::pause::unpause_handler(ctx)
    }

    // ============ Role Management ============

    /// Add or update a role assignment. Caller must be master authority.
    pub fn assign_role(ctx: Context<AssignRole>, role: Role, assignee: Pubkey) -> Result<()> {
        instructions::roles::assign_role_handler(ctx, role, assignee)
    }

    /// Revoke a role assignment. Caller must be master authority.
    pub fn revoke_role(ctx: Context<RevokeRole>, role: Role, assignee: Pubkey) -> Result<()> {
        instructions::roles::revoke_role_handler(ctx, role, assignee)
    }

    /// Nominate a new master authority (two-step transfer, step 1).
    /// The new authority must call accept_authority to complete the transfer.
    /// This prevents accidental loss of authority from typos.
    pub fn nominate_authority(ctx: Context<NominateAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::roles::nominate_authority_handler(ctx, new_authority)
    }

    /// Accept a pending authority nomination (two-step transfer, step 2).
    /// Caller must be the nominated pending authority.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::roles::accept_authority_handler(ctx)
    }

    /// Direct transfer of master authority (single-step, use with caution).
    /// Prefer nominate_authority + accept_authority for safety.
    pub fn transfer_authority(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::roles::transfer_authority_handler(ctx, new_authority)
    }

    /// Update minter quota. Caller must be master authority.
    pub fn update_minter_quota(ctx: Context<UpdateMinterQuota>, new_quota: u64) -> Result<()> {
        instructions::roles::update_minter_quota_handler(ctx, new_quota)
    }

    /// Set or update the supply cap. Only master authority. Set to 0 to remove cap.
    pub fn set_supply_cap(ctx: Context<SetSupplyCap>, supply_cap: u64) -> Result<()> {
        instructions::roles::set_supply_cap_handler(ctx, supply_cap)
    }

    // ============ SSS-2 Compliance Operations ============

    /// Add an address to the blacklist. Caller must have blacklister role.
    /// Fails gracefully if compliance was not enabled during initialization.
    pub fn add_to_blacklist(
        ctx: Context<BlacklistAdd>,
        address: Pubkey,
        reason: String,
    ) -> Result<()> {
        instructions::compliance::add_to_blacklist_handler(ctx, address, reason)
    }

    /// Remove an address from the blacklist. Caller must have blacklister role.
    pub fn remove_from_blacklist(ctx: Context<BlacklistRemove>, address: Pubkey) -> Result<()> {
        instructions::compliance::remove_from_blacklist_handler(ctx, address)
    }

    /// Seize tokens from a frozen/blacklisted account via permanent delegate.
    /// Caller must have seizer role. SSS-2 only.
    pub fn seize(ctx: Context<Seize>) -> Result<()> {
        instructions::compliance::seize_handler(ctx)
    }
}

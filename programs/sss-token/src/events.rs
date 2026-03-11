use anchor_lang::prelude::*;

#[event]
pub struct StablecoinInitialized {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub compliance_enabled: bool,
    pub transfer_hook_enabled: bool,
    pub timestamp: i64,
}

#[event]
pub struct TokensMinted {
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub minter: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokensBurned {
    pub mint: Pubkey,
    pub amount: u64,
    pub burner: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AccountFrozen {
    pub mint: Pubkey,
    pub account: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AccountThawed {
    pub mint: Pubkey,
    pub account: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct Paused {
    pub mint: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct Unpaused {
    pub mint: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RoleAssigned {
    pub mint: Pubkey,
    pub role: String,
    pub assignee: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RoleRevoked {
    pub mint: Pubkey,
    pub role: String,
    pub assignee: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityNominated {
    pub mint: Pubkey,
    pub current_authority: Pubkey,
    pub pending_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityTransferred {
    pub mint: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SupplyCapUpdated {
    pub mint: Pubkey,
    pub old_cap: u64,
    pub new_cap: u64,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BlacklistAdded {
    pub mint: Pubkey,
    pub address: Pubkey,
    pub reason: String,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BlacklistRemoved {
    pub mint: Pubkey,
    pub address: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AllowlistAdded {
    pub mint: Pubkey,
    pub address: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AllowlistRemoved {
    pub mint: Pubkey,
    pub address: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokensSeized {
    pub mint: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct OracleConfigured {
    pub mint: Pubkey,
    pub price_feed: Pubkey,
    pub max_deviation_bps: u16,
    pub max_staleness_secs: u64,
    pub enabled: bool,
    pub by: Pubkey,
    pub timestamp: i64,
}

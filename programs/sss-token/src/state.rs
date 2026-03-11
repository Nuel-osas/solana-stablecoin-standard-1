use anchor_lang::prelude::*;

use crate::constants::*;

/// Core stablecoin configuration account.
/// Seeds: ["stablecoin", mint_pubkey]
#[account]
pub struct Stablecoin {
    /// Master authority — can assign/revoke all roles
    pub authority: Pubkey,
    /// Token mint address (Token-2022)
    pub mint: Pubkey,
    /// Stablecoin name
    pub name: String,
    /// Stablecoin symbol
    pub symbol: String,
    /// Metadata URI
    pub uri: String,
    /// Token decimals
    pub decimals: u8,
    /// Whether the token is paused
    pub paused: bool,
    /// SSS-2: permanent delegate enabled
    pub enable_permanent_delegate: bool,
    /// SSS-2: transfer hook enabled
    pub enable_transfer_hook: bool,
    /// SSS-2: whether new accounts start frozen (default_account_frozen)
    pub default_account_frozen: bool,
    /// Total minted supply tracked on-chain
    pub total_minted: u64,
    /// Total burned tracked on-chain
    pub total_burned: u64,
    /// Maximum supply cap (0 = unlimited)
    pub supply_cap: u64,
    /// Pending authority for two-step transfer (Pubkey::default() = none)
    pub pending_authority: Pubkey,
    /// PDA bump
    pub bump: u8,
    /// Reserved for future upgrades
    pub _reserved: [u8; 24],
}

impl Stablecoin {
    pub const LEN: usize = 8 +   // discriminator
        32 +                       // authority
        32 +                       // mint
        (4 + MAX_NAME_LEN) +       // name (string)
        (4 + MAX_SYMBOL_LEN) +     // symbol (string)
        (4 + MAX_URI_LEN) +        // uri (string)
        1 +                        // decimals
        1 +                        // paused
        1 +                        // enable_permanent_delegate
        1 +                        // enable_transfer_hook
        1 +                        // default_account_frozen
        8 +                        // total_minted
        8 +                        // total_burned
        8 +                        // supply_cap
        32 +                       // pending_authority
        1 +                        // bump
        24;                        // _reserved

    pub fn is_compliance_enabled(&self) -> bool {
        self.enable_permanent_delegate || self.enable_transfer_hook
    }
}

/// Role assignment account.
/// Seeds: ["role", stablecoin_pubkey, role_type_bytes, assignee_pubkey]
#[account]
pub struct RoleAssignment {
    /// The stablecoin this role belongs to
    pub stablecoin: Pubkey,
    /// The role type
    pub role: Role,
    /// Who holds the role
    pub assignee: Pubkey,
    /// Whether the role is active
    pub active: bool,
    /// PDA bump
    pub bump: u8,
}

impl RoleAssignment {
    pub const LEN: usize = 8 + 32 + 1 + 32 + 1 + 1;
}

/// Per-minter info (tracks quota usage).
/// Seeds: ["minter_info", stablecoin_pubkey, minter_pubkey]
#[account]
pub struct MinterInfo {
    pub stablecoin: Pubkey,
    pub minter: Pubkey,
    /// Maximum amount this minter can mint (0 = unlimited)
    pub quota: u64,
    /// Amount already minted by this minter
    pub minted: u64,
    pub bump: u8,
}

impl MinterInfo {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;
}

/// Blacklist entry for SSS-2 compliance.
/// Seeds: ["blacklist", stablecoin_pubkey, address_pubkey]
#[account]
pub struct BlacklistEntry {
    pub stablecoin: Pubkey,
    pub address: Pubkey,
    pub reason: String,
    pub blacklisted_at: i64,
    pub blacklisted_by: Pubkey,
    pub bump: u8,
}

impl BlacklistEntry {
    pub const LEN: usize = 8 + 32 + 32 + (4 + MAX_REASON_LEN) + 8 + 32 + 1;
}

/// Roles in the stablecoin system.
/// No single key controls everything — separation of concerns.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Can mint tokens (with per-minter quotas)
    Minter,
    /// Can burn tokens
    Burner,
    /// Can add/remove from blacklist (SSS-2)
    Blacklister,
    /// Can pause/unpause, freeze/thaw accounts
    Pauser,
    /// Can seize tokens via permanent delegate (SSS-2)
    Seizer,
}

impl Role {
    pub fn to_seed(&self) -> &[u8] {
        match self {
            Role::Minter => b"minter",
            Role::Burner => b"burner",
            Role::Blacklister => b"blacklister",
            Role::Pauser => b"pauser",
            Role::Seizer => b"seizer",
        }
    }

    pub fn to_string(&self) -> String {
        match self {
            Role::Minter => "minter".to_string(),
            Role::Burner => "burner".to_string(),
            Role::Blacklister => "blacklister".to_string(),
            Role::Pauser => "pauser".to_string(),
            Role::Seizer => "seizer".to_string(),
        }
    }
}

/// Configuration passed during initialization.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StablecoinInitConfig {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub decimals: u8,
    /// SSS-2: enable permanent delegate for token seizure
    pub enable_permanent_delegate: bool,
    /// SSS-2: enable transfer hook for blacklist enforcement
    pub enable_transfer_hook: bool,
    /// SSS-2: new accounts start frozen until explicitly thawed
    pub default_account_frozen: bool,
    /// Optional supply cap (None or 0 = unlimited)
    pub supply_cap: Option<u64>,
}

impl StablecoinInitConfig {
    /// SSS-1 preset: minimal stablecoin
    pub fn sss1(name: String, symbol: String, uri: String, decimals: u8) -> Self {
        Self {
            name,
            symbol,
            uri,
            decimals,
            enable_permanent_delegate: false,
            enable_transfer_hook: false,
            default_account_frozen: false,
            supply_cap: None,
        }
    }

    /// SSS-2 preset: compliant stablecoin with full enforcement
    pub fn sss2(name: String, symbol: String, uri: String, decimals: u8) -> Self {
        Self {
            name,
            symbol,
            uri,
            decimals,
            enable_permanent_delegate: true,
            enable_transfer_hook: true,
            default_account_frozen: false,
            supply_cap: None,
        }
    }
}

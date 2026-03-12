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
    /// SSS-3: allowlist enabled (restricts transfers to pre-approved addresses)
    pub enable_allowlist: bool,
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
    pub _reserved: [u8; 23],
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
        1 +                        // enable_allowlist
        8 +                        // total_minted
        8 +                        // total_burned
        8 +                        // supply_cap
        32 +                       // pending_authority
        1 +                        // bump
        23;                        // _reserved

    /// Returns true if any SSS-2 compliance feature (permanent delegate or transfer hook) is enabled.
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
    /// Who granted this role
    pub granted_by: Pubkey,
    /// When the role was granted (unix timestamp)
    pub granted_at: i64,
    /// PDA bump
    pub bump: u8,
}

impl RoleAssignment {
    pub const LEN: usize = 8 + 32 + 1 + 32 + 1 + 32 + 8 + 1;
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
/// Entries are never deleted — they are deactivated to preserve the audit trail.
#[account]
pub struct BlacklistEntry {
    pub stablecoin: Pubkey,
    pub address: Pubkey,
    pub reason: String,
    pub blacklisted_at: i64,
    pub blacklisted_by: Pubkey,
    /// Whether this entry is currently active
    pub active: bool,
    pub bump: u8,
}

impl BlacklistEntry {
    pub const LEN: usize = 8 + 32 + 32 + (4 + MAX_REASON_LEN) + 8 + 32 + 1 + 1;
}

/// Allowlist entry for SSS-3 privacy-preserving compliance.
/// Seeds: ["allowlist", stablecoin_pubkey, address_pubkey]
#[account]
pub struct AllowlistEntry {
    pub stablecoin: Pubkey,
    pub address: Pubkey,
    pub added_at: i64,
    pub added_by: Pubkey,
    pub bump: u8,
}

impl AllowlistEntry {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 32 + 1;
}

/// Oracle configuration for on-chain price validation.
/// Seeds: ["oracle_config", stablecoin_pubkey]
#[account]
pub struct OracleConfig {
    /// The stablecoin this oracle config belongs to
    pub stablecoin: Pubkey,
    /// Pyth price feed account address
    pub price_feed: Pubkey,
    /// Maximum allowed deviation from $1.00 in basis points (e.g., 100 = 1%)
    pub max_deviation_bps: u16,
    /// Maximum staleness in seconds (reject prices older than this)
    pub max_staleness_secs: u64,
    /// Whether oracle enforcement is active
    pub enabled: bool,
    /// PDA bump
    pub bump: u8,
}

impl OracleConfig {
    pub const LEN: usize = 8 +  // discriminator
        32 +                      // stablecoin
        32 +                      // price_feed
        2 +                       // max_deviation_bps
        8 +                       // max_staleness_secs
        1 +                       // enabled
        1;                        // bump
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
    /// Returns the PDA seed bytes for this role variant.
    pub fn to_seed(&self) -> &[u8] {
        match self {
            Role::Minter => b"minter",
            Role::Burner => b"burner",
            Role::Blacklister => b"blacklister",
            Role::Pauser => b"pauser",
            Role::Seizer => b"seizer",
        }
    }

    /// Returns a human-readable string for this role (used in events).
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
    /// SSS-3: enable allowlist (restricts transfers to pre-approved addresses)
    pub enable_allowlist: bool,
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
            enable_allowlist: false,
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
            enable_allowlist: false,
            supply_cap: None,
        }
    }

    /// SSS-3 preset: private stablecoin with allowlist-gated compliance.
    /// Builds on SSS-2 (permanent delegate + transfer hook) and adds allowlist
    /// enforcement. Designed for privacy-preserving stablecoins where transfer
    /// hooks enforce allowlist checks instead of (or alongside) blacklists.
    /// Note: Full confidential transfers require client-side ZK proof generation
    /// which is handled by the SDK's PrivacyModule.
    pub fn sss3(name: String, symbol: String, uri: String, decimals: u8) -> Self {
        Self {
            name,
            symbol,
            uri,
            decimals,
            enable_permanent_delegate: true,
            enable_transfer_hook: true,
            default_account_frozen: false,
            enable_allowlist: true,
            supply_cap: None,
        }
    }
}

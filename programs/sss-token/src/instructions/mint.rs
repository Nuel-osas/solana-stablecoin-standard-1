use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::*;

/// Mint tokens to a recipient's token account.
/// Enforces pause state, minter role, oracle price peg, supply cap, and per-minter quota.
pub fn handler(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;
    require!(!stablecoin.paused, SSSError::Paused);

    // Verify minter role
    let role_assignment = &ctx.accounts.role_assignment;
    require!(role_assignment.active, SSSError::Unauthorized);
    require!(role_assignment.role == Role::Minter, SSSError::Unauthorized);
    require!(
        role_assignment.assignee == ctx.accounts.minter.key(),
        SSSError::Unauthorized
    );

    // Oracle price enforcement: if oracle_config is provided and enabled, validate price
    let clock = Clock::get()?;
    if let Some(oracle_config) = &ctx.accounts.oracle_config {
        if oracle_config.enabled {
            let price_feed_account = ctx.accounts.price_feed.as_ref()
                .ok_or(error!(SSSError::InvalidOracleFeed))?;
            super::oracle::validate_oracle_price(oracle_config, &price_feed_account.to_account_info(), clock.unix_timestamp)?;
        }
    }

    // Enforce supply cap if set
    if stablecoin.supply_cap > 0 {
        let net_supply = stablecoin.total_minted.saturating_sub(stablecoin.total_burned);
        require!(
            net_supply.checked_add(amount).ok_or(SSSError::MathOverflow)? <= stablecoin.supply_cap,
            SSSError::SupplyCapExceeded
        );
    }

    // Check and update minter quota
    let minter_info = &mut ctx.accounts.minter_info;
    if minter_info.quota > 0 {
        require!(
            minter_info.minted.checked_add(amount).ok_or(SSSError::MathOverflow)? <= minter_info.quota,
            SSSError::MinterQuotaExceeded
        );
    }
    minter_info.minted = minter_info.minted.checked_add(amount).ok_or(SSSError::MathOverflow)?;

    // Mint tokens via PDA
    let mint_key = ctx.accounts.mint.key();
    let seeds = &[
        STABLECOIN_SEED,
        mint_key.as_ref(),
        &[stablecoin.bump],
    ];

    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.stablecoin.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    // Update total minted
    let stablecoin = &mut ctx.accounts.stablecoin;
    stablecoin.total_minted = stablecoin.total_minted.checked_add(amount).ok_or(SSSError::MathOverflow)?;

    emit!(events::TokensMinted {
        mint: ctx.accounts.mint.key(),
        recipient: ctx.accounts.recipient_token_account.key(),
        amount,
        minter: ctx.accounts.minter.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Accounts required to mint tokens. Minter must have an active minter role.
#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(mut)]
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, mint.key().as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(
        mut,
        constraint = mint.key() == stablecoin.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Minter's role assignment PDA
    #[account(
        seeds = [ROLE_SEED, stablecoin.key().as_ref(), Role::Minter.to_seed(), minter.key().as_ref()],
        bump = role_assignment.bump,
    )]
    pub role_assignment: Account<'info, RoleAssignment>,

    /// Minter quota tracking
    #[account(
        mut,
        seeds = [MINTER_INFO_SEED, stablecoin.key().as_ref(), minter.key().as_ref()],
        bump = minter_info.bump,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    /// Recipient's token account
    #[account(mut)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,

    /// Optional: Oracle config PDA — if provided and enabled, price is validated
    #[account(
        seeds = [ORACLE_CONFIG_SEED, stablecoin.key().as_ref()],
        bump = oracle_config.bump,
    )]
    pub oracle_config: Option<Account<'info, OracleConfig>>,

    /// Optional: Pyth price feed account — required if oracle_config is provided
    /// CHECK: Validated inside validate_oracle_price against oracle_config.price_feed
    pub price_feed: Option<UncheckedAccount<'info>>,
}

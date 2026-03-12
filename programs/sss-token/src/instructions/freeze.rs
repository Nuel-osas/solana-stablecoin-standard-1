use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::*;

/// Freeze a token account, preventing all transfers. Requires pauser role or master authority.
pub fn freeze_handler(ctx: Context<FreezeAccount>) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;
    require!(!stablecoin.paused, SSSError::Paused);

    // Verify pauser role or master authority
    let is_master = ctx.accounts.authority.key() == stablecoin.authority;
    let is_pauser = ctx.accounts.role_assignment.as_ref()
        .map(|r| r.active && r.role == Role::Pauser && r.assignee == ctx.accounts.authority.key())
        .unwrap_or(false);
    require!(is_master || is_pauser, SSSError::Unauthorized);

    let mint_key = ctx.accounts.mint.key();
    let seeds = &[
        STABLECOIN_SEED,
        mint_key.as_ref(),
        &[stablecoin.bump],
    ];

    token_2022::freeze_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::FreezeAccount {
                account: ctx.accounts.target_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.stablecoin.to_account_info(),
            },
            &[seeds],
        ),
    )?;

    emit!(events::AccountFrozen {
        mint: ctx.accounts.mint.key(),
        account: ctx.accounts.target_account.key(),
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Thaw a frozen token account, re-enabling transfers. Requires pauser role or master authority.
pub fn thaw_handler(ctx: Context<ThawAccount>) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;

    // Verify pauser role or master authority
    let is_master = ctx.accounts.authority.key() == stablecoin.authority;
    let is_pauser = ctx.accounts.role_assignment.as_ref()
        .map(|r| r.active && r.role == Role::Pauser && r.assignee == ctx.accounts.authority.key())
        .unwrap_or(false);
    require!(is_master || is_pauser, SSSError::Unauthorized);

    let mint_key = ctx.accounts.mint.key();
    let seeds = &[
        STABLECOIN_SEED,
        mint_key.as_ref(),
        &[stablecoin.bump],
    ];

    token_2022::thaw_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::ThawAccount {
                account: ctx.accounts.target_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.stablecoin.to_account_info(),
            },
            &[seeds],
        ),
    )?;

    emit!(events::AccountThawed {
        mint: ctx.accounts.mint.key(),
        account: ctx.accounts.target_account.key(),
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Accounts required to freeze a token account.
#[derive(Accounts)]
pub struct FreezeAccount<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, mint.key().as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(constraint = mint.key() == stablecoin.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Optional role assignment (not needed if caller is master authority)
    #[account(
        seeds = [ROLE_SEED, stablecoin.key().as_ref(), Role::Pauser.to_seed(), authority.key().as_ref()],
        bump,
    )]
    pub role_assignment: Option<Account<'info, RoleAssignment>>,

    #[account(mut)]
    pub target_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Accounts required to thaw a frozen token account.
#[derive(Accounts)]
pub struct ThawAccount<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, mint.key().as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(constraint = mint.key() == stablecoin.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [ROLE_SEED, stablecoin.key().as_ref(), Role::Pauser.to_seed(), authority.key().as_ref()],
        bump,
    )]
    pub role_assignment: Option<Account<'info, RoleAssignment>>,

    #[account(mut)]
    pub target_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

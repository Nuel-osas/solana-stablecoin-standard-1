use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::*;

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
    });

    Ok(())
}

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
}

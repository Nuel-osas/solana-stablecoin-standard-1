use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::*;

/// Assign a role to an address. Only master authority can call this.
/// Compliance roles (blacklister/seizer) require compliance to be enabled.
/// When assigning the minter role, also initializes the minter quota tracker.
pub fn assign_role_handler(ctx: Context<AssignRole>, role: Role, assignee: Pubkey) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;
    require!(
        ctx.accounts.authority.key() == stablecoin.authority,
        SSSError::Unauthorized
    );

    // If compliance role (blacklister/seizer) check that compliance is enabled
    if matches!(role, Role::Blacklister | Role::Seizer) {
        require!(stablecoin.is_compliance_enabled(), SSSError::ComplianceNotEnabled);
    }

    let role_assignment = &mut ctx.accounts.role_assignment;
    role_assignment.stablecoin = stablecoin.key();
    role_assignment.role = role;
    role_assignment.assignee = assignee;
    role_assignment.active = true;
    role_assignment.granted_by = ctx.accounts.authority.key();
    role_assignment.granted_at = Clock::get()?.unix_timestamp;
    role_assignment.bump = ctx.bumps.role_assignment;

    emit!(events::RoleAssigned {
        mint: stablecoin.mint,
        role: role.to_string(),
        assignee,
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    // If assigning minter role, also initialize minter info
    if role == Role::Minter {
        if let Some(minter_info) = &mut ctx.accounts.minter_info {
            minter_info.stablecoin = stablecoin.key();
            minter_info.minter = assignee;
            minter_info.quota = 0; // unlimited by default
            minter_info.minted = 0;
            minter_info.bump = ctx.bumps.minter_info.unwrap_or(0);
        }
    }

    Ok(())
}

/// Revoke a role from an address by deactivating the role assignment PDA.
pub fn revoke_role_handler(ctx: Context<RevokeRole>, _role: Role, _assignee: Pubkey) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;
    require!(
        ctx.accounts.authority.key() == stablecoin.authority,
        SSSError::Unauthorized
    );

    let role_assignment = &mut ctx.accounts.role_assignment;
    role_assignment.active = false;

    emit!(events::RoleRevoked {
        mint: stablecoin.mint,
        role: role_assignment.role.to_string(),
        assignee: role_assignment.assignee,
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Two-step authority transfer — step 1: nominate a pending authority.
pub fn nominate_authority_handler(ctx: Context<NominateAuthority>, new_authority: Pubkey) -> Result<()> {
    let stablecoin = &mut ctx.accounts.stablecoin;
    require!(
        ctx.accounts.authority.key() == stablecoin.authority,
        SSSError::Unauthorized
    );

    stablecoin.pending_authority = new_authority;

    emit!(events::AuthorityNominated {
        mint: stablecoin.mint,
        current_authority: ctx.accounts.authority.key(),
        pending_authority: new_authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Two-step authority transfer — step 2: accept the nomination.
pub fn accept_authority_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let stablecoin = &mut ctx.accounts.stablecoin;
    require!(
        stablecoin.pending_authority != Pubkey::default(),
        SSSError::NoPendingAuthority
    );
    require!(
        ctx.accounts.new_authority.key() == stablecoin.pending_authority,
        SSSError::NotPendingAuthority
    );

    let old_authority = stablecoin.authority;
    stablecoin.authority = stablecoin.pending_authority;
    stablecoin.pending_authority = Pubkey::default();

    emit!(events::AuthorityTransferred {
        mint: stablecoin.mint,
        old_authority,
        new_authority: stablecoin.authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Direct (single-step) authority transfer — use with caution.
pub fn transfer_authority_handler(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
    let stablecoin = &mut ctx.accounts.stablecoin;
    require!(
        ctx.accounts.authority.key() == stablecoin.authority,
        SSSError::Unauthorized
    );

    let old_authority = stablecoin.authority;
    stablecoin.authority = new_authority;
    stablecoin.pending_authority = Pubkey::default(); // clear any pending nomination

    emit!(events::AuthorityTransferred {
        mint: stablecoin.mint,
        old_authority,
        new_authority,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Set or update supply cap. 0 = unlimited.
pub fn set_supply_cap_handler(ctx: Context<SetSupplyCap>, supply_cap: u64) -> Result<()> {
    let stablecoin = &mut ctx.accounts.stablecoin;
    require!(
        ctx.accounts.authority.key() == stablecoin.authority,
        SSSError::Unauthorized
    );

    let old_cap = stablecoin.supply_cap;
    stablecoin.supply_cap = supply_cap;

    emit!(events::SupplyCapUpdated {
        mint: stablecoin.mint,
        old_cap,
        new_cap: supply_cap,
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Update the mint quota for a specific minter. Only master authority can call this.
pub fn update_minter_quota_handler(ctx: Context<UpdateMinterQuota>, new_quota: u64) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;
    require!(
        ctx.accounts.authority.key() == stablecoin.authority,
        SSSError::Unauthorized
    );

    let minter_info = &mut ctx.accounts.minter_info;
    minter_info.quota = new_quota;

    Ok(())
}

/// Accounts required to assign a role. Creates role PDA and optional minter info PDA.
#[derive(Accounts)]
#[instruction(role: Role, assignee: Pubkey)]
pub struct AssignRole<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(
        init_if_needed,
        payer = authority,
        space = RoleAssignment::LEN,
        seeds = [ROLE_SEED, stablecoin.key().as_ref(), role.to_seed(), assignee.as_ref()],
        bump,
    )]
    pub role_assignment: Account<'info, RoleAssignment>,

    /// Optional: minter info (only needed when assigning minter role)
    #[account(
        init_if_needed,
        payer = authority,
        space = MinterInfo::LEN,
        seeds = [MINTER_INFO_SEED, stablecoin.key().as_ref(), assignee.as_ref()],
        bump,
    )]
    pub minter_info: Option<Account<'info, MinterInfo>>,

    pub system_program: Program<'info, System>,
}

/// Accounts required to revoke a role.
#[derive(Accounts)]
#[instruction(role: Role, assignee: Pubkey)]
pub struct RevokeRole<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(
        mut,
        seeds = [ROLE_SEED, stablecoin.key().as_ref(), role.to_seed(), assignee.as_ref()],
        bump = role_assignment.bump,
    )]
    pub role_assignment: Account<'info, RoleAssignment>,
}

/// Accounts required for two-step authority transfer (step 1: nominate).
#[derive(Accounts)]
pub struct NominateAuthority<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,
}

/// Accounts required for two-step authority transfer (step 2: accept).
#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(mut)]
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,
}

/// Accounts required for direct (single-step) authority transfer.
#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,
}

/// Accounts required to set or update the supply cap.
#[derive(Accounts)]
pub struct SetSupplyCap<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,
}

/// Accounts required to update a minter's quota.
#[derive(Accounts)]
pub struct UpdateMinterQuota<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(
        mut,
        seeds = [MINTER_INFO_SEED, stablecoin.key().as_ref(), minter_info.minter.as_ref()],
        bump = minter_info.bump,
    )]
    pub minter_info: Account<'info, MinterInfo>,
}

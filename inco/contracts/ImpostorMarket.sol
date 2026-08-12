// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {euint256, e, inco} from "@inco/lightning/src/Lib.sol";

interface IAmongUsRoles {
    function roleHandleOf(address who) external view returns (bytes32);
    function seated(address who) external view returns (bool);
    function impostorCount() external view returns (uint16);
}

/// @title ImpostorMarket - confidential parimutuel market on "who is the impostor".
/// @notice Picks are encrypted with Inco, so the board stays unreadable while the round is live.
///         Settlement is trustless: the impostor is proven with a covalidator attestation over the
///         role handle this market snapshotted at creation, so no oracle or admin can pick a winner.
/// @dev Betting on yourself can never win — the impostor must bet on an innocent or abstain.
contract ImpostorMarket {
    using e for *;

    enum Phase {
        Betting,
        Locked,
        Settled,
        Finalized,
        Refunding
    }

    /// @dev Winners must prove their pick inside this window; unproven bets forfeit to the pot.
    ///      Kept short because everyone is still on the game-over screen when a round ends.
    uint64 public constant PROVE_WINDOW = 3 minutes;
    /// @dev Anyone can unwind an abandoned market after this, so stakes are never trapped.
    uint64 public constant SETTLE_TIMEOUT = 6 hours;
    uint256 public constant MIN_STAKE = 0.00002 ether;

    struct Bet {
        uint128 stake;
        uint16 pick; // revealed pick, 1-based; 0 while still secret
        bool proven;
        bool winner;
        bool claimed;
        bytes32 pickHandle;
    }

    address public immutable roles;
    address public immutable host;
    uint256 public immutable matchId;
    uint16 public immutable impostorCount;
    uint64 public immutable createdAt;

    Phase public phase;
    uint64 public settledAt;
    uint16 public winningIndex; // 1-based index into candidates
    address public impostor;
    uint256 public pot;
    uint256 public winningStake;

    address[] public candidates;
    mapping(address => uint16) public candidateIndexPlus1;
    mapping(address => bytes32) private candidateRoleHandle;

    mapping(address => Bet) public betOf;
    address[] public bettors;

    event BetPlaced(address indexed bettor, uint256 stake);
    event BettingLocked(uint256 pot, uint256 bets);
    event Settled(address indexed impostor, uint16 winningIndex);
    event WinProven(address indexed bettor, uint256 stake);
    event Finalized(uint256 pot, uint256 winningStake);
    event Claimed(address indexed bettor, uint256 payout);
    event Refunded(address indexed bettor, uint256 amount);

    constructor(address _roles, uint256 _matchId, address _host, address[] memory _candidates) {
        require(_roles != address(0), "no roles");
        require(_candidates.length >= 2 && _candidates.length <= 16, "bad candidates");

        roles = _roles;
        matchId = _matchId;
        host = _host;
        createdAt = uint64(block.timestamp);
        impostorCount = IAmongUsRoles(_roles).impostorCount();

        for (uint256 i = 0; i < _candidates.length; i++) {
            address who = _candidates[i];
            require(who != address(0), "zero candidate");
            require(candidateIndexPlus1[who] == 0, "duplicate candidate");
            require(IAmongUsRoles(_roles).seated(who), "not seated");

            // Snapshot the handle so a later match on the roles contract can't move the target
            bytes32 handle = IAmongUsRoles(_roles).roleHandleOf(who);
            require(handle != bytes32(0), "roles not dealt");

            candidates.push(who);
            candidateIndexPlus1[who] = uint16(i + 1);
            candidateRoleHandle[who] = handle;
        }
    }

    // ── Betting ─────────────────────────────────────────────────────────────

    /// @notice Inco charges per encrypted input; bettors cover it on top of their stake.
    function betFee() public pure returns (uint256) {
        return inco.getFee() * 2;
    }

    function minBetValue() external pure returns (uint256) {
        return MIN_STAKE + betFee();
    }

    /// @notice Stake on a candidate. `ciphertext` is the 1-based candidate index, encrypted for this market.
    function bet(bytes calldata ciphertext) external payable {
        require(phase == Phase.Betting, "betting closed");
        uint256 fee = betFee();
        require(msg.value >= MIN_STAKE + fee, "stake too small");

        Bet storage b = betOf[msg.sender];
        require(b.stake == 0, "already bet");

        euint256 pick = e.newEuint256(ciphertext, msg.sender);
        pick.allowThis();

        uint256 stake = msg.value - fee;
        b.stake = uint128(stake);
        b.pickHandle = euint256.unwrap(pick);
        bettors.push(msg.sender);
        pot += stake;

        emit BetPlaced(msg.sender, stake);
    }

    /// @notice Close betting — called when the final vote starts. Public fallback prevents a stuck market.
    function lockBetting() external {
        require(phase == Phase.Betting, "not betting");
        require(msg.sender == host || block.timestamp > createdAt + SETTLE_TIMEOUT, "not host");
        phase = Phase.Locked;
        emit BettingLocked(pot, bettors.length);
    }

    // ── Settlement ──────────────────────────────────────────────────────────

    /// @notice Prove who the impostor was with a covalidator attestation over their role handle.
    /// @dev The handle was snapshotted at construction, so `roleValue` cannot be borrowed from another match.
    function settle(address who, uint256 roleValue, bytes[] calldata signatures) external {
        require(phase == Phase.Betting || phase == Phase.Locked, "already settled");
        uint16 idx = candidateIndexPlus1[who];
        require(idx != 0, "not a candidate");
        require(roleValue >= 1 && roleValue <= impostorCount, "not an impostor role");
        require(
            e.verifyDecryption(euint256.wrap(candidateRoleHandle[who]), roleValue, signatures),
            "bad role attestation"
        );

        impostor = who;
        winningIndex = idx;
        settledAt = uint64(block.timestamp);
        phase = Phase.Settled;
        emit Settled(who, idx);
    }

    /// @notice Make your own pick publicly decryptable so you can prove a win.
    function revealMyPick() external {
        require(phase == Phase.Settled, "not settled");
        Bet storage b = betOf[msg.sender];
        require(b.stake > 0, "no bet");
        require(!b.proven, "already proven");
        e.reveal(euint256.wrap(b.pickHandle));
    }

    /// @notice Claim a correct pick by attesting the revealed value. Losing bets stay secret forever.
    function proveWin(uint256 pickValue, bytes[] calldata signatures) external {
        require(phase == Phase.Settled, "not settled");
        require(block.timestamp <= settledAt + PROVE_WINDOW, "prove window closed");

        Bet storage b = betOf[msg.sender];
        require(b.stake > 0, "no bet");
        require(!b.proven, "already proven");
        // Validate the proof before judging the claim, so a bad attestation is never
        // mistaken for a wrong guess
        require(
            e.verifyDecryption(euint256.wrap(b.pickHandle), pickValue, signatures),
            "bad pick attestation"
        );
        require(pickValue == winningIndex, "wrong pick");
        // The impostor betting on themselves is the one guess that never pays
        require(candidateIndexPlus1[msg.sender] != winningIndex, "self bet");

        b.pick = uint16(pickValue);
        b.proven = true;
        b.winner = true;
        winningStake += b.stake;
        emit WinProven(msg.sender, b.stake);
    }

    /// @notice Lock in the payout ratio once the prove window closes.
    function finalize() external {
        require(phase == Phase.Settled, "not settled");
        require(block.timestamp > settledAt + PROVE_WINDOW, "prove window open");
        phase = winningStake == 0 ? Phase.Refunding : Phase.Finalized;
        emit Finalized(pot, winningStake);
    }

    /// @notice Unwind a market that never settled, so stakes are never trapped.
    function abandon() external {
        require(phase != Phase.Finalized && phase != Phase.Refunding, "already resolved");
        require(block.timestamp > createdAt + SETTLE_TIMEOUT, "too early");
        phase = Phase.Refunding;
        emit Finalized(pot, 0);
    }

    // ── Payouts (pull only) ─────────────────────────────────────────────────

    function payoutOf(address who) public view returns (uint256) {
        Bet storage b = betOf[who];
        if (b.claimed || b.stake == 0) return 0;
        if (phase == Phase.Refunding) return b.stake;
        if (phase != Phase.Finalized || !b.winner) return 0;
        return (uint256(b.stake) * pot) / winningStake;
    }

    function claim() external {
        require(phase == Phase.Finalized || phase == Phase.Refunding, "not payable");
        Bet storage b = betOf[msg.sender];
        uint256 amount = payoutOf(msg.sender);
        require(amount > 0, "nothing to claim");

        b.claimed = true;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");

        if (phase == Phase.Refunding) emit Refunded(msg.sender, amount);
        else emit Claimed(msg.sender, amount);
    }

    // ── Views ───────────────────────────────────────────────────────────────

    function candidateCount() external view returns (uint256) {
        return candidates.length;
    }

    function bettorCount() external view returns (uint256) {
        return bettors.length;
    }

    function pickHandleOf(address who) external view returns (bytes32) {
        return betOf[who].pickHandle;
    }

    function roleHandleSnapshot(address who) external view returns (bytes32) {
        return candidateRoleHandle[who];
    }

    /// @notice Everything the UI needs in one call.
    function summary()
        external
        view
        returns (
            Phase phase_,
            uint256 pot_,
            uint256 bets_,
            uint16 winningIndex_,
            address impostor_,
            uint256 winningStake_,
            uint64 settledAt_
        )
    {
        return (phase, pot, bettors.length, winningIndex, impostor, winningStake, settledAt);
    }

    receive() external payable {}
}

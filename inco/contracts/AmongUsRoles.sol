// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {euint256} from "@inco/lightning/src/Lib.sol";
import {ConfidentialDeck} from "./kit/ConfidentialDeck.sol";

/// @title AmongUsRoles - confidential Impostor / Crewmate roles via ConfidentialDeck.
/// @notice Roles are shuffled and dealt privately. Value <= impostorCount => Impostor.
/// @dev Lifecycle mirrors the working Bluff Masters pattern:
///      join is cheap (no FHE); shuffle fee is paid in the same tx as assignRoles.
contract AmongUsRoles is ConfidentialDeck {
    uint16 public immutable impostorCount;
    uint256 public matchId;
    uint16 public expectedPlayers;

    address public host;
    address[] public players;
    mapping(address => euint256) private roleOf;
    mapping(address => bool) public seated;
    mapping(address => bool) public revealed;

    enum State {
        Idle,
        Joining,
        Assigned
    }
    State public state;

    event MatchOpened(uint256 indexed matchId, address indexed host, uint16 seats);
    event Joined(address indexed player, uint256 indexed matchId);
    event RolesAssigned(uint256 indexed matchId, uint16 players, uint16 impostors);
    event RoleRevealed(uint256 indexed matchId, address indexed player, bytes32 handle);
    event MatchReset(uint256 indexed matchId);

    constructor(uint16 _impostorCount) {
        require(_impostorCount >= 1, "need impostor");
        impostorCount = _impostorCount;
        state = State.Idle;
    }

    /// @notice Host opens a match. Optional ETH prefund; shuffle fee is paid in assignRoles.
    /// @dev Host may reopen while Joining (cancels stuck lobby). Anyone may reopen after Assigned.
    function openMatch(uint16 seats) external payable {
        require(
            state == State.Idle ||
                state == State.Assigned ||
                (state == State.Joining && msg.sender == host),
            "busy"
        );
        require(seats > impostorCount, "too few");
        require(seats <= 16, "too many");

        if (state == State.Assigned || state == State.Joining) {
            _clearSeats();
        }

        host = msg.sender;
        matchId += 1;
        expectedPlayers = seats;
        state = State.Joining;
        emit MatchOpened(matchId, msg.sender, seats);
    }

    /// @notice Host aborts a Joining match that never finished assignRoles.
    function cancelMatch() external {
        require(state == State.Joining, "not joining");
        require(msg.sender == host, "not host");
        _clearSeats();
        state = State.Idle;
        emit MatchReset(matchId);
    }

    /// @notice Escape hatch when a lobby is stuck (demo / recovery).
    function forceCancel() external {
        require(state == State.Joining, "not joining");
        _clearSeats();
        state = State.Idle;
        emit MatchReset(matchId);
    }

    /// @notice Claim a seat. Idempotent — already-seated wallets succeed without revert.
    /// @dev No FHE here (same as Bluff joinPool): keeps gas predictable for MetaMask.
    function join() external {
        require(state == State.Joining, "closed");
        if (seated[msg.sender]) {
            return;
        }
        seated[msg.sender] = true;
        players.push(msg.sender);
        emit Joined(msg.sender, matchId);
    }

    /// @notice Shuffle + deal. Pay Inco fee with msg.value in THIS tx (Bluff `deal` pattern).
    function assignRoles() external payable {
        require(state == State.Joining, "not joining");
        uint16 n = uint16(players.length);
        require(n > impostorCount, "too few players");

        uint256 fee = deckFee(n);
        // msg.value lands in balance before this check; also accept prior openMatch prefund
        require(address(this).balance >= fee, "fund fee");

        _newShuffledDeck(n);
        for (uint256 i = 0; i < n; i++) {
            address seat = players[i];
            roleOf[seat] = _dealTo(seat);
            revealed[seat] = false;
        }
        state = State.Assigned;
        emit RolesAssigned(matchId, n, impostorCount);
    }

    /// @notice Publicly reveal a player's role (e.g. after eject). Irreversible.
    function revealRole(address who) external {
        require(state == State.Assigned, "no roles");
        require(seated[who], "not seated");
        require(!revealed[who], "already");
        euint256 card = roleOf[who];
        _revealCard(card);
        revealed[who] = true;
        emit RoleRevealed(matchId, who, euint256.unwrap(card));
    }

    /// @notice Reset after Assigned for a new lobby.
    function reset() external {
        require(state == State.Assigned, "not assigned");
        _clearSeats();
        state = State.Idle;
        emit MatchReset(matchId);
    }

    function myRoleHandle() external view returns (bytes32) {
        return euint256.unwrap(roleOf[msg.sender]);
    }

    function roleHandleOf(address who) external view returns (bytes32) {
        return euint256.unwrap(roleOf[who]);
    }

    function isRevealed(address who) external view returns (bool) {
        return revealed[who];
    }

    function playerCount() external view returns (uint256) {
        return players.length;
    }

    function playerAt(uint256 i) external view returns (address) {
        return players[i];
    }

    function _clearSeats() internal {
        for (uint256 i = 0; i < players.length; i++) {
            seated[players[i]] = false;
            revealed[players[i]] = false;
        }
        delete players;
        host = address(0);
        expectedPlayers = 0;
    }

    receive() external payable {}
}

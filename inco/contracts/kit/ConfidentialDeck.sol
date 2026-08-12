// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {euint256, elist, ETypes, e, inco} from "@inco/lightning/src/Lib.sol";

/// @title ConfidentialDeck - Inco deck primitive for hidden-info games
/// @notice Shuffle/draw/deal/reveal/settle on an encrypted deck.
/// Write only game rules; the `e.*` calls live here.
/// @dev Only `_newShuffledDeck` costs a fee, paid from this balance.
/// Every handle is allowThis'd so we keep cross-tx access.
abstract contract ConfidentialDeck {
    using e for *;

    elist private _deck;
    uint16 private _drawn; // pointer is public; values stay secret
    bytes32 public deckHandle;

    event DeckShuffled(bytes32 indexed deckHandle, uint16 size);
    event CardDealt(address indexed to, uint16 indexed index, bytes32 handle);
    event CardRevealed(uint16 indexed index, bytes32 handle);

    error DeckEmpty();
    error DeckNotReady();

    /// @notice Fee for _newShuffledDeck (shuffle costs 2x).
    function deckFee(uint16 size) public view returns (uint256) {
        return 2 * inco.getEListFee(size, ETypes.Uint256);
    }

    /// @notice Cards drawn so far.
    function cardsDrawn() external view returns (uint16) {
        return _drawn;
    }

    /// @notice Total deck size (always public).
    function deckSize() public view returns (uint16) {
        return e.length(_deck);
    }

    /// @notice Cards left in the deck.
    function cardsRemaining() external view returns (uint16) {
        return deckSize() - _drawn;
    }

    // ── The four confidential moves ─────────────────────────────────────────

    /// @dev One TEE shuffle of values 1..size; order unknowable to anyone.
    function _newShuffledDeck(uint16 size) internal {
        elist deck = e.shuffledRange(1, size + 1, ETypes.Uint256);
        e.allow(deck, address(this)); // keep cross-tx access to the deck
        _deck = deck;
        _drawn = 0;
        deckHandle = elist.unwrap(deck);
        emit DeckShuffled(deckHandle, size);
    }

    /// @dev Draw next value; returns a still-hidden handle.
    function _draw() internal returns (euint256 card) {
        uint16 size = e.length(_deck);
        if (size == 0) revert DeckNotReady();
        if (_drawn >= size) revert DeckEmpty();
        card = e.getEuint256(_deck, _drawn);
        card.allowThis(); // load-bearing: keep it accessible next tx
        _drawn += 1;
    }

    /// @dev Deal next card so only `to` can decrypt it.
    function _dealTo(address to) internal returns (euint256 card) {
        uint16 index = _drawn;
        card = _draw(); // already allowThis()'d
        card.allow(to); // only `to` can read it off-chain
        emit CardDealt(to, index, euint256.unwrap(card));
    }

    /// @dev Make a card public. Irreversible.
    function _revealCard(euint256 card) internal {
        card.allowThis();
        e.reveal(card);
    }

    /// @dev Draw next card and reveal it to all.
    function _dealFaceUp() internal returns (euint256 card) {
        uint16 index = _drawn;
        card = _draw(); // already allowThis()'d
        e.reveal(card);
        emit CardRevealed(index, euint256.unwrap(card));
    }

    /// @dev Verify a revealed value against its handle at settlement.
    /// Sigs bind to THIS handle; no foreign value can sub in.
    function _verifyValue(euint256 card, uint256 value, bytes[] calldata sigs)
        internal
        view
        returns (uint256)
    {
        require(e.verifyDecryption(card, value, sigs), "bad card attestation");
        return value;
    }
}

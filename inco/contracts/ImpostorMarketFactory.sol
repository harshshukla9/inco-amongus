// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ImpostorMarket} from "./ImpostorMarket.sol";

/// @title ImpostorMarketFactory - one market per match.
/// @notice Isolating markets per match keeps a finished round's payouts independent of the next lobby.
contract ImpostorMarketFactory {
    address public immutable roles;

    mapping(uint256 => address) public marketOfMatch;
    address[] public allMarkets;

    event MarketCreated(uint256 indexed matchId, address indexed market, address indexed host);

    constructor(address _roles) {
        require(_roles != address(0), "no roles");
        roles = _roles;
    }

    /// @notice Open the market for a match whose roles have already been dealt.
    function createMarket(uint256 matchId, address[] calldata candidates) external returns (address) {
        require(marketOfMatch[matchId] == address(0), "market exists");
        ImpostorMarket market = new ImpostorMarket(roles, matchId, msg.sender, candidates);
        marketOfMatch[matchId] = address(market);
        allMarkets.push(address(market));
        emit MarketCreated(matchId, address(market), msg.sender);
        return address(market);
    }

    function marketCount() external view returns (uint256) {
        return allMarkets.length;
    }
}

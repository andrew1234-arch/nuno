// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {NunoFeed} from "./NunoFeed.sol";

/// @title OrganicGate
/// @notice Example consumer of NunoFeed: lets a contract refuse tokens whose supply is
///         concentrated in coordinated wallet clusters, or whose Nuno data is stale.
contract OrganicGate {
    NunoFeed public immutable feed;

    error NoSnapshot(address token);
    error StaleSnapshot(address token, uint64 publishedAt, uint256 maxAge);
    error TooClustered(address token, uint16 clusterSupplyBps, uint16 maxClusterBps);

    constructor(NunoFeed feed_) {
        feed = feed_;
    }

    /// @notice Reverts unless `token` has a snapshot no older than `maxAge` seconds whose
    ///         cluster-held supply is at most `maxClusterBps`.
    function requireOrganic(address token, uint16 maxClusterBps, uint256 maxAge)
        public
        view
        returns (NunoFeed.Snapshot memory s)
    {
        s = feed.latest(token);
        if (s.publishedAt == 0) revert NoSnapshot(token);
        // Freshness is coarse (minutes to hours); validator timestamp drift is irrelevant here.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp - s.publishedAt > maxAge) revert StaleSnapshot(token, s.publishedAt, maxAge);
        if (s.clusterSupplyBps > maxClusterBps) revert TooClustered(token, s.clusterSupplyBps, maxClusterBps);
    }

    /// @notice Non-reverting variant for UIs and routers.
    function isOrganic(address token, uint16 maxClusterBps, uint256 maxAge) external view returns (bool) {
        try this.requireOrganic(token, maxClusterBps, maxAge) {
            return true;
        } catch {
            return false;
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title NunoFeed
/// @notice Cluster-adjusted metrics for nad.fun tokens, computed off-chain from Monad mainnet
///         data by Nuno and published here for apps and contracts to read.
/// @dev All *Bps fields are basis points (0..10000). `evidenceRoot` is keccak256 of the
///      canonical JSON of the clusters and evidence behind the snapshot (see docs/METHODOLOGY.md).
contract NunoFeed {
    struct Snapshot {
        uint64 sourceBlock;
        uint64 publishedAt;
        uint32 rawHolders;
        uint32 realHolders;
        uint16 clusterSupplyBps;
        uint16 effectiveTop10Bps;
        uint16 creatorLinkedSupplyBps;
        uint16 organicVolumeBps;
        bytes32 evidenceRoot;
    }

    uint16 internal constant MAX_BPS = 10_000;

    address public owner;
    address public publisher;
    mapping(address token => Snapshot) private _latest;

    event SnapshotPublished(
        address indexed token,
        uint64 indexed sourceBlock,
        uint32 rawHolders,
        uint32 realHolders,
        uint16 clusterSupplyBps,
        uint16 effectiveTop10Bps,
        uint16 creatorLinkedSupplyBps,
        uint16 organicVolumeBps,
        bytes32 evidenceRoot
    );
    event PublisherSet(address indexed previous, address indexed next);
    event OwnershipTransferred(address indexed previous, address indexed next);

    error NotOwner();
    error NotPublisher();
    error ZeroAddress();
    error BpsOutOfRange();
    error RealHoldersExceedRaw();
    error StaleSourceBlock(uint64 latest, uint64 given);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialPublisher) {
        if (initialPublisher == address(0)) revert ZeroAddress();
        owner = msg.sender;
        publisher = initialPublisher;
        emit OwnershipTransferred(address(0), msg.sender);
        emit PublisherSet(address(0), initialPublisher);
    }

    /// @notice Publish the latest snapshot for `token`. `publishedAt` is set to block.timestamp.
    /// @dev Snapshots may be overwritten by newer (or same-block) data, never by older data.
    function publish(address token, Snapshot calldata s) external {
        if (msg.sender != publisher) revert NotPublisher();
        if (token == address(0)) revert ZeroAddress();
        if (
            s.clusterSupplyBps > MAX_BPS || s.effectiveTop10Bps > MAX_BPS || s.creatorLinkedSupplyBps > MAX_BPS
                || s.organicVolumeBps > MAX_BPS
        ) revert BpsOutOfRange();
        if (s.realHolders > s.rawHolders) revert RealHoldersExceedRaw();
        uint64 prev = _latest[token].sourceBlock;
        if (s.sourceBlock < prev) revert StaleSourceBlock(prev, s.sourceBlock);

        Snapshot memory stored = s;
        // uint64 seconds cannot overflow for ~585 billion years.
        // forge-lint: disable-next-line(unsafe-typecast)
        stored.publishedAt = uint64(block.timestamp);
        _latest[token] = stored;

        emit SnapshotPublished(
            token,
            s.sourceBlock,
            s.rawHolders,
            s.realHolders,
            s.clusterSupplyBps,
            s.effectiveTop10Bps,
            s.creatorLinkedSupplyBps,
            s.organicVolumeBps,
            s.evidenceRoot
        );
    }

    /// @notice Latest snapshot for `token`; all-zero if none has been published.
    function latest(address token) external view returns (Snapshot memory) {
        return _latest[token];
    }

    function hasSnapshot(address token) external view returns (bool) {
        return _latest[token].publishedAt != 0;
    }

    function setPublisher(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        address previous = publisher;
        publisher = next;
        emit PublisherSet(previous, next);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        address previous = owner;
        owner = next;
        emit OwnershipTransferred(previous, next);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {NunoFeed} from "../src/NunoFeed.sol";
import {OrganicGate} from "../src/OrganicGate.sol";

contract NunoFeedTest is Test {
    NunoFeed feed;
    OrganicGate gate;
    address publisher = makeAddr("publisher");
    address stranger = makeAddr("stranger");
    address token = makeAddr("token");

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

    function setUp() public {
        vm.warp(1_800_000_000);
        feed = new NunoFeed(publisher);
        gate = new OrganicGate(feed);
    }

    function snap(uint64 sourceBlock, uint16 clusterBps) internal pure returns (NunoFeed.Snapshot memory s) {
        s = NunoFeed.Snapshot({
            sourceBlock: sourceBlock,
            publishedAt: 0,
            rawHolders: 120,
            realHolders: 40,
            clusterSupplyBps: clusterBps,
            effectiveTop10Bps: 6500,
            creatorLinkedSupplyBps: 1200,
            organicVolumeBps: 3100,
            evidenceRoot: keccak256("evidence")
        });
    }

    // --- access control ---

    function test_onlyPublisherCanPublish() public {
        vm.prank(stranger);
        vm.expectRevert(NunoFeed.NotPublisher.selector);
        feed.publish(token, snap(1, 100));
    }

    function test_onlyOwnerCanSetPublisher() public {
        vm.prank(stranger);
        vm.expectRevert(NunoFeed.NotOwner.selector);
        feed.setPublisher(stranger);

        feed.setPublisher(stranger);
        assertEq(feed.publisher(), stranger);

        vm.prank(publisher);
        vm.expectRevert(NunoFeed.NotPublisher.selector);
        feed.publish(token, snap(1, 100));

        vm.prank(stranger);
        feed.publish(token, snap(1, 100));
    }

    function test_rejectsZeroAddresses() public {
        vm.expectRevert(NunoFeed.ZeroAddress.selector);
        new NunoFeed(address(0));
        vm.expectRevert(NunoFeed.ZeroAddress.selector);
        feed.setPublisher(address(0));
        vm.prank(publisher);
        vm.expectRevert(NunoFeed.ZeroAddress.selector);
        feed.publish(address(0), snap(1, 100));
    }

    function test_transferOwnership() public {
        feed.transferOwnership(stranger);
        assertEq(feed.owner(), stranger);
        vm.expectRevert(NunoFeed.NotOwner.selector);
        feed.setPublisher(stranger);
    }

    // --- read-back, overwrite, events ---

    function test_readBackSetsPublishedAt() public {
        assertFalse(feed.hasSnapshot(token));
        NunoFeed.Snapshot memory s = snap(111_700_000, 4200);
        s.publishedAt = 42; // ignored: contract stamps block.timestamp
        vm.prank(publisher);
        feed.publish(token, s);

        NunoFeed.Snapshot memory r = feed.latest(token);
        assertTrue(feed.hasSnapshot(token));
        assertEq(r.sourceBlock, 111_700_000);
        assertEq(r.publishedAt, block.timestamp);
        assertEq(r.rawHolders, 120);
        assertEq(r.realHolders, 40);
        assertEq(r.clusterSupplyBps, 4200);
        assertEq(r.effectiveTop10Bps, 6500);
        assertEq(r.creatorLinkedSupplyBps, 1200);
        assertEq(r.organicVolumeBps, 3100);
        assertEq(r.evidenceRoot, keccak256("evidence"));
    }

    function test_overwriteWithNewerOrSameBlock() public {
        vm.startPrank(publisher);
        feed.publish(token, snap(100, 1000));
        feed.publish(token, snap(100, 1500));
        assertEq(feed.latest(token).clusterSupplyBps, 1500);
        feed.publish(token, snap(200, 2000));
        assertEq(feed.latest(token).clusterSupplyBps, 2000);
        assertEq(feed.latest(token).sourceBlock, 200);
        vm.stopPrank();
    }

    function test_rejectsOlderSourceBlock() public {
        vm.startPrank(publisher);
        feed.publish(token, snap(200, 1000));
        vm.expectRevert(abi.encodeWithSelector(NunoFeed.StaleSourceBlock.selector, uint64(200), uint64(199)));
        feed.publish(token, snap(199, 1000));
        vm.stopPrank();
    }

    function test_emitsSnapshotPublished() public {
        NunoFeed.Snapshot memory s = snap(777, 4200);
        vm.expectEmit(true, true, false, true, address(feed));
        emit SnapshotPublished(token, 777, 120, 40, 4200, 6500, 1200, 3100, keccak256("evidence"));
        vm.prank(publisher);
        feed.publish(token, s);
    }

    // --- bounds ---

    function test_bpsBounds() public {
        vm.startPrank(publisher);
        feed.publish(token, snap(1, 10_000));

        NunoFeed.Snapshot memory s = snap(2, 10_001);
        vm.expectRevert(NunoFeed.BpsOutOfRange.selector);
        feed.publish(token, s);

        s = snap(2, 0);
        s.effectiveTop10Bps = 10_001;
        vm.expectRevert(NunoFeed.BpsOutOfRange.selector);
        feed.publish(token, s);

        s = snap(2, 0);
        s.creatorLinkedSupplyBps = 10_001;
        vm.expectRevert(NunoFeed.BpsOutOfRange.selector);
        feed.publish(token, s);

        s = snap(2, 0);
        s.organicVolumeBps = 10_001;
        vm.expectRevert(NunoFeed.BpsOutOfRange.selector);
        feed.publish(token, s);
        vm.stopPrank();
    }

    function test_realHoldersCannotExceedRaw() public {
        NunoFeed.Snapshot memory s = snap(1, 0);
        s.realHolders = s.rawHolders + 1;
        vm.prank(publisher);
        vm.expectRevert(NunoFeed.RealHoldersExceedRaw.selector);
        feed.publish(token, s);
    }

    function testFuzz_bpsWithinBoundsAlwaysAccepted(uint16 a, uint16 b, uint16 c, uint16 d) public {
        NunoFeed.Snapshot memory s = snap(1, uint16(bound(a, 0, 10_000)));
        s.effectiveTop10Bps = uint16(bound(b, 0, 10_000));
        s.creatorLinkedSupplyBps = uint16(bound(c, 0, 10_000));
        s.organicVolumeBps = uint16(bound(d, 0, 10_000));
        vm.prank(publisher);
        feed.publish(token, s);
        assertEq(feed.latest(token).organicVolumeBps, s.organicVolumeBps);
    }

    // --- OrganicGate ---

    function test_gateRevertsWithoutSnapshot() public {
        vm.expectRevert(abi.encodeWithSelector(OrganicGate.NoSnapshot.selector, token));
        gate.requireOrganic(token, 3000, 1 hours);
        assertFalse(gate.isOrganic(token, 3000, 1 hours));
    }

    function test_gatePassesUnderThreshold() public {
        vm.prank(publisher);
        feed.publish(token, snap(1, 2500));
        NunoFeed.Snapshot memory s = gate.requireOrganic(token, 3000, 1 hours);
        assertEq(s.clusterSupplyBps, 2500);
        assertTrue(gate.isOrganic(token, 3000, 1 hours));
        // Threshold is inclusive.
        gate.requireOrganic(token, 2500, 1 hours);
    }

    function test_gateRevertsWhenTooClustered() public {
        vm.prank(publisher);
        feed.publish(token, snap(1, 4200));
        vm.expectRevert(abi.encodeWithSelector(OrganicGate.TooClustered.selector, token, uint16(4200), uint16(3000)));
        gate.requireOrganic(token, 3000, 1 hours);
        assertFalse(gate.isOrganic(token, 3000, 1 hours));
    }

    function test_gateRevertsWhenStale() public {
        vm.prank(publisher);
        feed.publish(token, snap(1, 100));
        uint64 publishedAt = uint64(vm.getBlockTimestamp());
        vm.warp(publishedAt + 1 hours);
        gate.requireOrganic(token, 3000, 1 hours); // exactly maxAge is still fresh
        vm.warp(publishedAt + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(OrganicGate.StaleSnapshot.selector, token, publishedAt, uint256(1 hours)));
        gate.requireOrganic(token, 3000, 1 hours);
    }
}

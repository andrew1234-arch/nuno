// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {NunoFeed} from "../src/NunoFeed.sol";
import {OrganicGate} from "../src/OrganicGate.sol";

/// Deploys NunoFeed + OrganicGate and writes deployments/monad-testnet.json.
/// Env: DEPLOYER_PRIVATE_KEY, PUBLISHER_ADDRESS (defaults to the deployer).
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address publisher = vm.envOr("PUBLISHER_ADDRESS", deployer);
        require(block.chainid == 10143, "Deploy: Monad testnet (10143) only unless approved");

        vm.startBroadcast(pk);
        NunoFeed feed = new NunoFeed(publisher);
        OrganicGate gate = new OrganicGate(feed);
        vm.stopBroadcast();

        console.log("NunoFeed", address(feed));
        console.log("OrganicGate", address(gate));

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeAddress(obj, "publisher", publisher);
        vm.serializeAddress(obj, "NunoFeed", address(feed));
        vm.serializeUint(obj, "deployBlock", block.number);
        string memory json = vm.serializeAddress(obj, "OrganicGate", address(gate));
        vm.writeJson(json, "../deployments/monad-testnet.json");
    }
}

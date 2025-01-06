// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract IPFSHelper {
    // Events for tracking IPFS content updates
    event ContentAdded(string indexed contentType, string contentHash);
    event ContentUpdated(string oldContentHash, string newContentHash);

    // Validate IPFS hash format (basic check)
    function isValidIPFSHash(string memory _hash) public pure returns (bool) {
        bytes memory hashBytes = bytes(_hash);
        // Basic validation: IPFS hash should start with "Qm" and be 46 characters long
        if (hashBytes.length != 46) return false;
        if (hashBytes[0] != 'Q' || hashBytes[1] != 'm') return false;
        return true;
    }
} 
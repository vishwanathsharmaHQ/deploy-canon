const hre = require("hardhat");
const fetch = require('node-fetch');

async function main() {
    console.log("Testing connections...");

    // Test Hardhat node connection
    try {
        const provider = new hre.ethers.JsonRpcProvider("http://127.0.0.1:8545/");
        const blockNumber = await provider.getBlockNumber();
        console.log("✅ Connected to local Hardhat node");
        console.log(`Current block number: ${blockNumber}`);
    } catch (error) {
        console.error("❌ Failed to connect to Hardhat node:", error.message);
    }

    // Test IPFS node connection
    try {
        const response = await fetch('http://127.0.0.1:5001/api/v0/id', {
            method: 'POST'
        });
        const identity = await response.json();
        console.log("✅ Connected to local IPFS node");
        console.log(`IPFS node ID: ${identity.ID}`);
        console.log(`IPFS version: ${identity.AgentVersion}`);
        console.log(`IPFS protocol version: ${identity.ProtocolVersion}`);
    } catch (error) {
        console.error("❌ Failed to connect to IPFS node:", error.message);
        console.error("Make sure your IPFS daemon is running with: ipfs daemon");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 
const hre = require("hardhat");
const fs = require('fs');

async function main() {
    console.log("Reading contract state...");

    // Load deployed contract addresses
    const addresses = JSON.parse(fs.readFileSync('deployments.json', 'utf8'));
    console.log("Loaded addresses:", addresses);

    // Get the deployed contracts
    const CanonThread = await ethers.getContractFactory("CanonThread");
    const canonThread = await CanonThread.attach(addresses.canonThread);

    // Read Thread 1 state
    console.log("\nThread 1 state:");
    const thread1 = await canonThread.threads(1);
    console.log("Metadata IPFS hash:", thread1.metadataHash);
    console.log("Content IPFS hash:", thread1.contentHash);
    console.log("Creator:", thread1.creator);
    console.log("Version:", thread1.version.toString());
    console.log("Timestamp:", new Date(Number(thread1.timestamp) * 1000).toLocaleString());
    console.log("Is Active:", thread1.isActive);

    // Get total nodes
    const nodeCounter = await canonThread.nodeCounter();
    console.log("\nTotal nodes created:", nodeCounter.toString());

    // Read all nodes for Thread 1
    console.log("\nNodes for Thread 1:");
    for (let i = 1; i <= nodeCounter; i++) {
        const node = await canonThread.nodes(i);
        if (node.threadId.toString() === "1" && node.isActive) {
            console.log(`\nNode ${i}:`);
            console.log("Metadata IPFS hash:", node.metadataHash);
            console.log("Content IPFS hash:", node.contentHash);
            console.log("Node type:", ["EVIDENCE", "REFERENCE", "CONTEXT", "EXAMPLE", "COUNTERPOINT", "SYNTHESIS"][node.nodeType]);
            console.log("Creator:", node.creator);
            console.log("Timestamp:", new Date(Number(node.timestamp) * 1000).toLocaleString());
        }
    }

    // Read Thread 2 state
    console.log("\nThread 2 state:");
    const thread2 = await canonThread.threads(2);
    console.log("Metadata IPFS hash:", thread2.metadataHash);
    console.log("Content IPFS hash:", thread2.contentHash);
    console.log("Creator:", thread2.creator);
    console.log("Version:", thread2.version.toString());
    console.log("Timestamp:", new Date(Number(thread2.timestamp) * 1000).toLocaleString());
    console.log("Is Active:", thread2.isActive);

    // Read all nodes for Thread 2
    console.log("\nNodes for Thread 2:");
    for (let i = 1; i <= nodeCounter; i++) {
        const node = await canonThread.nodes(i);
        if (node.threadId.toString() === "2" && node.isActive) {
            console.log(`\nNode ${i}:`);
            console.log("Metadata IPFS hash:", node.metadataHash);
            console.log("Content IPFS hash:", node.contentHash);
            console.log("Node type:", ["EVIDENCE", "REFERENCE", "CONTEXT", "EXAMPLE", "COUNTERPOINT", "SYNTHESIS"][node.nodeType]);
            console.log("Creator:", node.creator);
            console.log("Timestamp:", new Date(Number(node.timestamp) * 1000).toLocaleString());
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 
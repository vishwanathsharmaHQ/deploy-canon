const hre = require("hardhat");
const fs = require('fs');
const fetch = require('node-fetch');
const FormData = require('form-data');

async function uploadToIPFS(content) {
    try {
        const formData = new FormData();
        const contentBuffer = Buffer.from(JSON.stringify(content));
        formData.append('file', contentBuffer);

        const response = await fetch('http://localhost:5001/api/v0/add', {
            method: 'POST',
            body: formData,
            duplex: 'half'
        });
        
        const data = await response.json();
        return data.Hash;
    } catch (error) {
        console.error("Error uploading to IPFS:", error);
        throw error;
    }
}

async function createThreadContent(title, description, content) {
    // Create metadata JSON
    const metadata = {
        title,
        description,
        createdAt: new Date().toISOString(),
        version: 1
    };

    // Create content JSON
    const contentData = {
        title,
        content,
        lastUpdated: new Date().toISOString()
    };

    // Upload both to IPFS
    const metadataHash = await uploadToIPFS(metadata);
    const contentHash = await uploadToIPFS(contentData);

    return { metadataHash, contentHash };
}

async function main() {
    const [owner] = await ethers.getSigners();
    console.log("Creating content with account:", owner.address);

    // Load deployed contract addresses
    const addresses = JSON.parse(fs.readFileSync('deployments.json', 'utf8'));
    console.log("Loaded addresses:", addresses);

    // Get the deployed contracts
    const CanonThread = await ethers.getContractFactory("CanonThread");
    const canonThread = await CanonThread.attach(addresses.canonThread);

    // Create thread content
    console.log("\nPreparing thread content...");
    const { metadataHash, contentHash } = await createThreadContent(
        "Understanding Blockchain Technology",
        "A comprehensive guide to blockchain technology, its principles, and applications",
        "Blockchain technology represents a revolutionary approach to storing and tracking data that is transparent, secure, and decentralized..."
    );

    console.log("Content uploaded to IPFS:");
    console.log("Metadata Hash:", metadataHash);
    console.log("Content Hash:", contentHash);

    // Create Thread
    console.log("\nCreating thread on-chain...");
    const tx = await canonThread.createThread(metadataHash, contentHash);
    await tx.wait();
    console.log("Thread created successfully!");

    // Get the thread ID
    const threadId = await canonThread.threadCounter();
    console.log("Thread ID:", threadId.toString());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CanonThread", function () {
    let canonToken;
    let canonThread;
    let owner;
    let addr1;
    
    // Valid IPFS hashes for testing
    const validMetadataHash = "QmWWQSuPMS6aXCbZKpEjPHPUZN2NjB3YrhJTHsV4X3vb2t";
    const validContentHash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    const newMetadataHash = "QmW7Uc3BrJqb8fxPALJ75Tz1nYZoGDqbKVuZ1FyXN6bwri";
    const newContentHash = "QmPChd2hVbrJ6bfo3WBcTW4iZnpHm8TEzWkLHmLpXhF68A";

    const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1 million tokens

    beforeEach(async function () {
        [owner, addr1] = await ethers.getSigners();

        // Deploy token first
        const CanonToken = await ethers.getContractFactory("CanonToken");
        canonToken = await CanonToken.deploy(INITIAL_SUPPLY);

        // Deploy CanonThread with token address
        const CanonThread = await ethers.getContractFactory("CanonThread");
        canonThread = await CanonThread.deploy(canonToken.target);
    });

    describe("Thread Operations", function () {
        it("Should create a new thread", async function () {
            // Create thread and wait for the transaction
            await expect(canonThread.createThread(validMetadataHash, validContentHash))
                .to.emit(canonThread, "ThreadCreated")
                .withArgs(1, owner.address, validMetadataHash, validContentHash);

            // Verify thread data
            const thread = await canonThread.threads(1);
            expect(thread.metadataHash).to.equal(validMetadataHash);
            expect(thread.contentHash).to.equal(validContentHash);
            expect(thread.creator).to.equal(owner.address);
            expect(thread.version).to.equal(1);
            expect(thread.isActive).to.equal(true);
        });

        it("Should reject invalid IPFS hashes", async function () {
            const invalidHash = "invalid-hash";
            await expect(
                canonThread.createThread(invalidHash, validContentHash)
            ).to.be.revertedWith("Invalid metadata IPFS hash");

            await expect(
                canonThread.createThread(validMetadataHash, invalidHash)
            ).to.be.revertedWith("Invalid content IPFS hash");
        });

        it("Should update a thread", async function () {
            // First create a thread
            await canonThread.createThread(validMetadataHash, validContentHash);

            // Update the thread and verify event
            await expect(canonThread.updateThread(1, newMetadataHash, newContentHash))
                .to.emit(canonThread, "ThreadUpdated")
                .withArgs(1, newMetadataHash, newContentHash, 2);

            // Verify updated thread data
            const thread = await canonThread.threads(1);
            expect(thread.metadataHash).to.equal(newMetadataHash);
            expect(thread.contentHash).to.equal(newContentHash);
            expect(thread.version).to.equal(2);
        });
    });

    describe("Node Operations", function () {
        beforeEach(async function () {
            // Create a thread for node tests
            await canonThread.createThread(validMetadataHash, validContentHash);
        });

        it("Should create a node", async function () {
            await expect(canonThread.createNode(
                1, // threadId
                validMetadataHash,
                validContentHash,
                0 // NodeType.EVIDENCE
            ))
                .to.emit(canonThread, "NodeCreated")
                .withArgs(1, 1, 0, validMetadataHash, validContentHash);

            // Verify node data
            const node = await canonThread.nodes(1);
            expect(node.metadataHash).to.equal(validMetadataHash);
            expect(node.contentHash).to.equal(validContentHash);
            expect(node.nodeType).to.equal(0);
            expect(node.creator).to.equal(owner.address);
            expect(node.threadId).to.equal(1);
            expect(node.isActive).to.equal(true);
        });

        it("Should not create node for non-existent thread", async function () {
            await expect(
                canonThread.createNode(
                    999, // non-existent threadId
                    validMetadataHash,
                    validContentHash,
                    0
                )
            ).to.be.revertedWith("Thread does not exist");
        });
    });
}); 
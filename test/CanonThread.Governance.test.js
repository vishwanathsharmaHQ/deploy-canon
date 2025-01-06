const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployContracts, getCurrentTimestamp } = require("./helpers/setup");

describe("CanonThread Governance", function () {
    let canonToken;
    let canonThread;
    let owner;
    let addr1;
    let addr2;
    
    // Valid IPFS hashes for testing
    const validMetadataHash = "QmWWQSuPMS6aXCbZKpEjPHPUZN2NjB3YrhJTHsV4X3vb2t";
    const validContentHash = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    const newMetadataHash = "QmW7Uc3BrJqb8fxPALJ75Tz1nYZoGDqbKVuZ1FyXN6bwri";
    const newContentHash = "QmPChd2hVbrJ6bfo3WBcTW4iZnpHm8TEzWkLHmLpXhF68A";

    const MINIMUM_STAKE = ethers.parseEther("100"); // 100 tokens
    const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1 million tokens

    beforeEach(async function () {
        const deployment = await deployContracts();
        canonToken = deployment.canonToken;
        canonThread = deployment.canonThread;
        owner = deployment.owner;
        addr1 = deployment.addr1;
        addr2 = deployment.addr2;

        // Create a thread for testing proposals
        await canonThread.createThread(validMetadataHash, validContentHash);
    });

    describe("Proposal Creation", function () {
        it("Should create a proposal with sufficient stake", async function () {
            // Approve tokens first
            await canonToken.connect(addr1).approve(canonThread.target, MINIMUM_STAKE);

            // Get current timestamp and set next block to be 1 second later
            const currentTimestamp = await time.latest();
            const baseTimestamp = currentTimestamp + 1;
            await time.setNextBlockTimestamp(baseTimestamp);

            const tx = await canonThread.connect(addr1).proposeUpdate(
                1, // threadId
                newMetadataHash,
                newContentHash,
                MINIMUM_STAKE
            );

            // Get the actual proposal from chain
            const proposal = await canonThread.proposals(1);
            
            // Verify the event matches the proposal data
            await expect(tx)
                .to.emit(canonThread, "ProposalCreated")
                .withArgs(1, 1, addr1.address, MINIMUM_STAKE, proposal.deadline);

            // Verify proposal data
            expect(proposal.threadId).to.equal(1);
            expect(proposal.proposedMetadataHash).to.equal(newMetadataHash);
            expect(proposal.proposedContentHash).to.equal(newContentHash);
            expect(proposal.proposer).to.equal(addr1.address);
            expect(proposal.stake).to.equal(MINIMUM_STAKE);
            expect(proposal.deadline).to.equal(baseTimestamp + (3 * 24 * 60 * 60));
        });

        it("Should reject proposal with insufficient stake", async function () {
            const lowStake = ethers.parseEther("50"); // 50 tokens
            await canonToken.connect(addr1).approve(canonThread.target, lowStake);

            await expect(
                canonThread.connect(addr1).proposeUpdate(
                    1,
                    newMetadataHash,
                    newContentHash,
                    lowStake
                )
            ).to.be.revertedWith("Insufficient stake");
        });
    });

    describe("Voting", function () {
        beforeEach(async function () {
            // Create a proposal first
            await canonToken.connect(addr1).approve(canonThread.target, MINIMUM_STAKE);
            await canonThread.connect(addr1).proposeUpdate(
                1,
                newMetadataHash,
                newContentHash,
                MINIMUM_STAKE
            );
        });

        it("Should allow voting on active proposals", async function () {
            const voteAmount = ethers.parseEther("500");
            await canonToken.connect(addr2).approve(canonThread.target, voteAmount);

            await expect(canonThread.connect(addr2).vote(1, true, voteAmount))
                .to.emit(canonThread, "Voted")
                .withArgs(1, addr2.address, true, voteAmount);

            const proposal = await canonThread.proposals(1);
            expect(proposal.votesFor).to.equal(voteAmount);
        });

        it("Should prevent double voting", async function () {
            const voteAmount = ethers.parseEther("500");
            await canonToken.connect(addr2).approve(canonThread.target, voteAmount);
            await canonThread.connect(addr2).vote(1, true, voteAmount);

            await expect(
                canonThread.connect(addr2).vote(1, true, voteAmount)
            ).to.be.revertedWith("Already voted");
        });
    });

    describe("Proposal Execution", function () {
        beforeEach(async function () {
            // Create a proposal
            await canonToken.connect(addr1).approve(canonThread.target, MINIMUM_STAKE);
            await canonThread.connect(addr1).proposeUpdate(
                1,
                newMetadataHash,
                newContentHash,
                MINIMUM_STAKE
            );

            // Vote on the proposal
            const voteAmount = ethers.parseEther("1000");
            await canonToken.connect(addr2).approve(canonThread.target, voteAmount);
            await canonThread.connect(addr2).vote(1, true, voteAmount);
        });

        it("Should execute successful proposal after voting period", async function () {
            // Fast forward past voting period
            await time.increase(3 * 24 * 60 * 60 + 1);

            await expect(canonThread.executeProposal(1))
                .to.emit(canonThread, "ProposalExecuted")
                .withArgs(1, true);

            // Check thread was updated
            const thread = await canonThread.threads(1);
            expect(thread.metadataHash).to.equal(newMetadataHash);
            expect(thread.contentHash).to.equal(newContentHash);
        });

        it("Should not execute proposal before voting period ends", async function () {
            await expect(
                canonThread.executeProposal(1)
            ).to.be.revertedWith("Voting period not ended");
        });
    });
}); 
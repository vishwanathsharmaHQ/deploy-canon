const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

async function deployContracts() {
    const [owner, addr1, addr2] = await ethers.getSigners();
    
    // Deploy token
    const CanonToken = await ethers.getContractFactory("CanonToken");
    const initialSupply = ethers.parseEther("1000000");
    const canonToken = await CanonToken.deploy(initialSupply);

    // Deploy thread contract
    const CanonThread = await ethers.getContractFactory("CanonThread");
    const canonThread = await CanonThread.deploy(canonToken.target);

    // Setup initial token distribution
    await canonToken.transfer(addr1.address, ethers.parseEther("10000"));
    await canonToken.transfer(addr2.address, ethers.parseEther("10000"));

    return {
        canonToken,
        canonThread,
        owner,
        addr1,
        addr2,
        initialSupply
    };
}

async function getCurrentTimestamp() {
    return await time.latest();
}

module.exports = {
    deployContracts,
    getCurrentTimestamp
}; 